import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { admin, mentor, otherStudent, student, userFromCookie } from "./users.ts";

// The Vitest config every worker's tests share: tests run inside the Workers runtime (workerd)
// against local D1/KV/R2 from the worker's wrangler config, with its D1 migrations applied
// (setup.ts), and with other workers replaced by stubs, so a worker is tested on its own.

type ServiceStub = (request: Request) => Response | Promise<Response>;

export type WorkerTestOptions = {
  /** Wrangler config to read bindings from. Default ./wrangler.toml. */
  wranglerConfig?: string;
  /** The D1 binding to apply migrations to, if the worker has one. */
  d1?: string;
  /** Its migrations folder. Default ./src/db/migrations. */
  migrations?: string;
  /** Vars and secrets to set or override (e.g. secrets that only exist in .dev.vars). */
  vars?: Record<string, string>;
  /** Other service bindings to stub, by binding name. G3ID is always the G3ID stub. */
  services?: Record<string, ServiceStub>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * G3ID as other workers see it: /auth/me answers for the user in the test cookie (users.ts), like
 * the real one, never reporting admin or mentor for a kiosk PIN session.
 */
export const g3idStub: ServiceStub = (request) => {
  const url = new URL(request.url);
  const user = userFromCookie(request.headers.get("Cookie") ?? "");
  if (url.pathname === "/auth/me") {
    if (!user) return json({ error: "Unauthorized." }, 401);
    const pin = user.sessionType === "pin";
    return json({
      ...user,
      status: "active",
      isAdmin: pin ? false : user.isAdmin,
      isMentor: pin ? false : user.isMentor,
      identities: url.searchParams.get("includeIdentities") === "false" ? [] : user.identities,
    });
  }
  if (url.pathname === "/auth/users") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    return json(ids.map((id) => ({ id, displayName: id })));
  }
  if (url.pathname === "/auth/logout") return json({ ok: true });
  // The member list (admins only, like the real one): the standard test users.
  if (url.pathname === "/users") {
    if (!user || user.sessionType === "pin" || !user.isAdmin)
      return json({ error: "Forbidden." }, 403);
    return json([student, otherStudent, mentor, admin].map((u) => ({ ...u, status: "active" })));
  }
  if (url.pathname === "/users/attendance-eligible") {
    if (!user) return json({ error: "Unauthorized." }, 401);
    return json({
      users: [student, otherStudent, mentor].map(({ id, displayName }) => ({ id, displayName })),
    });
  }
  return json({ error: `G3ID stub has no ${url.pathname}` }, 404);
};

/** A service that's down (e.g. the shop's edge box), for workers that must cope with that. */
export const offlineService: ServiceStub = () => json({ error: "Service unavailable." }, 503);

export function workerTestConfig(options: WorkerTestOptions = {}) {
  return defineConfig(async () => {
    // Wrangler skips migrations that are only comments (some workers have placeholder ones);
    // the test helper would fail on them, so they're dropped here.
    const migrations = options.d1
      ? (await readD1Migrations(options.migrations ?? "./src/db/migrations")).map((m) => ({
          ...m,
          queries: m.queries.filter((q) => q.replace(/--[^\n]*/g, "").trim() !== ""),
        }))
      : [];
    return {
      plugins: [
        cloudflareTest({
          // Everything local: no Cloudflare account needed (CI has none).
          remoteBindings: false,
          wrangler: { configPath: options.wranglerConfig ?? "./wrangler.toml" },
          miniflare: {
            bindings: {
              ...options.vars,
              TEST_D1_BINDING: options.d1 ?? "",
              TEST_MIGRATIONS: migrations,
            },
            serviceBindings: { G3ID: g3idStub, ...options.services },
          },
        }),
      ],
      test: {
        include: ["test/**/*.test.ts"],
        setupFiles: [fileURLToPath(new URL("./setup.ts", import.meta.url))],
      },
    };
  });
}
