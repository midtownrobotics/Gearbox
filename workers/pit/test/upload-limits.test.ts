// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { storageRetentionCutoff } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { call, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { MAX_LOGS, MAX_PENDING_LOGS, UPLOAD_TTL } from "../src/match-logs";

const { PIT_DB: database, LOGS: bucket } = env as unknown as { PIT_DB: D1Database; LOGS: R2Bucket };

async function downloader() {
  const team = teamUsers(newTeamId());
  const { code } = await jsonAs<{ code: string }>(
    team.mentor,
    "/downloaders/codes",
    { method: "POST" },
    201,
  );
  const paired = await call("/downloaders/pair", {
    method: "POST",
    headers: { "X-Team-Id": team.teamId, "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: "Upload safety test" }),
  });
  expect(paired.status).toBe(201);
  const { key } = (await paired.json()) as { key: string };
  const headers = { "X-Team-Id": team.teamId, Authorization: `Bearer ${key}` };
  return {
    team: team.teamId,
    headers,
    start: (number: number) =>
      call("/downloader/logs", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "safety",
          name: `Qual-${number}`,
          matchType: "q",
          matchNumber: number,
          size: 5,
          rawSize: 5,
        }),
      }),
  };
}

describe("multipart storage limits", () => {
  it("does not overwrite a saved log when a downloader offers a different size", async () => {
    const client = await downloader();
    const { id } = (await (await client.start(1)).json()) as { id: number };
    const part = await (
      await call(`/downloader/logs/${id}/parts/1`, {
        method: "PUT",
        headers: client.headers,
        body: "12345",
      })
    ).json();
    expect(
      (
        await call(`/downloader/logs/${id}/complete`, {
          method: "POST",
          headers: client.headers,
          body: JSON.stringify({ parts: [part] }),
        })
      ).status,
    ).toBe(200);
    const replacement = await call("/downloader/logs", {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({
        event: "safety",
        name: "Qual-1",
        matchType: "q",
        matchNumber: 1,
        size: 6,
        rawSize: 6,
      }),
    });
    expect(replacement.status).toBe(409);
    const saved = await database
      .prepare("SELECT size, status FROM match_logs WHERE team_id = ? AND id = ?")
      .bind(client.team, id)
      .first();
    expect(saved).toMatchObject({ size: 5, status: "stored" });
    expect(
      await (await bucket.get(`pit/teams/${client.team}/logs/safety/Qual-1.wpilog.gz`))?.text(),
    ).toBe("12345");
  });
  it("keeps every log at capacity by default, even ones over six months old", async () => {
    const client = await downloader();
    for (let number = 1; number <= MAX_LOGS; number++) {
      const { id } = (await (await client.start(number)).json()) as { id: number };
      const part = await (
        await call(`/downloader/logs/${id}/parts/1`, {
          method: "PUT",
          headers: client.headers,
          body: "12345",
        })
      ).json();
      await call(`/downloader/logs/${id}/complete`, {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify({ parts: [part] }),
      });
    }
    await database
      .prepare("UPDATE match_logs SET uploaded_at = ? WHERE team_id = ?")
      .bind(storageRetentionCutoff() - 86_400_000, client.team)
      .run();
    const refused = await client.start(MAX_LOGS + 1);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "full" });
    const stored = await database
      .prepare("SELECT COUNT(*) AS count FROM match_logs WHERE team_id = ? AND status = 'stored'")
      .bind(client.team)
      .first<{ count: number }>();
    expect(stored?.count).toBe(MAX_LOGS);
  });
  it("protects recent logs at capacity, then cleans logs over six months old toward 90%", async () => {
    const client = await downloader();
    await database
      .prepare(
        "INSERT INTO settings (team_id, key, value) VALUES (?, 'matchLogsWhenFull', 'delete-oldest')",
      )
      .bind(client.team)
      .run();
    for (let number = 1; number <= MAX_LOGS; number++) {
      const started = await client.start(number);
      expect(started.status).toBe(201);
      const { id } = (await started.json()) as { id: number };
      const sent = await call(`/downloader/logs/${id}/parts/1`, {
        method: "PUT",
        headers: client.headers,
        body: "12345",
      });
      expect(sent.status).toBe(200);
      const part = await sent.json();
      const completed = await call(`/downloader/logs/${id}/complete`, {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify({ parts: [part] }),
      });
      expect(completed.status).toBe(200);
    }
    const refused = await client.start(MAX_LOGS + 1);
    expect(refused.status).toBe(409);
    const stored = await database
      .prepare("SELECT name FROM match_logs WHERE team_id = ? AND status = 'stored'")
      .bind(client.team)
      .all<{ name: string }>();
    expect(stored.results).toHaveLength(MAX_LOGS);
    expect(stored.results.some((log) => log.name === "Qual-1")).toBe(true);
    expect(stored.results.some((log) => log.name === `Qual-${MAX_LOGS}`)).toBe(true);
    const files = await bucket.list({ prefix: `pit/teams/${client.team}/logs/` });
    expect(files.objects).toHaveLength(MAX_LOGS);
    await database
      .prepare(
        "UPDATE match_logs SET uploaded_at = ? WHERE team_id = ? AND name IN ('Qual-1', 'Qual-2', 'Qual-3')",
      )
      .bind(storageRetentionCutoff() - 86_400_000, client.team)
      .run();
    const accepted = await client.start(MAX_LOGS + 1);
    expect(accepted.status).toBe(201);
    const { id } = (await accepted.json()) as { id: number };
    const part = await (
      await call(`/downloader/logs/${id}/parts/1`, {
        method: "PUT",
        headers: client.headers,
        body: "12345",
      })
    ).json();
    expect(
      (
        await call(`/downloader/logs/${id}/complete`, {
          method: "POST",
          headers: client.headers,
          body: JSON.stringify({ parts: [part] }),
        })
      ).status,
    ).toBe(200);
    const remaining = await database
      .prepare("SELECT name FROM match_logs WHERE team_id = ? AND status = 'stored'")
      .bind(client.team)
      .all<{ name: string }>();
    expect(remaining.results).toHaveLength(18);
    expect(remaining.results.some((log) => log.name === "Qual-1")).toBe(false);
    expect(remaining.results.some((log) => log.name === "Qual-4")).toBe(true);
    expect((await bucket.list({ prefix: `pit/teams/${client.team}/logs/` })).objects).toHaveLength(
      18,
    );
  });
  it("caps pending uploads even when starts arrive together", async () => {
    const client = await downloader();
    const starts = await Promise.all(
      Array.from({ length: 6 }, (_, index) => client.start(index + 1)),
    );
    expect(starts.filter((res) => res.status === 201)).toHaveLength(MAX_PENDING_LOGS);
    expect(starts.filter((res) => res.status === 409)).toHaveLength(3);
  });

  it("rejects surplus part numbers and sizes before storing the bytes", async () => {
    const client = await downloader();
    const { id } = (await (await client.start(1)).json()) as { id: number };
    for (const [part, body] of [
      [5, "12345"],
      [2, "12345"],
      [1, "123456"],
    ] as const) {
      expect(
        (
          await call(`/downloader/logs/${id}/parts/${part}`, {
            method: "PUT",
            headers: client.headers,
            body,
          })
        ).status,
      ).toBe(400);
    }
    const uploaded = await call(`/downloader/logs/${id}/parts/1`, {
      method: "PUT",
      headers: client.headers,
      body: "12345",
    });
    expect(uploaded.status).toBe(200);
    const part = await uploaded.json();
    expect(
      (
        await call(`/downloader/logs/${id}/complete`, {
          method: "POST",
          headers: client.headers,
          body: JSON.stringify({ parts: [part, part] }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`/downloader/logs/${id}/complete`, {
          method: "POST",
          headers: client.headers,
          body: JSON.stringify({ parts: [part] }),
        })
      ).status,
    ).toBe(200);
  });

  it("expires and aborts abandoned uploads so a new log can use the space", async () => {
    const client = await downloader();
    for (let i = 1; i <= MAX_PENDING_LOGS; i++) expect((await client.start(i)).status).toBe(201);
    await database
      .prepare("UPDATE match_logs SET created_at = ? WHERE team_id = ? AND status = 'uploading'")
      .bind(Date.now() - UPLOAD_TTL - 1, client.team)
      .run();
    expect((await client.start(4)).status).toBe(201);
    const pending = await database
      .prepare("SELECT id FROM match_logs WHERE team_id = ? AND status = 'uploading'")
      .bind(client.team)
      .all();
    expect(pending.results).toHaveLength(1);
  });

  it("checks actual completed size against the reservation", async () => {
    const client = await downloader();
    const { id } = (await (await client.start(1)).json()) as { id: number };
    const log = await database
      .prepare("SELECT r2_key, upload_id FROM match_logs WHERE team_id = ? AND id = ?")
      .bind(client.team, id)
      .first<{ r2_key: string; upload_id: string }>();
    if (!log) throw new Error("Missing upload row");
    const part = await bucket
      .resumeMultipartUpload(log.r2_key, log.upload_id)
      .uploadPart(1, new Uint8Array(4));
    expect(
      (
        await call(`/downloader/logs/${id}/complete`, {
          method: "POST",
          headers: client.headers,
          body: JSON.stringify({ parts: [part] }),
        })
      ).status,
    ).toBe(413);
    expect(await bucket.head(log.r2_key)).toBeNull();
  });
});
