---
"@g3/worker-platform": major
"@g3/worker-g3id": minor
---

Platform operators get a console at `admin.<domain>`: the list of teams and the reports against their numbers, with tools to hand a team to another member, change its team number, suspend it or delete it, all kept in a 12-month log. G3ID can now send an operator back to the console after sign-in. Deployers: apply the platform's D1 migration 0003_operators before deploying its worker, and add the first operator by hand (docs/deploy.md).
