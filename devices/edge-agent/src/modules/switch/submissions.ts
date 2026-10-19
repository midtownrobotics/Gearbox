import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_SWITCH_SOUND_BYTES,
  type SwitchSubmission,
  isWaveFile,
  validSwitchSoundName,
} from "@g3/worker-edge/switch-types";
import type { SoundLibrary } from "./sounds";

/** Submitted audio is never part of SoundLibrary.paths() until an admin approves it. */
export class SoundSubmissions {
  private readonly directory: string;
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(
    directory: string,
    private readonly library: SoundLibrary,
  ) {
    this.directory = join(directory, ".submissions");
  }
  private path(id: string, extension: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid submission ID.");
    return join(this.directory, id + extension);
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(task);
    this.mutation = result.catch(() => {});
    return result;
  }
  private async save(submission: SwitchSubmission) {
    const temporary = this.path(submission.id, ".tmp");
    await writeFile(temporary, JSON.stringify(submission));
    await rename(temporary, this.path(submission.id, ".json"));
  }
  async get(id: string): Promise<SwitchSubmission> {
    try {
      return JSON.parse(await readFile(this.path(id, ".json"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Submission not found.");
      throw error;
    }
  }
  async list(userId?: string): Promise<SwitchSubmission[]> {
    await mkdir(this.directory, { recursive: true });
    const files = await readdir(this.directory);
    const all = await Promise.all(
      files
        .filter((file) => /^[0-9a-f-]{36}\.json$/.test(file))
        .map((file) => this.get(file.slice(0, -5))),
    );
    return all
      .filter((submission) => !userId || submission.userId === userId)
      .sort((a, b) => b.submittedAt - a.submittedAt);
  }
  async submit(name: string, audio: Uint8Array, userId: string, submittedBy: string) {
    if (!validSwitchSoundName(name))
      throw new Error(
        "Use a WAV filename with letters, numbers, spaces, dots, dashes or underscores (5-100 characters).",
      );
    if (!audio.length || audio.length > MAX_SWITCH_SOUND_BYTES)
      throw new Error("WAV files must be between 1 byte and 10 MB.");
    if (!isWaveFile(audio)) throw new Error("The file is not a valid RIFF/WAVE audio file.");
    if (!userId || userId.length > 200 || !submittedBy || submittedBy.length > 200)
      throw new Error("A signed-in submitter is required.");
    return this.serial(async () => {
      const pending = (await this.list()).filter((submission) => submission.status === "pending");
      if (
        pending.length >= 50 ||
        pending.filter((submission) => submission.userId === userId).length >= 3
      )
        throw new Error(
          "The pending sound limit has been reached. Wait for an admin to review submissions.",
        );
      const submission: SwitchSubmission = {
        id: randomUUID(),
        name,
        userId,
        submittedBy,
        size: audio.length,
        submittedAt: Math.floor(Date.now() / 1000),
        status: "pending",
        reviewedBy: null,
      };
      await writeFile(this.path(submission.id, ".wav"), audio, { flag: "wx" });
      try {
        await this.save(submission);
      } catch (error) {
        await unlink(this.path(submission.id, ".wav"));
        throw error;
      }
      return submission;
    });
  }
  async soundPath(id: string) {
    const submission = await this.get(id);
    if (submission.status !== "pending")
      throw new Error("This submission has already been reviewed.");
    return this.path(id, ".wav");
  }
  async review(id: string, action: "approved" | "rejected", reviewedBy: string) {
    return this.serial(async () => {
      const submission = await this.get(id);
      if (submission.status !== "pending")
        throw new Error("This submission has already been reviewed.");
      if (action === "approved")
        await this.library.upload(
          submission.name,
          new Uint8Array(await readFile(this.path(id, ".wav"))),
        );
      const reviewed: SwitchSubmission = { ...submission, status: action, reviewedBy };
      try {
        await this.save(reviewed);
      } catch (error) {
        if (action === "approved") await this.library.remove(submission.name);
        throw error;
      }
      await unlink(this.path(id, ".wav")).catch((error) =>
        console.error("[switch] could not clean up reviewed audio", error),
      );
      return reviewed;
    });
  }
}
