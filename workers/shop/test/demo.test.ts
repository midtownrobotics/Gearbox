import { env } from "cloudflare:test";
import { demoTeamId } from "@g3/site-config";
import { checkDemoHook } from "@g3/testing/demo";
import { teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { drawingKey } from "../src/lib/storage";

// The public demo's Shop (roadmap 5.3): parts partway through production, two batches, a required
// quality check with reports, and a release waiting on Ingest, each part with a stand-in drawing.

const drawings = (env as unknown as { DRAWINGS: R2Bucket }).DRAWINGS;
type Pending = { parts: { partNumber: string; revision: string }[] };

describe("the demo's sample data", () => {
  it("loads, reloads after a reset, and is only for the demo team", async () => {
    await checkDemoHook(async () => {
      const res = await call(`/internal/teams/${demoTeamId}/export`);
      const { tables } = (await res.json()) as { tables: { part_instances?: unknown[] } };
      return tables.part_instances?.length ?? 0;
    });
  });

  it("has a release waiting on Ingest, with drawings", async () => {
    const { admin } = teamUsers(demoTeamId);
    await call(`/internal/teams/${demoTeamId}`, { method: "DELETE" });
    await call(`/internal/teams/${demoTeamId}/demo`, { method: "POST" });
    const pending = await jsonAs<Pending>(admin, "/admin/parts/pending");
    expect(pending.parts).toHaveLength(3);
    for (const part of pending.parts) {
      const pdf = await drawings.get(drawingKey(demoTeamId, part.partNumber, part.revision));
      expect(pdf?.httpMetadata?.contentType).toBe("application/pdf");
    }
    expect(await drawings.get(drawingKey(demoTeamId, "DEMO-1001", "A"))).not.toBeNull();
  });

  it("gives no Onshape links for its sample releases, which were never in Onshape", async () => {
    const { admin, student } = teamUsers(demoTeamId);
    const pending = await jsonAs<Pending>(admin, "/admin/parts/pending");
    expect(pending.parts.length).toBeGreaterThan(0);
    const { links } = await jsonAs<{ links: unknown[] }>(student, "/onshape/links");
    expect(links).toEqual([]);
  });

  it("has a required quality check with a passed and a failed report", async () => {
    const { admin } = teamUsers(demoTeamId);
    const reports = await jsonAs<{ outcome: string; passed: number }[]>(admin, "/quality-reports");
    expect(reports.map((r) => r.outcome).sort()).toEqual(["not_sent_back", "passed"]);
    const { qualityCheck, qualityReports } = await jsonAs<{
      qualityCheck: { required: boolean } | null;
      qualityReports: boolean;
    }>(admin, "/me");
    expect(qualityCheck?.required).toBe(true);
    expect(qualityReports).toBe(true);
  });

  it("doesn't link its sample releases to Onshape", async () => {
    const { student } = teamUsers(demoTeamId);
    const { releases } = await jsonAs<{ releases: { links: { release: string | null } }[] }>(
      student,
      "/onshape/releases",
    );
    expect(releases.length).toBeGreaterThan(0);
    for (const release of releases) expect(release.links.release).toBeNull();
  });

  it("adds a sample release from Ingest, only in the demo", async () => {
    const { admin } = teamUsers(demoTeamId);
    const before = await jsonAs<Pending>(admin, "/admin/parts/pending");
    await jsonAs(admin, "/admin/parts/demo-release", { method: "POST" });
    const after = await jsonAs<Pending>(admin, "/admin/parts/pending");
    expect(after.parts.length).toBe(before.parts.length + 3);
    const other = teamUsers("frc4242").admin;
    expect((await callAs(other, "/admin/parts/demo-release", { method: "POST" })).status).toBe(403);
  });
});
