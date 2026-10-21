// The Leaderboard's two rankings, from the actions log: steps completed, and points for how long
// each step usually takes the team. A step's points are the team's median time, in minutes, for
// that part at that process (else that process, else any step), never the time the person took,
// so working slowly earns nothing and every hour of work is worth about the same.

export type LoggedAction = {
  userId: string;
  partInstanceId: number;
  processId: number;
  action: "started" | "completed";
  createdAt: number;
};

export type Standing = { userId: string; steps: number; points: number };

const MINUTE = 60_000;

export const SCORING = {
  /** A job that took longer was probably left open (overnight, forgotten): not a sample. */
  maxJobMs: 4 * 60 * MINUTE,
  /** Started and completed within this: marked after the work was done, not a sample. */
  minJobMs: 30_000,
  /** Samples a median needs before it's used. */
  minSamples: 3,
  /** Minutes a step is worth before the team has any samples. */
  defaultMinutes: 10,
} as const;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function push<K>(map: Map<K, number[]>, key: K, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Each person's steps and points. `partOf` maps an instance to its part definition (instances
 * deleted since are missing, and are scored by their process alone).
 */
export function leaderboard(
  log: LoggedAction[],
  partOf: Map<number, number>,
  scoring = SCORING,
): Standing[] {
  const ordered = [...log].sort((a, b) => a.createdAt - b.createdAt);

  // A job: the instances one person completed at one process in one go (a batch, a bulk
  // completion, or a single part). Their time is shared, so each part's time is the job's over
  // its count.
  type Job = { userId: string; processId: number; at: number; instances: number[]; start: number };
  const jobs = new Map<string, Job>();
  const startedAt = new Map<string, number>();
  for (const a of ordered) {
    const step = `${a.partInstanceId}:${a.processId}`;
    if (a.action === "started") {
      startedAt.set(step, a.createdAt);
      continue;
    }
    const key = `${a.userId}:${a.processId}:${a.createdAt}`;
    let job = jobs.get(key);
    if (!job) {
      job = {
        userId: a.userId,
        processId: a.processId,
        at: a.createdAt,
        instances: [],
        start: Number.POSITIVE_INFINITY,
      };
      jobs.set(key, job);
    }
    job.instances.push(a.partInstanceId);
    const start = startedAt.get(step);
    if (start !== undefined) job.start = Math.min(job.start, start);
    // A step redone later needs a new start to be timed again.
    startedAt.delete(step);
  }

  // Samples: minutes per part, once per job for each part it held and once for its process.
  const byPart = new Map<string, number[]>();
  const byProcess = new Map<number, number[]>();
  const all: number[] = [];
  for (const job of jobs.values()) {
    const took = job.at - job.start;
    if (!(took >= scoring.minJobMs && took <= scoring.maxJobMs)) continue;
    const perPart = took / MINUTE / job.instances.length;
    const parts = new Set(job.instances.map((id) => partOf.get(id)));
    for (const part of parts) {
      if (part !== undefined) push(byPart, `${part}:${job.processId}`, perPart);
    }
    push(byProcess, job.processId, perPart);
    all.push(perPart);
  }

  const enough = (samples: number[] | undefined) =>
    samples && samples.length >= scoring.minSamples ? median(samples) : undefined;
  const fallback = enough(all) ?? scoring.defaultMinutes;
  const processMinutes = new Map<number, number>();
  const minutesFor = (part: number | undefined, processId: number) => {
    const ofPart = part === undefined ? undefined : enough(byPart.get(`${part}:${processId}`));
    if (ofPart !== undefined) return ofPart;
    let ofProcess = processMinutes.get(processId);
    if (ofProcess === undefined) {
      ofProcess = enough(byProcess.get(processId)) ?? fallback;
      processMinutes.set(processId, ofProcess);
    }
    return ofProcess;
  };

  const standings = new Map<string, { steps: number; points: number }>();
  for (const job of jobs.values()) {
    const s = standings.get(job.userId) ?? { steps: 0, points: 0 };
    for (const id of job.instances) {
      s.steps += 1;
      s.points += minutesFor(partOf.get(id), job.processId);
    }
    standings.set(job.userId, s);
  }
  return [...standings].map(([userId, s]) => ({
    userId,
    steps: s.steps,
    points: Math.round(s.points),
  }));
}
