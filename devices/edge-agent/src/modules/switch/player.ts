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
): SoundPlayer {
  let next = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let active: { kill(): void } | null = null;

  return {
    play(path) {
      const requestedGeneration = generation;
      const task = queue.then(async () => {
        if (requestedGeneration !== generation) throw new SoundStoppedError();
        const available = path ? [path] : await sounds();
        if (requestedGeneration !== generation) throw new SoundStoppedError();
        if (available.length === 0) throw new Error("No switch sounds are configured.");
        const sound = available[next++ % available.length];
        const process = spawnSound(soundCommand(player, device, sound));
        active = process;
        let exitCode: number;
        try {
          exitCode = await process.exited;
        } finally {
          if (active === process) active = null;
        }
        if (requestedGeneration !== generation) throw new SoundStoppedError();
        if (exitCode !== 0) {
          const error = await new Response(process.stderr).text();
          throw new Error(`${player} exited ${exitCode}: ${error.trim() || "unknown error"}`);
        }
        return sound;
      });
      queue = task.catch(() => {});
      return task;
    },
    stop() {
      generation++;
      active?.kill();
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
