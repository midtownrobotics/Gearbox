import { existsSync } from "node:fs";
import { link, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_SWITCH_SOUND_BYTES,
  type SwitchSound,
  isWaveFile,
  validSwitchSoundName,
} from "@g3/worker-edge/switch-types";

export class SoundLibrary {
  constructor(
    private readonly directory: string,
    private readonly configuredPaths: string[],
  ) {}

  async ensureDirectory() {
    await mkdir(this.directory, { recursive: true });
  }

  private path(name: string) {
    if (!validSwitchSoundName(name)) throw new Error("Invalid sound name.");
    return join(this.directory, name);
  }

  async list(): Promise<SwitchSound[]> {
    await this.ensureDirectory();
    const entries = await readdir(this.directory, { withFileTypes: true });
    const sounds = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && validSwitchSoundName(entry.name))
        .map(async (entry) => ({
          name: entry.name,
          size: (await stat(join(this.directory, entry.name))).size,
        })),
    );
    return sounds.sort((a, b) => a.name.localeCompare(b.name));
  }

  async paths() {
    const uploaded = (await this.list()).map((sound) => join(this.directory, sound.name));
    return [...new Set([...this.configuredPaths.filter(existsSync), ...uploaded])];
  }

  async upload(name: string, data: Uint8Array) {
    if (!validSwitchSoundName(name)) {
      throw new Error(
        "Name must be 5-100 letters, numbers, spaces, dots, dashes, or underscores and end in .wav.",
      );
    }
    if (data.length === 0 || data.length > MAX_SWITCH_SOUND_BYTES) {
      throw new Error("WAV files must be between 1 byte and 10 MB.");
    }
    if (!isWaveFile(data)) throw new Error("The file is not a valid RIFF/WAVE audio file.");
    await this.ensureDirectory();
    try {
      await writeFile(this.path(name), data, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("A sound with that name already exists.");
      }
      throw error;
    }
  }

  async rename(name: string, newName: string) {
    const source = this.soundPath(name);
    const destination = this.path(newName);
    if (name === newName) return;
    try {
      // Creating the destination exclusively prevents overwriting another clip.
      await link(source, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("A sound with that name already exists.");
      throw error;
    }
    try {
      await unlink(source);
    } catch (error) {
      await unlink(destination);
      throw error;
    }
  }

  async remove(name: string) {
    try {
      await unlink(this.path(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Sound not found.");
      throw error;
    }
  }

  soundPath(name: string) {
    const path = this.path(name);
    if (!existsSync(path)) throw new Error("Sound not found.");
    return path;
  }
}
