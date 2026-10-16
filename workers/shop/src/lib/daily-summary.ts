import { inTeam } from "@g3/auth";
import { eq, gte } from "drizzle-orm";
import type { createShopDb } from "../db";
import { actions, partInstanceProcesses, partInstances, processes } from "../db/schema";

type Db = ReturnType<typeof createShopDb>;

export type ReflectionStats = {
  partsCompleted: number;
  partsLeft: number;
  stepsCompleted: number;
  priorityCompleted: number;
  partsAdded: number;
  /** Steps finished today per process, busiest first. */
  byProcess: { name: string; steps: number }[];
  /** Steps completed today per user, most first. */
  byUser: { userId: string; steps: number }[];
  firstAt: number | null;
  lastAt: number | null;
};

// Two daily Slack messages, both simply generated from shop data:
// - Overview (start of day): where the work is waiting and which machines need help.
// - Reflection (end of day): what got done.

/**
 * Reflection: what happened in the shop since `since` (ms). Step counts include parts made obsolete since
 * (the work still happened); part counts only cover current parts, which are completed once
 * every step is done.
 */
export async function getReflectionStats(
  db: Db,
  teamId: string,
  since: number,
): Promise<ReflectionStats> {
  const [instances, steps, procs, todaysActions] = await Promise.all([
    db
      .select({
        id: partInstances.id,
        isPriority: partInstances.isPriority,
        createdAt: partInstances.createdAt,
      })
      .from(partInstances)
      .where(inTeam(partInstances, teamId, eq(partInstances.isStale, 0)))
      .all(),
    db
      .select({
        partInstanceId: partInstanceProcesses.partInstanceId,
        processId: partInstanceProcesses.processId,
        status: partInstanceProcesses.status,
        completedAt: partInstanceProcesses.completedAt,
      })
      .from(partInstanceProcesses)
      .where(inTeam(partInstanceProcesses, teamId))
      .all(),
    db
      .select({ id: processes.id, name: processes.name })
      .from(processes)
      .where(inTeam(processes, teamId))
      .all(),
    db
      .select({ userId: actions.userId, createdAt: actions.createdAt })
      .from(actions)
      .where(
        inTeam(actions, teamId, eq(actions.action, "completed"), gte(actions.createdAt, since)),
      )
      .all(),
  ]);

  const stepsByInstance = new Map<number, typeof steps>();
  for (const s of steps) {
    const list = stepsByInstance.get(s.partInstanceId) ?? [];
    list.push(s);
    stepsByInstance.set(s.partInstanceId, list);
  }

  const doneToday = steps.filter(
    (s) => s.status === "done" && s.completedAt !== null && s.completedAt >= since,
  );
  const processSteps = new Map<number, number>();
  for (const s of doneToday) {
    processSteps.set(s.processId, (processSteps.get(s.processId) ?? 0) + 1);
  }
  const doneTimes = doneToday.map((s) => s.completedAt as number);

  let partsCompleted = 0;
  let partsLeft = 0;
  let priorityCompleted = 0;
  for (const inst of instances) {
    const instSteps = stepsByInstance.get(inst.id) ?? [];
    if (instSteps.length === 0) continue;
    if (instSteps.every((s) => s.status === "done")) {
      const finishedAt = Math.max(...instSteps.map((s) => s.completedAt ?? 0));
      if (finishedAt >= since) {
        partsCompleted++;
        if (inst.isPriority) priorityCompleted++;
      }
    } else {
      partsLeft++;
    }
  }

  const procName = new Map(procs.map((p) => [p.id, p.name]));
  const byProcess = [...processSteps]
    .map(([id, n]) => ({ name: procName.get(id) ?? `Process #${id}`, steps: n }))
    .sort((a, b) => b.steps - a.steps);

  const userSteps = new Map<string, number>();
  for (const a of todaysActions) userSteps.set(a.userId, (userSteps.get(a.userId) ?? 0) + 1);
  const byUser = [...userSteps]
    .map(([userId, n]) => ({ userId, steps: n }))
    .sort((a, b) => b.steps - a.steps);

  return {
    partsCompleted,
    partsLeft,
    stepsCompleted: doneToday.length,
    priorityCompleted,
    partsAdded: instances.filter((i) => i.createdAt >= since).length,
    byProcess,
    byUser,
    firstAt: doneTimes.length ? Math.min(...doneTimes) : null,
    lastAt: doneTimes.length ? Math.max(...doneTimes) : null,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The Reflection message: today's counts, then a few generated lines on what happened. */
export function formatReflection(
  stats: ReflectionStats,
  opts: { dayLabel: string; timeZone: string; names: Map<string, string> },
): string {
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-US", {
      timeZone: opts.timeZone,
      hour: "numeric",
      minute: "2-digit",
    });

  const lines = [
    `*Shop reflection for ${opts.dayLabel}*`,
    `:white_check_mark: *${stats.partsCompleted}* ${stats.partsCompleted === 1 ? "part" : "parts"} completed today  ·  *${stats.partsLeft}* left to do`,
  ];

  if (stats.stepsCompleted === 0) {
    lines.push("", "Quiet day in the shop — no process steps were finished.");
    if (stats.partsAdded > 0) lines.push(`• ${plural(stats.partsAdded, "new part")} added.`);
    return lines.join("\n");
  }

  const reflection = [`${plural(stats.stepsCompleted, "process step")} finished.`];

  const [busiest, runnerUp] = stats.byProcess;
  if (busiest) {
    const then = runnerUp ? `, then ${runnerUp.name} (${runnerUp.steps})` : "";
    reflection.push(`Busiest process: ${busiest.name} (${plural(busiest.steps, "step")})${then}.`);
  }

  const top = stats.byUser
    .slice(0, 3)
    .map(
      (u, i) =>
        `${opts.names.get(u.userId) ?? "Someone"} (${i === 0 ? plural(u.steps, "step") : u.steps})`,
    );
  if (top.length > 0) reflection.push(`Most active: ${top.join(", ")}.`);

  if (stats.byUser.length > 0 && stats.firstAt !== null && stats.lastAt !== null) {
    const span =
      stats.lastAt - stats.firstAt < 60_000
        ? `at ${time(stats.firstAt)}`
        : `from ${time(stats.firstAt)} to ${time(stats.lastAt)}`;
    const people = stats.byUser.length;
    reflection.push(`${people} ${people === 1 ? "person" : "people"} logged work ${span}.`);
  }

  if (stats.priorityCompleted > 0) {
    reflection.push(`${plural(stats.priorityCompleted, "priority part")} finished.`);
  }
  if (stats.partsAdded > 0) reflection.push(`${plural(stats.partsAdded, "new part")} added.`);

  lines.push("", ...reflection.map((l) => `• ${l}`));
  return lines.join("\n");
}

