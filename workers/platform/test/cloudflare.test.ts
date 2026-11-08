// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { site } from "@g3/site-config";
import { type TestUser, admin, asUser, kioskAdmin, student } from "@g3/testing/users";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CloudflareOverview, forgetCloudflareOverview } from "../src/cloudflare";
import type { AppEnv } from "../src/types";

// The console's Cloudflare page (src/cloudflare.ts), against the fake Cloudflare API in
// vitest.config.mts. `admin` is an operator here; `student` isn't.

const testEnv = env as unknown as AppEnv["Bindings"];
const CONSOLE = `https://admin.${site.platformDomain}`;
const operator = admin;

function call(user: TestUser | null, origin: string | null = CONSOLE) {
  const options = user ? asUser(user) : {};
  const headers = new Headers(options.headers);
  if (origin) headers.set("Origin", origin);
  return exports.default.fetch(
    new Request("http://platform/api/console/cloudflare", { ...options, headers }),
  );
}

const cloudflareCalls = async () =>
  (await (await fetch("https://api.cloudflare.com/test/cloudflare/calls")).json()) as number;

type Overview = Extract<CloudflareOverview, { configured: true }>;

beforeAll(async () => {
  await testEnv.PLATFORM_DB.prepare(
    "INSERT OR IGNORE INTO operators (user_id, created_at) VALUES (?, 1)",
  )
    .bind(operator.id)
    .run();
});

beforeEach(() => forgetCloudflareOverview());

describe("the Cloudflare page", () => {
  it("is for operators only, never from a kiosk, and asks Cloudflare nothing for anyone else", async () => {
    const before = await cloudflareCalls();
    expect((await call(null)).status).toBe(401);
    expect((await call(student)).status).toBe(403);
    expect((await call(kioskAdmin)).status).toBe(403);
    expect(await cloudflareCalls()).toBe(before);
  });

  it("is refused to an operator's cookie from any page but the console's", async () => {
    expect((await call(operator, `https://1234-orders.${site.platformDomain}`)).status).toBe(403);
    expect((await call(operator, `https://admin.${site.domain}`)).status).toBe(403);
    // A same-origin read sends no Origin.
    expect((await call(operator, null)).status).toBe(200);
  });

  it("shows usage against the plan, an estimate, warnings and each part", async () => {
    const res = await call(operator);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    // Never the token, and never who deployed.
    expect(text).not.toContain("test-cf-token");
    expect(text).not.toContain("deployer@test");
    const data = JSON.parse(text) as Overview;
    expect(data.configured).toBe(true);
    // The plan's billing period (vitest.config.mts: from 3 days ago), not the calendar month.
    expect(data.period.billing).toBe(true);
    expect(Date.now() / 1000 - data.period.start).toBeGreaterThan(2.9 * 86_400);
    expect(Date.now() / 1000 - data.period.start).toBeLessThan(3.1 * 86_400);

    expect(data.workers).toEqual({
      ok: true,
      data: [
        { name: "orders-production", requests: 9_000_000, errors: 3, subrequests: 40, cpuMs: 2000 },
      ],
    });
    expect(data.d1).toMatchObject({
      ok: true,
      data: [{ name: "gearbox-orders", bytes: 2_000_000 }],
    });
    // PutObject is Class A, GetObject Class B, and deletes are free.
    expect(data.r2).toMatchObject({
      ok: true,
      data: [{ name: "pit-logs", bytes: 3100, classA: 10, classB: 20 }],
    });
    expect(data.kv).toMatchObject({ ok: true, data: [{ name: "sessions", reads: 50, keys: 2 }] });
    // 8 s active at 128 MB.
    expect(data.durableObjects).toEqual({
      ok: true,
      data: { requests: 12, gbSeconds: 1, storedBytes: 400 },
    });
    expect(data.queues).toEqual({ ok: true, data: { operations: 30 } });

    // A part Cloudflare can't answer leaves the rest, and the estimate says it's left out.
    expect(data.ai.ok).toBe(false);
    expect(data.estimate.missing).toEqual(["Workers AI"]);
    // 10M rows written beyond the 50M included, at $1 a million.
    const written = data.meters.find((m) => m.key === "d1RowsWritten");
    expect(written?.cost).toBeCloseTo(10);
    expect(data.estimate.total).toBeCloseTo(15);
    expect(data.warnings.map((w) => w.label)).toEqual(["Workers: Requests", "D1: Rows written"]);

    expect(data.zones).toMatchObject({
      ok: true,
      data: [
        {
          name: "frcgearbox.com",
          traffic: { ok: true, data: { requests: 100, statuses: { "2xx": 95, "5xx": 5 } } },
          security: {
            ok: true,
            data: { total: 4, capped: false, paths: [{ name: "/wp-login.php", count: 4 }] },
          },
        },
      ],
    });
    expect(data.deploys).toMatchObject({
      ok: true,
      data: [
        {
          name: "orders-production",
          deploys: [{ source: "wrangler", message: "Release 2026.11.1", versions: ["abcdef12"] }],
        },
      ],
    });
  });

  it("keeps what Cloudflare said for a few minutes", async () => {
    await call(operator);
    const after = await cloudflareCalls();
    await call(operator);
    expect(await cloudflareCalls()).toBe(after);
  });
});
