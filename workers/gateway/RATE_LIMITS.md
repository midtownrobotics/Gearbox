# Gateway request limits

Every non-local request is checked before routing or fetching team, icon, session, or app data.
Limits use Cloudflare's native rate-limit bindings, avoiding a KV or D1 write per request.
Only `LOCAL_DEV=true` on a recognized localhost hostname bypasses these checks.

| Scope | Requests per 60 seconds |
| --- | ---: |
| All requests per connecting IP, including pages, assets and unknown hosts | 3,000 |
| API requests per connecting IP | 1,200 |
| API mutations per connecting IP (anything except GET, HEAD and OPTIONS) | 300 |
| Costly API routes per connecting IP, all methods combined | 60 |
| All API requests across all clients | 20,000 |

Costly routes include authentication (except session/me reads), signup, Slack, kiosk activation,
vendor lookup, Onshape, reports, exports, imports, sync, refresh, printing, analysis and pit monitor
data. Other routes still receive general API and mutation limits. Review the classification in
`src/rate-limit.ts` when adding an external API integration or expensive query.

IP counters are shared across teams, hostnames, paths, query strings, and cookies. `/api/~app/`
aliases get the same protection as direct routes. Only Cloudflare's `CF-Connecting-IP` is used;
client-supplied forwarded-IP and identity headers do not choose the key. Requests without the
Cloudflare header share an `unknown` bucket. Shared school networks also share IP quotas;
check 429 logs during events before adjusting thresholds.

Exhausted limits return 429 with `Retry-After: 60` and `Cache-Control: no-store`. Missing or failed
bindings return 503, without fetching downstream services. The demo's additional write limit and
Slack code's existing attempt checks remain in effect. Bindings are configured in local,
production and staging Wrangler tables; production configuration is the source for generated
staging configuration. Deploy the gateway for these protections to take effect.

## Billing boundary

These are abuse throttles, not an exact daily quota or spending cap. Cloudflare documents that
native counters are approximate and per data center:
https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
The shared API ceiling also applies separately in each data center and can reject legitimate
traffic during an attack. Production and staging use the same namespaces, so counters for the
same IP (and the shared API budget) are shared across them within a data center.

Rejected requests still invoke the gateway. This change protects downstream database, storage,
service and external API work; it cannot prevent gateway request charges from a large flood.
Use Cloudflare WAF rate-limiting rules before Workers execution to reduce that exposure, plus
usage alerts and provider-side quotas where available. Those account settings are outside this
repository and have not been changed or verified by this PR. A strict spend ceiling would need
separate accounting and a kill switch. Worker service bindings, scheduled jobs, queues and existing
WebSocket messages do not pass through this request throttle.

App workers currently disable `workers_dev` in production and staging. Keep public access through
the gateway, and do not add direct app routes or preview URLs that bypass its checks.

Storage counts, individual downloads, and bulk archives also spend the costly-route quota; cross-app aliases share it. The Storage page caches successful counts for one minute per team and environment.