export type OverviewStats = {
  partsLeft: number;
  ready: number;
  inProgress: number;
  /** Per machine: parts ready at it, in progress there, still coming, and the oldest wait. */
  byProcess: {
    name: string;
    ready: number;
    inProgress: number;
    upcoming: number;
    oldestReadySince: number | null;
  }[];
  /** Where each open priority part currently is. */
  priorityAt: string[];
};

/**
 * Overview: the shop right now. Each current part is at its first unfinished step. A part has
 * been waiting there since its previous step finished (or since it was created).
 */
export async function getOverviewStats(db: Db, teamId: string): Promise<OverviewStats> {
  const [instances, steps, procs] = await Promise.all([
    db
      .select({
        id: partInstances.id,
        isPriority: partInstances.isPriority,
        createdAt: partInstances.createdAt,
      })
      .from(partInstances)
      .where(inTeam(partInstances, teamId, eq(partInstances.isStale, 0)))
      .all(),
    db
      .select({
        partInstanceId: partInstanceProcesses.partInstanceId,
        processId: partInstanceProcesses.processId,
        index: partInstanceProcesses.index,
        status: partInstanceProcesses.status,
        completedAt: partInstanceProcesses.completedAt,
      })
      .from(partInstanceProcesses)
      .where(inTeam(partInstanceProcesses, teamId))
      .all(),
    db
      .select({ id: processes.id, name: processes.name })
      .from(processes)
      .where(inTeam(processes, teamId))
      .all(),
  ]);

  const stepsByInstance = new Map<number, typeof steps>();
  for (const s of steps) {
    const list = stepsByInstance.get(s.partInstanceId) ?? [];
    list.push(s);
    stepsByInstance.set(s.partInstanceId, list);
  }

  type Load = {
    ready: number;
    inProgress: number;
    upcoming: number;
    oldestReadySince: number | null;
  };
  const load = new Map<number, Load>();
  const loadFor = (processId: number) => {
    let l = load.get(processId);
    if (!l) {
      l = { ready: 0, inProgress: 0, upcoming: 0, oldestReadySince: null };
      load.set(processId, l);
    }
    return l;
  };
  const procName = new Map(procs.map((p) => [p.id, p.name]));
  const nameOf = (id: number) => procName.get(id) ?? `Process #${id}`;

  let partsLeft = 0;
  let ready = 0;
  let inProgress = 0;
  const priorityAt: string[] = [];

  for (const inst of instances) {
    const instSteps = (stepsByInstance.get(inst.id) ?? []).sort((a, b) => a.index - b.index);
    const currentIdx = instSteps.findIndex((s) => s.status !== "done");
    if (currentIdx === -1) continue;
    partsLeft++;
    const current = instSteps[currentIdx];
    const l = loadFor(current.processId);
    if (current.status === "doing") {
      inProgress++;
      l.inProgress++;
    } else {
      ready++;
      l.ready++;
      const since = instSteps[currentIdx - 1]?.completedAt ?? inst.createdAt;
      if (l.oldestReadySince === null || since < l.oldestReadySince) l.oldestReadySince = since;
    }
    for (const later of instSteps.slice(currentIdx + 1)) loadFor(later.processId).upcoming++;
    if (inst.isPriority) priorityAt.push(nameOf(current.processId));
  }

  const byProcess = [...load]
    .map(([id, l]) => ({ name: nameOf(id), ...l }))
    .sort((a, b) => b.ready + b.inProgress - (a.ready + a.inProgress) || b.upcoming - a.upcoming);

  return { partsLeft, ready, inProgress, byProcess, priorityAt };
}

