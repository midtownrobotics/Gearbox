// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs } from "@g3/testing/worker";
import { afterEach, expect, it, vi } from "vitest";
import { createShopDb } from "../src/db";
import { type BOMQueueMessage, processBOMQueue } from "../src/lib/bom-queue-consumer";
import { processReleaseEvent } from "../src/lib/onshape-webhook";
import type { AppEnv } from "../src/types";
import { eventually, onshapeEvent } from "./onshape";

// Onshape sends a team's webhook the release events of every document in its company. Shop keeps
// only the releases of the document its admins set up.

const database = (env as unknown as { SHOP_DB: D1Database }).SHOP_DB;

afterEach(() => vi.unstubAllGlobals());

/** Answers Onshape's API: the release package says which document it's from. */
function onshapeReleasesFrom(documentId: string, partNumber: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/releasepackages/")) {
        return Response.json({
          name: "Release",
          documentId,
          versionId: "ver1",
          items: [
            {
              elementType: 0,
              elementId: "el1",
              versionId: "ver1",
              properties: [{ name: "Part number", value: partNumber }],
            },
          ],
        });
      }
      return Response.json({ items: [] });
    }),
  );
}

async function teamFollowing(documentId: string) {
  const team = teamUsers(newTeamId());
  const key = `key-${crypto.randomUUID().slice(0, 8)}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ items: [], id: "hook" })),
  );
  const saved = await callAs(team.admin, "/admin/onshape/config", {
    method: "POST",
    body: {
      documentId,
      companyId: "co1",
      apiKey: "api-key",
      apiSecret: "api-secret",
      webhookKeyPrimary: key,
    },
  });
  expect(saved.status).toBe(200);
  return { team, key };
}

async function releaseRow(teamId: string, releaseId: string) {
  const row = await database
    .prepare(
      "INSERT INTO onshape_releases (team_id, release_id, timestamp, created_at) VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(teamId, releaseId, new Date().toISOString(), Math.floor(Date.now() / 1000))
    .first<{ id: number }>();
  return row?.id as number;
}

const partsOf = (teamId: string) =>
  database
    .prepare("SELECT part_number AS n FROM onshape_parts WHERE team_id = ? ORDER BY n")
    .bind(teamId)
    .all<{ n: string }>()
    .then((r) => r.results.map((p) => p.n));

it("drops a revision event from another document", async () => {
  const { team, key } = await teamFollowing("doc-ours");
  const revision = (documentId: string, partNumber: string) =>
    onshapeEvent(team.teamId, key, {
      event: "onshape.revision.created",
      documentId,
      elementType: 0,
      elementId: "el",
      partNumber,
      releaseId: `rel-${partNumber}`,
      versionId: "ver",
    });
  await revision("doc-other", "THEIRS");
  await revision("doc-ours", "OURS");
  await eventually(async () => (await partsOf(team.teamId)).includes("OURS"));
  expect(await partsOf(team.teamId)).toEqual(["OURS"]);
});

/** The queue the release events go to, keeping what's sent. */
function queue() {
  const sent: BOMQueueMessage[] = [];
  return { sent, send: async (m: BOMQueueMessage) => void sent.push(m) } as unknown as Queue & {
    sent: BOMQueueMessage[];
  };
}

it("follows a release only once a revision from the team's document records it", async () => {
  const { team, key } = await teamFollowing("doc-ours");
  const ours = `rel-${crypto.randomUUID()}`;
  const theirs = `rel-${crypto.randomUUID()}`;
  for (const [documentId, releaseId] of [
    ["doc-ours", ours],
    ["doc-other", theirs],
  ]) {
    await onshapeEvent(team.teamId, key, {
      event: "onshape.revision.created",
      documentId,
      elementType: 0,
      elementId: "el",
      partNumber: `PN-${releaseId}`,
      releaseId,
      versionId: "ver",
      timestamp: new Date().toISOString(),
    });
  }
  await eventually(() =>
    database
      .prepare("SELECT id FROM onshape_releases WHERE team_id = ? AND release_id = ?")
      .bind(team.teamId, ours)
      .first(),
  );

  const db = createShopDb(database);
  const jobs = queue();
  const at = new Date().toISOString();
  await processReleaseEvent(db, team.teamId, theirs, at, jobs, 0);
  await processReleaseEvent(db, team.teamId, ours, at, jobs, 0);

  expect(jobs.sent.map((m) => m.releaseId)).toEqual([ours]);
  const releases = await database
    .prepare("SELECT release_id AS id, document_id AS doc FROM onshape_releases WHERE team_id = ?")
    .bind(team.teamId)
    .all<{ id: string; doc: string }>();
  expect(releases.results).toEqual([{ id: ours, doc: "doc-ours" }]);
  // Nothing was asked of Onshape for either release.
  const asked = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
    String(c[0] instanceof Request ? c[0].url : c[0]),
  );
  expect(asked.filter((u) => u.includes("releasepackages"))).toEqual([]);
});

it("keeps a release of the team's document", async () => {
  const { team } = await teamFollowing("doc-ours");
  const releaseId = `rel-${crypto.randomUUID()}`;
  const rowId = await releaseRow(team.teamId, releaseId);

  onshapeReleasesFrom("doc-ours", "OURS");
  await processBOMQueue(
    { teamId: team.teamId, releaseId, releaseRowId: rowId, timestamp: new Date().toISOString() },
    env as unknown as AppEnv["Bindings"],
  );

  expect(await partsOf(team.teamId)).toEqual(["OURS"]);
});
