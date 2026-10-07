import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SwitchDetector } from "./detector";
import { GpioSwitchInput } from "./input";
import { SoundStoppedError, createSoundPlayer, soundCommand } from "./player";
import { SoundLibrary } from "./sounds";

describe("SwitchDetector", () => {
  test("triggers once when the closed-door ground opens past debounce", () => {
    const detector = new SwitchDetector(75);

    expect(detector.sample(false, 100)).toEqual({ changed: false, triggered: false });
    expect(detector.sample(true, 130)).toEqual({ changed: false, triggered: false });
    expect(detector.sample(false, 200)).toEqual({ changed: false, triggered: false });
    expect(detector.sample(false, 274)).toEqual({ changed: false, triggered: false });
    expect(detector.sample(false, 275)).toEqual({ changed: true, triggered: true });
    expect(detector.sample(false, 500)).toEqual({ changed: false, triggered: false });
  });

  test("rearms after the door closes and grounds the input again", () => {
    const detector = new SwitchDetector(10);

    detector.sample(false, 0);
    expect(detector.sample(false, 10).triggered).toBe(true);
    detector.sample(true, 20);
    expect(detector.sample(true, 30)).toEqual({ changed: true, triggered: false });
    detector.sample(false, 40);
    expect(detector.sample(false, 50).triggered).toBe(true);
  });

  test("reset does not trigger for a door already open at startup", () => {
    const detector = new SwitchDetector(10);
    detector.reset(false);
    expect(detector.sample(false, 100)).toEqual({ changed: false, triggered: false });
  });
});

describe("GpioSwitchInput", () => {
  test("maps GPIO low to grounded and high to open", async () => {
    const directory = await mkdtemp(join(tmpdir(), "g3-switch-gpio-"));
    const valuePath = join(directory, "value");
    const input = new GpioSwitchInput(valuePath);
    try {
      await writeFile(valuePath, "0\n");
      expect(input.readGrounded()).toBe(true);
      await writeFile(valuePath, "1\n");
      expect(input.readGrounded()).toBe(false);
      await writeFile(valuePath, "x\n");
      expect(() => input.readGrounded()).toThrow("Unexpected GPIO value");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("Bluetooth playback targets the configured BlueALSA PCM without a shell", () => {
  expect(
    soundCommand(
      "aplay",
      "bluealsa:DEV=AA:BB:CC:DD:EE:FF,PROFILE=a2dp",
      "/srv/g3-sounds/welcome.wav",
    ),
  ).toEqual([
    "aplay",
    "-q",
    "-D",
    "bluealsa:DEV=AA:BB:CC:DD:EE:FF,PROFILE=a2dp",
    "/srv/g3-sounds/welcome.wav",
  ]);
});

test("closing the door stops the playing WAV and cancels queued playback", async () => {
  const processes: { kill: () => void; finish: () => void; killed: () => boolean }[] = [];
  const player = createSoundPlayer(
    "aplay",
    "plughw:CARD=rockchipes8388,DEV=0",
    async () => ["/srv/g3-sounds/welcome.wav"],
    () => {
      let resolveExit: (code: number) => void = () => {};
      let wasKilled = false;
      const exited = new Promise<number>((resolve) => {
        resolveExit = resolve;
      });
      const kill = () => {
        wasKilled = true;
        resolveExit(143);
      };
      processes.push({
        kill,
        finish: () => resolveExit(0),
        killed: () => wasKilled,
      });
      return {
        exited,
        stderr: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
        kill,
      };
    },
  );

  const playing = player.play();
  const queued = player.play();
  await Bun.sleep(0);
  expect(processes).toHaveLength(1);

  player.stop();
  expect(processes[0].killed()).toBe(true);
  await expect(playing).rejects.toBeInstanceOf(SoundStoppedError);
  await expect(queued).rejects.toBeInstanceOf(SoundStoppedError);

  const nextOpening = player.play();
  await Bun.sleep(0);
  expect(processes).toHaveLength(2);
  processes[1].finish();
  await expect(nextOpening).resolves.toBe("/srv/g3-sounds/welcome.wav");
});

describe("SoundLibrary", () => {
  const wave = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

  test("uploads, lists, resolves, and deletes validated WAV files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "g3-switch-sounds-"));
    const library = new SoundLibrary(directory, []);
    try {
      await library.upload("welcome.wav", wave);
      expect(await library.list()).toEqual([{ name: "welcome.wav", size: 12 }]);
      expect(await library.paths()).toEqual([join(directory, "welcome.wav")]);
      expect(library.soundPath("welcome.wav")).toBe(join(directory, "welcome.wav"));
      await expect(library.upload("welcome.wav", wave)).rejects.toThrow("already exists");
      await library.remove("welcome.wav");
      expect(await library.list()).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects invalid names, traversal, non-WAV data, and oversized files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "g3-switch-sounds-"));
    const library = new SoundLibrary(directory, []);
    try {
      await expect(library.upload("../bad.wav", wave)).rejects.toThrow("Name must");
      await expect(library.upload("bad.mp3", wave)).rejects.toThrow("Name must");
      await expect(library.upload("bad.wav", new Uint8Array(12))).rejects.toThrow("not a valid");
      await expect(
        library.upload("huge.wav", new Uint8Array(10 * 1024 * 1024 + 1)),
      ).rejects.toThrow("10 MB");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
