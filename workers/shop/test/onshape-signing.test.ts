// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { eventually, onshapeEvent } from "./onshape";

// Onshape signs a team's events only with the signing keys in its company settings, and sends the
// secondary signature only when there's a secondary key. When events are dropped, admins are told
// why (`webhookProblem` on /onshape/status).

const database = (env as unknown as { SHOP_DB: D1Database }).SHOP_DB;

type Status = { webhookProblem: { kind: string; at: number } | null };

const revision = (partNumber: string) => ({
  event: "onshape.revision.created",
  elementType: 0,
  elementId: "el",
  partNumber,
  releaseId: `rel-${crypto.randomUUID()}`,
  versionId: "ver",
});

const partsOf = (teamId: string) =>
  database
    .prepare("SELECT part_number AS n FROM onshape_parts WHERE team_id = ? ORDER BY n")
    .bind(teamId)
    .all<{ n: string }>()
    .then((r) => r.results.map((p) => p.n));

async function teamWithKey(key: string | null) {
  const team = teamUsers(newTeamId());
  await jsonAs(team.admin, "/admin/onshape/config", {
    method: "POST",
    body: { documentId: "doc", ...(key && { webhookKeyPrimary: key }) },
  });
  return team;
}

const problemOf = async (team: ReturnType<typeof teamUsers>) =>
  (await jsonAs<Status>(team.admin, "/onshape/status")).webhookProblem?.kind ?? null;

describe("Onshape webhook signatures", () => {
  it("takes an event signed with only the primary key", async () => {
    const team = await teamWithKey("only-primary");
    await onshapeEvent(team.teamId, "only-primary", revision("PRIMARY-ONLY"), "primary");
    await eventually(async () => (await partsOf(team.teamId)).length > 0);
    expect(await partsOf(team.teamId)).toEqual(["PRIMARY-ONLY"]);
    expect(await problemOf(team)).toBeNull();
  });

  it("tells admins when events come unsigned, and stops once one is signed", async () => {
    const team = await teamWithKey("the-key");
    await onshapeEvent(team.teamId, "the-key", revision("UNSIGNED"), "none");
    expect(await problemOf(team)).toBe("unsigned");
    expect(await partsOf(team.teamId)).toEqual([]);
    // Members other than admins aren't told: anyone can post to the address.
    const asStudent = await jsonAs<Status>(team.student, "/onshape/status");
    expect(asStudent.webhookProblem).toBeNull();

    await onshapeEvent(team.teamId, "the-key", revision("SIGNED"));
    await eventually(async () => (await partsOf(team.teamId)).length > 0);
    expect(await problemOf(team)).toBeNull();
  });

  it("tells admins when events are signed with other keys, or none are saved", async () => {
    const wrong = await teamWithKey("saved-key");
    await onshapeEvent(wrong.teamId, "other-key", revision("WRONG"));
    expect(await problemOf(wrong)).toBe("wrong keys");

    const none = await teamWithKey(null);
    await onshapeEvent(none.teamId, "any-key", revision("NO-KEYS"));
    expect(await problemOf(none)).toBe("no keys");
  });

  it("keeps the first dropped event's time, and starts over when the settings are saved", async () => {
    const team = await teamWithKey("the-key");
    await onshapeEvent(team.teamId, "the-key", revision("A"), "none");
    const first = (await jsonAs<Status>(team.admin, "/onshape/status")).webhookProblem;
    await new Promise((r) => setTimeout(r, 5));
    await onshapeEvent(team.teamId, "the-key", revision("B"), "none");
    const second = (await jsonAs<Status>(team.admin, "/onshape/status")).webhookProblem;
    expect(second?.at).toBe(first?.at);

    await jsonAs(team.admin, "/admin/onshape/config", {
      method: "POST",
      body: { documentId: "doc", webhookKeyPrimary: "new-key" },
    });
    expect(await problemOf(team)).toBeNull();
  });
});
