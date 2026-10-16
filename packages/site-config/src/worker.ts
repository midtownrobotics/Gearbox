// For app workers: each serves its app's page (static assets) and its API at /api on the same
// address. Workers' routes are written without the prefix (/requests, not /api/requests), as in
// dev, where Vite's proxy drops it; this drops it in production.
//
// Requests from other workers through service bindings use /api too (http://g3id/api/auth/me):
// in production only /api/* reaches the worker (wrangler.toml `run_worker_first`); everything
// else is the app's page. Unprefixed requests still work, which keeps tests and dev simple.

type FetchHandler<Env, Ctx> = (
  request: Request,
  env: Env,
  ctx: Ctx,
) => Response | Promise<Response>;

/** Wraps a worker's fetch handler so `/api/x` is handled as `/x`. */
export function withApiPrefix<Env, Ctx>(handler: FetchHandler<Env, Ctx>): FetchHandler<Env, Ctx> {
  return (request, env, ctx) => {
    const url = new URL(request.url);
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
      return handler(request, env, ctx);
    }
    url.pathname = url.pathname.slice("/api".length) || "/";
    return handler(new Request(url.toString(), request), env, ctx);
  };
}
