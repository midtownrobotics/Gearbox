export interface SoundPlayer {
  play(path?: string): Promise<string>;
  stop(): void;
}

export class SoundStoppedError extends Error {
  constructor() {
    super("Sound playback stopped when the door closed.");
  }
}

export function soundCommand(player: string, device: string, sound: string) {
  return [player, "-q", "-D", device, sound];
}

const PLAYBACK_TIMEOUT_MS = 5 * 60_000; // Bound a stuck player without cutting off long sounds.

async function readErrorOutput(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (output.length < 4_096) output += text.slice(0, 4_096 - output.length);
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

interface PlaybackProcess {
  exited: Promise<number>;
  stderr: ReadableStream<Uint8Array>;
  kill(): void;
}

/** Plays configured sounds in rotation, without invoking a shell. */
export function createSoundPlayer(
  player: string,
  device: string,
  sounds: () => Promise<string[]>,
  spawnSound: (command: string[]) => PlaybackProcess = (command) =>
    Bun.spawn(command, { stdout: "ignore", stderr: "pipe" }),
  playbackTimeoutMs = PLAYBACK_TIMEOUT_MS,
): SoundPlayer {
  let next = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let active: { kill(): void } | null = null;
  let cancelActive: (() => void) | null = null;
  let playbackFault: Error | null = null;

  function kill(process: { kill(): void }) {
    try {
      process.kill();
    } catch (error) {
      console.error("[switch] failed to stop audio process", error);
    }
  }

  return {
    play(path) {
      const requestedGeneration = generation;
      const task = queue.then(async () => {
        if (playbackFault) throw playbackFault;
        if (requestedGeneration !== generation) throw new SoundStoppedError();
        const available = path ? [path] : await sounds();
        if (requestedGeneration !== generation) throw new SoundStoppedError();
        if (available.length === 0) throw new Error("No switch sounds are configured.");
        const sound = available[next++ % available.length];
        const process = spawnSound(soundCommand(player, device, sound));
        active = process;
        let exitCode: number;
        let errorOutput: string;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // Drain stderr while aplay is running. Waiting for exit first can
          // deadlock if the child fills its stderr pipe during playback.
          [exitCode, errorOutput] = await Promise.race([
            Promise.all([process.exited, readErrorOutput(process.stderr)]),
            new Promise<never>((_, reject) => {
              cancelActive = () => reject(new SoundStoppedError());
            }),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                playbackFault = new Error(
                  "Audio playback timed out; sound is disabled until restart.",
                );
                kill(process);
                reject(playbackFault);
              }, playbackTimeoutMs);
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
          cancelActive = null;
          if (active === process) active = null;
        }
        if (requestedGeneration !== generation) throw new SoundStoppedError();
        if (exitCode !== 0) {
          playbackFault = new Error(
            `${player} exited ${exitCode}: ${errorOutput.trim() || "unknown error"}; sound is disabled until restart.`,
          );
          throw playbackFault;
        }
        return sound;
      });
      queue = task.catch(() => {});
      return task;
    },
    stop() {
      generation++;
      if (active) kill(active);
      cancelActive?.();
    },
  };
}

export function createMockSoundPlayer(sounds: () => Promise<string[]>): SoundPlayer {
  let next = 0;
  return {
    async play(path) {
      const available = path ? [path] : await sounds();
      if (available.length === 0) throw new Error("No switch sounds are configured.");
      return available[next++ % available.length];
    },
    stop() {},
  };
}
