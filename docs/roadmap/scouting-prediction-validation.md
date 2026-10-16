# Prediction loading and failures

Validated locally on 16 October 2026. Direct public Statbotics requests for GRITS returned 500 during investigation; the external service's availability remains independent of this fix.

## Behavior

- The page first requests local points, history, standings and settings through `/game?summary=true`, which does not contact Statbotics or wait for settlement. It then requests the existing full game response. Settlement still updates the completed response and scheduled work.
- External requests have a three-second timeout and do not automatically retry 500 or 429 responses. The browser also bounds its requests to six seconds.
- Public matches are cached for 30 seconds, failures for 10 seconds. Concurrent requests for the same event share the active upstream request. No private account data is cached.
- Single and combined pick submissions bypass cached display data and check live match availability and lines before spending points. Existing atomic balance checks and team isolation remain enforced.
- Pending and failed prediction loads leave points, history and standings available. Refresh remains reachable after a failed initial load. Refresh and focus events share one load; old match choices are disabled while refreshing, and unavailable or changed picks are removed.
- Points-only settings and an unconfigured event skip the external request entirely.
- Prediction errors name the configured event using its TBA short name or team-scoped manual name, with its key as a fallback. A 404 says no Statbotics event page was found; a 500 identifies a server error instead. Timeouts and unreadable responses have separate messages. Name lookup runs alongside the full prediction request; the fast summary still makes no external calls.

## Validation

- All 42 worker tests and the populated migration check pass. Nine new tests cover concurrent requests, successful and failed caches, fresh recovery, a stalled upstream, malformed data, fast local summaries, named 500 errors, cached missing-event errors, and rejected single/combined picks during an outage.
- Frontend and worker type checks, frontend production build, worker production dry-run bundle, Biome, text-field lint, tenancy lint and whitespace checks pass.
- Browser workflows at 320, 390 and 768px in both themes verify local data before the held prediction response; coalesced focus loads; named GRITS server and missing-event errors; usable standings/history after 500; disabled stale selections and submissions while refreshing; cleared picks on failure; transport-error recovery; points-only mode; and no-event mode. Thirty captures have no viewport overflow or browser exceptions.
- Additional browser checks cover a failed initial local-data request and recovery, plus a six-second client timeout while preserving local data.

Browser API responses and worker outbound services are fixtures for repeatable failures; frontend controls and worker storage/cache are real. Physical devices and production deployment were not part of validation.
