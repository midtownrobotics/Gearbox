import { env } from "cloudflare:test";
import { SITE_TEAM, newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { drawingKey } from "../src/lib/storage";
import { eventually, onshapeEvent } from "./onshape";

// What each team has of its own in Shop (roadmap Phase 3): its lists (including the ones that are
// only numbers, which the isolation test's markers can't see), its files under its own R2 prefix,
// its Onshape keys and webhook, and its Slack posts.

const database = (env as unknown as { SHOP_DB: D1Database }).SHOP_DB;
const bucket = (env as unknown as { DRAWINGS: R2Bucket }).DRAWINGS;
const g3id = (env as unknown as { G3ID: Fetcher }).G3ID;

type Id = { id: number };

/** A team with a part in production: two instances, one started, and a file on one. */
async function shopWithWork() {
  const team = teamUsers(newTeamId());
  const { student } = team;
  const subsystem = await jsonAs<Id>(
    student,
    "/subsystems",
    { method: "POST", body: { name: "Drive" } },
    201,
  );
  const process = await jsonAs<Id>(
    student,
    "/processes",
    { method: "POST", body: { name: "Mill" } },
    201,
  );
  const partNumber = `PN-${crypto.randomUUID().slice(0, 8)}`;
  const part = await jsonAs<Id>(
    student,
    "/part-definitions",
    {
      method: "POST",
      body: {
        onshapePartNumber: partNumber,
        revision: "A",
        subsystemId: subsystem.id,
        name: "Bracket",
        processIds: [process.id],
      },
    },
    201,
  );
  const instances = await jsonAs<Id[]>(
    student,
    "/part-instances",
    { method: "POST", body: { partDefinitionId: part.id, quantity: 2 } },
    201,
  );
  await jsonAs(
    student,
    `/part-instance-processes/${instances[0].id}/processes/${process.id}/done`,
    {
      method: "POST",
    },
  );
  const form = new FormData();
  form.set("file", new File(["G-code"], "bracket.nc", { type: "text/plain" }));
  const file = await jsonAs<Id>(student, "/part-files", { method: "POST", body: form }, 201);
  await jsonAs(team.kioskAdmin, "/kiosk-presence/heartbeat", { method: "POST" });
  await bucket.put(drawingKey(team.teamId, partNumber, "A"), "%PDF");
  return { team, part, process, instances, file, partNumber };
}

describe("a team's lists", () => {
  it("hold only its own rows, numbers included", async () => {
    const a = await shopWithWork();
    const b = await shopWithWork();
    const ids = async (path: string) =>
      (await jsonAs<{ id: number }[]>(a.team.student, path)).map((r) => r.id);

    expect(await ids("/part-instances")).toEqual(
      expect.arrayContaining(a.instances.map((i) => i.id)),
    );
    expect(await ids("/part-instances")).not.toContain(b.instances[0].id);
    const steps = await jsonAs<{ partInstanceId: number }[]>(
      a.team.student,
      `/part-instance-processes?processId=${b.process.id}`,
    );
    expect(steps).toEqual([]);
    expect(await ids("/part-files")).toEqual([a.file.id]);
    const actions = await jsonAs<{ partInstanceId: number }[]>(a.team.student, "/actions");
    expect(actions.map((x) => x.partInstanceId)).toEqual([a.instances[0].id]);
    const presence = await jsonAs<{ kioskDeviceId: number }[]>(a.team.student, "/kiosk-presence");
    expect(presence).toHaveLength(1);
    const drawings = await jsonAs<{ drawings: { partNumber: string }[] }>(
      a.team.student,
      "/drawings",
    );
    expect(drawings.drawings.map((d) => d.partNumber)).toEqual([a.partNumber]);
  });

  it("keep a kiosk's presence per team, even with the same device id", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    // The test users' kiosks are both device 1.
    await jsonAs(a.kioskAdmin, "/kiosk-presence/heartbeat", { method: "POST" });
    await jsonAs(b.kioskAdmin, "/kiosk-presence/heartbeat", { method: "POST" });
    expect(await jsonAs<unknown[]>(a.student, "/kiosk-presence")).toHaveLength(1);
    expect(await jsonAs<unknown[]>(b.student, "/kiosk-presence")).toHaveLength(1);
  });
});

describe("files in R2", () => {
  it("go under the team's own prefix", async () => {
    const { team, file } = await shopWithWork();
    const row = await database
      .prepare("SELECT r2_key FROM files WHERE id = ?")
      .bind(file.id)
      .first<{ r2_key: string }>();
    expect(row?.r2_key.startsWith(`teams/${team.teamId}/part-files/`)).toBe(true);
    expect(await bucket.head(row?.r2_key as string)).not.toBeNull();
  });
});

