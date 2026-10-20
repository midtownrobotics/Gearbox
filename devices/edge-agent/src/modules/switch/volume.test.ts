import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SoundStoppedError, createSoundPlayer } from "./player";
import { scaleWaveVolume } from "./volume";

function wave(format: number, bits: number, samples: number[]) {
  const width = bits / 8;
  const data = new Uint8Array(44 + width * samples.length);
  const view = new DataView(data.buffer);
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WAVE"],
    [12, "fmt "],
    [36, "data"],
  ] as const)
    data.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, data.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, 1, true);
  view.setUint16(34, bits, true);
  view.setUint32(40, width * samples.length, true);
  samples.forEach((sample, index) => {
    const offset = 44 + index * width;
    if (format === 3) {
      if (bits === 32) view.setFloat32(offset, sample, true);
      else view.setFloat64(offset, sample, true);
    } else if (bits === 8) view.setUint8(offset, sample);
    else if (bits === 16) view.setInt16(offset, sample, true);
    else if (bits === 32) view.setInt32(offset, sample, true);
    else {
      data[offset] = sample & 255;
      data[offset + 1] = (sample >> 8) & 255;
      data[offset + 2] = (sample >> 16) & 255;
    }
  });
  return data;
}

test("attenuates PCM and float WAVs without changing headers or source", () => {
  for (const bits of [8, 16, 24, 32]) {
    const samples = bits === 8 ? [0, 128, 254] : [-100, 0, 100];
    const source = wave(1, bits, samples);
    const expected = wave(1, bits, bits === 8 ? [64, 128, 191] : [-50, 0, 50]);
    expect(scaleWaveVolume(source, 50)).toEqual(expected);
    expect(source).toEqual(wave(1, bits, samples));
    expect(scaleWaveVolume(source, 100)).toEqual(source);
    expect(scaleWaveVolume(source, 0)).toEqual(
      wave(1, bits, bits === 8 ? [128, 128, 128] : [0, 0, 0]),
    );
  }
  for (const bits of [32, 64])
    expect(scaleWaveVolume(wave(3, bits, [-1, 0, 1]), 25)).toEqual(wave(3, bits, [-0.25, 0, 0.25]));
});

test("rejects invalid volume, truncated WAVs and compressed formats", () => {
  expect(() => scaleWaveVolume(wave(1, 16, [100]), -1)).toThrow("Volume");
  expect(() => scaleWaveVolume(wave(1, 16, [100]), Number.NaN)).toThrow("Volume");
  expect(() => scaleWaveVolume(wave(1, 16, [100]).slice(0, 44), 50)).toThrow("Truncated");
  expect(() => scaleWaveVolume(wave(6, 8, [1]), 50)).toThrow("uncompressed");
});

test("feeds attenuated WAV to the configured player and still stops mid-clip", async () => {
  const directory = await mkdtemp(join(tmpdir(), "g3-volume-"));
  const path = join(directory, "sound.wav");
  const source = wave(1, 16, [-100, 100]);
  await writeFile(path, source);
  let command: string[] = [];
  let audio: Uint8Array | undefined;
  let finish = (_code: number) => {};
  let killed = false;
  let started = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const player = createSoundPlayer(
    "aplay",
    "device",
    async () => [path],
    (args, input) => {
      command = args;
      audio = input;
      started();
      return {
        exited: new Promise<number>((resolve) => {
          finish = resolve;
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        kill() {
          killed = true;
          finish(0);
        },
      };
    },
  );
  try {
    const playing = player.play(path, 50);
    const stopped = playing.catch((error: unknown) => error);
    await ready;
    expect(command).toEqual(["aplay", "-q", "-D", "device", "-"]);
    expect(audio).toEqual(wave(1, 16, [-50, 50]));
    player.stop();
    expect(await stopped).toBeInstanceOf(SoundStoppedError);
    expect(killed).toBe(true);
    expect(new Uint8Array(await Bun.file(path).arrayBuffer())).toEqual(source);
  } finally {
    player.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
