import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { eventually, onshapeEvent } from "./onshape";

// Where the File Producer view sends someone who clicks a part name: the part in the team's own
// Onshape document, and the release it came from. Nothing is stored, so both are built from the
// ids a release leaves behind.

const database = (env as unknown as { SHOP_DB: D1Database }).SHOP_DB;

type Link = { partNumber: string; revision: string | null; part: string | null; release: string };

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
  expect(link?.release).toBe(`https://cad.onshape.com/documents?releasepackage=rel${tag}`);
});

it("still gives the release when a release left no part to point at", async () => {
  const { team, tag, partNumber } = await teamWithRelease(2);
  const { links } = await jsonAs<{ links: Link[] }>(team.student, "/onshape/links");
  const link = links.find((l) => l.partNumber === partNumber);
  expect(link?.part).toBeNull();
  expect(link?.release).toBe(`https://cad.onshape.com/documents?releasepackage=rel${tag}`);
});

it("serves kiosk sessions, which are what the shop floor runs on", async () => {
  const { team, partNumber } = await teamWithRelease(0);
  const { links } = await jsonAs<{ links: Link[] }>(team.kioskAdmin, "/onshape/links");
  expect(links.some((l) => l.partNumber === partNumber)).toBe(true);
});
