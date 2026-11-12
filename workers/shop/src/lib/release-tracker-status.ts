import { inTeam } from "@g3/auth";
import { and, eq, inArray } from "drizzle-orm";
import type { createShopDb } from "../db";
import * as schema from "../db/schema";
import type { PartStatus } from "./release-tracker-feature";

// How far a released part is in the shop, for the release tracker's colors. It's about the
// revision Onshape released last: a newer revision still on Ingest is Not started, even when an
// older one was made.

type ShopDb = ReturnType<typeof createShopDb>;
type StepStatus = (typeof schema.partInstanceProcesses.$inferSelect)["status"];

/**
 * The status of a part from its live instances' steps (obsolete instances left out): Complete when
 * there's at least one step and every one is done, In progress when any is started or done, else
 * Not started (also when it isn't ingested yet, or has no steps).
 */
export function statusOfSteps(steps: StepStatus[]): PartStatus {
  if (steps.length === 0) return "NOT_STARTED";
  if (steps.every((s) => s === "done")) return "COMPLETE";
  if (steps.some((s) => s === "doing" || s === "done")) return "IN_PROGRESS";
  return "NOT_STARTED";
}

export const releasedKey = (partNumber: string, revision: string | null) =>
  `${partNumber}\n${revision ?? ""}`;

/**
 * Each released part's status, by `releasedKey`. A part definition with the same part number and
 * revision counts; one without a revision (from before revisions were kept) counts when there's
 * none with it.
 */
export async function releasedStatuses(
  db: ShopDb,
  teamId: string,
  parts: { partNumber: string; revision: string | null }[],
): Promise<Map<string, PartStatus>> {
  const d = schema.partDefinitions;
  const i = schema.partInstances;
  const s = schema.partInstanceProcesses;
  const numbers = [...new Set(parts.map((p) => p.partNumber))];
  const rows: {
    partNumber: string;
    revision: string | null;
    instanceId: number | null;
    status: StepStatus | null;
  }[] = [];
  // D1 allows 100 bound parameters a statement.
  for (let n = 0; n < numbers.length; n += 80) {
    rows.push(
      ...(await db
        .select({
          partNumber: d.onshapePartNumber,
          revision: d.revision,
          instanceId: i.id,
          status: s.status,
        })
        .from(d)
        .leftJoin(i, and(eq(i.partDefinitionId, d.id), eq(i.isStale, 0)))
        .leftJoin(s, eq(s.partInstanceId, i.id))
        .where(
          inTeam(
            d,
            teamId,
            eq(d.isObsolete, 0),
            inArray(d.onshapePartNumber, numbers.slice(n, n + 80)),
          ),
        )
        .all()),
    );
  }

  const steps = new Map<string, StepStatus[]>();
  for (const row of rows) {
    const key = releasedKey(row.partNumber, row.revision);
    const list = steps.get(key) ?? [];
    if (row.status) list.push(row.status);
    steps.set(key, list);
  }

  const statuses = new Map<string, PartStatus>();
  for (const { partNumber, revision } of parts) {
    const own = steps.get(releasedKey(partNumber, revision));
    const unrevised = steps.get(releasedKey(partNumber, null));
    statuses.set(releasedKey(partNumber, revision), statusOfSteps(own ?? unrevised ?? []));
  }
  return statuses;
}
