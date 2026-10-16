---
"@g3/worker-attendance": major
---

Move attendance history and hour totals to Cloudflare D1. The production data was copied and verified before the worker changed over. Deployments must create and populate the attendance D1 database before deploying this worker.