function waitLabel(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

/** The Overview message: what's left, the machines that need the most help, and where parts are stuck. */
export function formatOverview(
  stats: OverviewStats,
  opts: { dayLabel: string; now: number },
): string {
  const lines = [
    `*Shop overview for ${opts.dayLabel}*`,
    `:clipboard: *${stats.partsLeft}* ${stats.partsLeft === 1 ? "part" : "parts"} left to do  ·  *${stats.ready}* ready to work on  ·  *${stats.inProgress}* in progress`,
  ];
  if (stats.partsLeft === 0) {
    lines.push("", "Nothing in the queue — every part is done.");
    return lines.join("\n");
  }

  const overview: string[] = [];

  const busy = stats.byProcess.filter((p) => p.ready + p.inProgress > 0).slice(0, 3);
  if (busy.length > 0) {
    const describe = (p: (typeof busy)[number]) => {
      const parts = [
        p.ready > 0 && `${p.ready} ready`,
        p.inProgress > 0 && `${p.inProgress} in progress`,
      ].filter(Boolean);
      return `${p.name} (${parts.join(", ")})`;
    };
    overview.push(`Machines that will need the most help: ${busy.map(describe).join(", ")}.`);
  }

  const stuck = stats.byProcess
    .filter((p) => p.oldestReadySince !== null)
    .sort((a, b) => (a.oldestReadySince as number) - (b.oldestReadySince as number))
    .slice(0, 2)
    .filter((p) => opts.now - (p.oldestReadySince as number) >= 24 * 3_600_000);
  if (stuck.length > 0) {
    const describe = (p: (typeof stuck)[number]) =>
      `${p.name} (a part has waited ${waitLabel(opts.now - (p.oldestReadySince as number))})`;
    overview.push(`Parts are stuck longest at ${stuck.map(describe).join(" and ")}.`);
  }

  if (stats.priorityAt.length > 0) {
    const counts = new Map<string, number>();
    for (const at of stats.priorityAt) counts.set(at, (counts.get(at) ?? 0) + 1);
    const where = [...counts].map(([name, n]) => (n > 1 ? `${name} (${n})` : name)).join(", ");
    overview.push(`${plural(stats.priorityAt.length, "priority part")} still open — at ${where}.`);
  }

  const upcoming = stats.byProcess
    .filter((p) => p.upcoming > 0)
    .sort((a, b) => b.upcoming - a.upcoming);
  if (upcoming[0]) {
    overview.push(
      `Coming up: ${upcoming[0].name} has ${plural(upcoming[0].upcoming, "more part")} on the way from earlier steps.`,
    );
  }

  lines.push("", ...overview.map((l) => `• ${l}`));
  return lines.join("\n");
}
