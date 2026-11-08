// SPDX-License-Identifier: AGPL-3.0-only
import { teamAppUrl } from "@g3/site-config";
import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { type RateLimitEnv, checkRateLimit } from "../src/rate-limit";

function limiters() {
  return Object.fromEntries(
    [
      "REQUEST_LIMITER",
      "API_LIMITER",
      "WRITE_LIMITER",
      "EXPENSIVE_LIMITER",
      "API_BUDGET_LIMITER",
    ].map((name) => [name, { limit: vi.fn().mockResolvedValue({ success: true }) }]),
  ) as unknown as RateLimitEnv;
}
const request = (path: string, method = "GET") =>
  new Request(`${teamAppUrl("frc1648", "orders")}${path}`, {
    method,
    headers: { "CF-Connecting-IP": "203.0.113.42", "X-Forwarded-For": "spoofed" },
  });

describe("gateway rate limits", () => {
  it("limits pages as well as APIs, before accessing downstream services", async () => {
    const env = limiters();
    vi.mocked(env.REQUEST_LIMITER.limit).mockResolvedValue({ success: false });
    for (const path of ["/", "/icon-192.png", "/api/requests"]) {
      const res = await worker.fetch(request(path), env as Env);
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(env.API_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("uses the trusted IP across paths, hosts, cookies and queries", async () => {
    const env = limiters();
    await checkRateLimit(request("/api/lookup?url=one"), env);
    await checkRateLimit(
      new Request(`${teamAppUrl("frc4242", "shop")}/api/~orders/lookup?url=two`, {
        headers: { "CF-Connecting-IP": "203.0.113.42", Cookie: "g3_session=rotated" },
      }),
      env,
    );
    expect(env.EXPENSIVE_LIMITER.limit).toHaveBeenNthCalledWith(1, { key: "203.0.113.42" });
    expect(env.EXPENSIVE_LIMITER.limit).toHaveBeenNthCalledWith(2, { key: "203.0.113.42" });
    expect(env.API_BUDGET_LIMITER.limit).toHaveBeenCalledWith({ key: "all-api" });
  });

  it("applies write limits to every mutating method, including aliases", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const env = limiters();
      vi.mocked(env.WRITE_LIMITER.limit).mockResolvedValue({ success: false });
      expect((await checkRateLimit(request("/api/~shop/parts", method), env))?.status).toBe(429);
    }
  });

  it("uses the costly-route limit for storage counts and bulk downloads, including aliases", async () => {
    for (const path of [
      "/api/team/storage",
      "/api/team/storage/shop/archive",
      "/api/~platform/team/storage/pit/download?key=test",
    ]) {
      const env = limiters();
      vi.mocked(env.EXPENSIVE_LIMITER.limit).mockResolvedValue({ success: false });
      expect((await checkRateLimit(request(path), env))?.status).toBe(429);
    }
  });

  it("allows ordinary reads without spending write or expensive quotas", async () => {
    const env = limiters();
    expect(await checkRateLimit(request("/api/auth/me"), env)).toBeNull();
    expect(env.WRITE_LIMITER.limit).not.toHaveBeenCalled();
    expect(env.EXPENSIVE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("rejects distributed traffic when the shared API budget is exhausted", async () => {
    const env = limiters();
    vi.mocked(env.API_BUDGET_LIMITER.limit).mockResolvedValue({ success: false });
    expect((await checkRateLimit(request("/api/requests"), env))?.status).toBe(429);
  });

  it("fails closed on a missing or unavailable limiter", async () => {
    const env = limiters();
    vi.mocked(env.REQUEST_LIMITER.limit).mockRejectedValue(new Error("unavailable"));
    expect((await worker.fetch(request("/api/requests"), env as Env)).status).toBe(503);
    expect((await worker.fetch(request("/"), {} as Env)).status).toBe(503);
  });
});
