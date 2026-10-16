---
"@g3/worker-shop": major
"@g3/worker-g3id": minor
---

Shop keeps each team's parts, production steps, files and drawings to itself. Each team connects its own Onshape on the Admin page (API keys and webhook signing keys, stored encrypted), and release and daily summary posts go to the team's own Slack. Drawings now need you to be signed in. Deployers: follow "Shop for every team" in docs/deploy.md before merging: set Shop's `SECRETS_KEY` secret, copy the files in R2 with `pnpm --filter @g3/worker-shop r2:move-to-team`, then apply migration `0016_teams.sql`.
