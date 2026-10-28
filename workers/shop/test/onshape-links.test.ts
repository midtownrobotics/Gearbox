import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { eventually, onshapeEvent } from "./onshape";

// Where the File Producer view sends someone who clicks a part name: the part in the team's own
// Onshape document, and the release it came from. Nothing is stored, so both are built from the
// ids a release leaves behind.

const database = (env as unknown as { SHOP_DB: D1Database }).SHOP_DB;

type Link = {
  partNumber: string;
  revision: string | null;
  part: string | null;
  releaseId: string;
  release: string;
};

/**
 * A team whose Onshape has released one part, with the ids that release left behind.
 * `elementType` is Onshape's: 0 a part, 2 a drawing.
 */
async function teamWithRelease(elementType: number) {
  const team = teamUsers(newTeamId());
  const tag = crypto.randomUUID().slice(0, 8);
  const partNumber = `PN-${tag}`;
  const key = `key-${tag}`;
  await jsonAs(team.admin, "/admin/onshape/config", {
    method: "POST",
    body: { documentId: "doc-abc", webhookKeyPrimary: key },
  });
  const event = await onshapeEvent(team.teamId, key, {
    event: "onshape.revision.created",
    elementType,
    elementId: `el${tag}`,
    partNumber,
    releaseId: `rel${tag}`,
    versionId: `ver${tag}`,
  });
  expect(event.status).toBe(200);
  await eventually(() =>
    database
      .prepare("SELECT id FROM onshape_parts WHERE team_id = ? AND part_number = ?")
      .bind(team.teamId, partNumber)
      .first(),
  );
  return { team, tag, partNumber };
}

it("gives a released part its place in Onshape and its release", async () => {
  const { team, tag, partNumber } = await teamWithRelease(0);
  const { links } = await jsonAs<{ links: Link[] }>(team.student, "/onshape/links");
  const link = links.find((l) => l.partNumber === partNumber);
  expect(link?.part).toBe(`https://cad.onshape.com/documents/doc-abc/v/ver${tag}/e/el${tag}`);
  expect(link?.releaseId).toBe(`rel${tag}`);
  expect(link?.release).toBe(`https://cad.onshape.com/documents?releasepackage=rel${tag}`);
});

it("still gives the release when a release left no part to point at", async () => {
  const { team, tag, partNumber } = await teamWithRelease(2);
  const { links } = await jsonAs<{ links: Link[] }>(team.student, "/onshape/links");
  const link = links.find((l) => l.partNumber === partNumber);
  expect(link?.part).toBeNull();
  expect(link?.release).toBe(`https://cad.onshape.com/documents?releasepackage=rel${tag}`);
});

type Release = {
  releaseId: string;
  parts: { partNumber: string; revision: string | null; obsolete: boolean }[];
};

/** A release as the queue job leaves it, with its parts as [part number, revision]. */
async function storeRelease(
  teamId: string,
  releaseId: string,
  timestamp: string,
  parts: [string, string | null][],
) {
  const release = await database
    .prepare(
      "INSERT INTO onshape_releases (team_id, release_id, timestamp, created_at) VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(teamId, releaseId, timestamp, Date.now())
    .first<{ id: number }>();
  for (const [partNumber, revision] of parts) {
    await database
      .prepare(
        "INSERT INTO onshape_parts (team_id, onshape_release_id, release_id, part_number, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(teamId, releaseId, release?.id, partNumber, revision, Date.now())
      .run();
  }
}

it("marks a part obsolete once a later release holds it at another revision", async () => {
  const team = teamUsers(newTeamId());
  await storeRelease(team.teamId, "first", "2026-01-01T12:00:00.000Z", [
    ["PLATE", "A"],
    ["SHAFT", "A"],
    ["GUSSET", "A"],
  ]);
  await storeRelease(team.teamId, "second", "2026-02-01T12:00:00.000Z", [
    ["PLATE", "B"],
    ["SHAFT", "A"],
  ]);

  const { releases } = await jsonAs<{ releases: Release[] }>(team.student, "/onshape/releases");
  expect(releases.map((r) => r.releaseId)).toEqual(["second", "first"]);
  const obsolete = (release: Release) =>
    Object.fromEntries(release.parts.map((p) => [p.partNumber, p.obsolete]));
  expect(obsolete(releases[0])).toEqual({ PLATE: false, SHAFT: false });
  // The shaft was released again at the revision it already had, so that one still stands.
  expect(obsolete(releases[1])).toEqual({ PLATE: true, SHAFT: false, GUSSET: false });
});

it("serves kiosk sessions, which are what the shop floor runs on", async () => {
  const { team, partNumber } = await teamWithRelease(0);
  const { links } = await jsonAs<{ links: Link[] }>(team.kioskAdmin, "/onshape/links");
  expect(links.some((l) => l.partNumber === partNumber)).toBe(true);
});
