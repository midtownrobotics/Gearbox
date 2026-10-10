---
"@g3/worker-pit": major
---

Pit keeps each team's checklists, batteries and event settings to itself, and the pit monitor uses your own team number. The Blue Alliance and Nexus API keys are no longer settings: the monitor always uses the platform's. Deployers: before applying Pit's migration `0011_teams.sql` (`pnpm --filter @g3/worker-pit run db:migrate:remote`), make sure the worker's `TBA_AUTH_KEY` and `NEXUS_API_KEY` secrets hold working keys, because the migration drops the keys stored as settings. Then deploy the worker.