describe("Onshape", () => {
  it("keeps each team's keys to itself, encrypted, and never sends them back", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    await jsonAs(a.admin, "/admin/onshape/config", {
      method: "POST",
      body: { documentId: "docA", webhookKeyPrimary: "a-secret-key", apiKey: "a-api-key" },
    });
    const mine = await jsonAs<Record<string, unknown>>(a.admin, "/admin/onshape/config");
    expect(mine).toMatchObject({
      documentId: "docA",
      hasWebhookKeys: true,
      fromWorkerSecrets: false,
    });
    expect(JSON.stringify(mine)).not.toContain("a-secret-key");
    expect(mine.webhookUrl).toBe(
      `https://${a.teamId.replace("frc", "")}-shop.frcgearbox.com/api/onshape/events`,
    );
    expect(await jsonAs(b.admin, "/admin/onshape/config")).toMatchObject({
      documentId: "",
      hasApiKey: false,
      hasWebhookKeys: false,
    });
    const stored = await database
      .prepare("SELECT value FROM admin_settings WHERE team_id = ? AND key = ?")
      .bind(a.teamId, "onshape_webhook_key_primary")
      .first<{ value: string }>();
    expect(stored?.value).toBeTruthy();
    expect(stored?.value).not.toContain("a-secret-key");
    // Only admins, never from a kiosk.
    expect((await callAs(a.mentor, "/admin/onshape/config")).status).toBe(403);
    expect((await callAs(a.kioskAdmin, "/admin/onshape/config")).status).toBe(403);
  });

  it("takes a team's webhook events only when signed with that team's key", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    for (const [team, key] of [
      [a, "key-a"],
      [b, "key-b"],
    ] as const) {
      await jsonAs(team.admin, "/admin/onshape/config", {
        method: "POST",
        body: { documentId: "doc", webhookKeyPrimary: key },
      });
    }
    const event = (partNumber: string) => ({
      event: "onshape.revision.created",
      elementType: 0,
      elementId: "el",
      partNumber,
      releaseId: "rel",
      versionId: "ver",
    });
    const parts = (teamId: string) =>
      database
        .prepare("SELECT part_number AS n FROM onshape_parts WHERE team_id = ? ORDER BY n")
        .bind(teamId)
        .all<{ n: string }>()
        .then((r) => r.results.map((x) => x.n));

    // Signed with A's key but sent to B's address: B doesn't believe it.
    await onshapeEvent(b.teamId, "key-a", event("FORGED"));
    await onshapeEvent(b.teamId, "key-b", event("REAL"));
    await eventually(async () => (await parts(b.teamId)).length > 0);
    expect(await parts(b.teamId)).toEqual(["REAL"]);
    expect(await parts(a.teamId)).toEqual([]);
    // The same release and part number in two teams are two rows.
    await onshapeEvent(a.teamId, "key-a", event("REAL"));
    await eventually(async () => (await parts(a.teamId)).length > 0);
    expect(await parts(a.teamId)).toEqual(["REAL"]);
  });

  it("uses the site team's keys from before teams until it saves its own", async () => {
    const res = await onshapeEvent(SITE_TEAM, "site-webhook-key", {
      event: "onshape.revision.created",
      elementType: 0,
      elementId: "el",
      partNumber: "SITE-PART",
      releaseId: `rel-${crypto.randomUUID()}`,
      versionId: "ver",
    });
    expect(res.status).toBe(200);
    await eventually(() =>
      database
        .prepare("SELECT id FROM onshape_parts WHERE team_id = ? AND part_number = 'SITE-PART'")
        .bind(SITE_TEAM)
        .first(),
    );
    // Another team never gets them.
    const other = teamUsers(newTeamId());
    await onshapeEvent(other.teamId, "site-webhook-key", {
      event: "onshape.revision.created",
      elementType: 0,
      elementId: "el",
      partNumber: "NOT-MINE",
      releaseId: "rel",
      versionId: "ver",
    });
    await new Promise((r) => setTimeout(r, 100));
    const leaked = await database
      .prepare("SELECT id FROM onshape_parts WHERE team_id = ?")
      .bind(other.teamId)
      .first();
    expect(leaked).toBeNull();
  });
});

describe("Slack", () => {
  it("posts the daily summary on the team's own Slack", async () => {
    const { team } = await shopWithWork();
    await jsonAs(team.admin, "/admin/slack/config", {
      method: "POST",
      body: { slackReleaseChannelId: "CREL", slackSummaryChannelId: "CSUM" },
    });
    await jsonAs(team.admin, "/admin/slack/daily-summary", {
      method: "POST",
      body: { kind: "overview", since: Date.now() - 60_000 },
    });
    const sent = (await (
      await g3id.fetch(`http://g3id/api/internal/teams/${team.teamId}/slack/messages`)
    ).json()) as { channel: string; text: string }[];
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe("CSUM");
  });
});
