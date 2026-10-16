---
"@g3/worker-scouting": patch
---

Load scouting points and history before external predictions, limit Statbotics requests to three seconds, and reuse recent public match data. Name the active event in prediction errors and distinguish missing events from server failures and timeouts. Keep points and standings usable during outages, allow retrying failed loads, and validate submitted picks against fresh data.
