// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { call, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { MAX_PENDING_LOGS, UPLOAD_TTL } from "../src/match-logs";

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
