// SPDX-License-Identifier: AGPL-3.0-only
export type RateLimitEnv = {
  REQUEST_LIMITER: RateLimit;
  API_LIMITER: RateLimit;
  WRITE_LIMITER: RateLimit;
  EXPENSIVE_LIMITER: RateLimit;
  API_BUDGET_LIMITER: RateLimit;
};

const response = (status: number, error: string) =>
  Response.json(
    { error, code: status === 429 ? "rate_limited" : "rate_limit_unavailable" },
    { status, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );

/** Aggregate across hosts, paths, sessions and query strings so rotating them buys no quota. */
export async function checkRateLimit(
  request: Request,
  env: RateLimitEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const checks: [keyof RateLimitEnv, string][] = [["REQUEST_LIMITER", ip]];
  const api = url.pathname === "/api" || url.pathname.startsWith("/api/");
  if (api) {
    checks.push(["API_LIMITER", ip], ["API_BUDGET_LIMITER", "all-api"]);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      checks.push(["WRITE_LIMITER", ip]);
    }
    // Cross-app aliases must receive the same limits as the destination's own host.
    let path = url.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // Malformed escapes still receive the general API and write limits.
    }
    path = path.replace(/^\/api\/~[A-Za-z]+(?=\/|$)/, "/api");
    if (
      /\/(auth|signup|slack|lookup|onshape|reports|storage|export|import|sync|refresh|print|analysis|kiosk\/activate|monitor\/data)(\/|$)/i.test(
        path,
      ) &&
      !/^\/api\/auth\/(me|session)(\/|$)/.test(path)
    ) {
      checks.push(["EXPENSIVE_LIMITER", ip]);
    }
  }
  try {
    for (const [binding, key] of checks) {
      if (!(await env[binding].limit({ key })).success) {
        return response(429, "Too many requests. Please try again in a minute.");
      }
    }
  } catch (error) {
    // A broken or missing binding must not silently expose the downstream services.
    console.error("[gateway] rate limiter unavailable", error);
    return response(503, "Please try again in a minute.");
  }
  return null;
}
