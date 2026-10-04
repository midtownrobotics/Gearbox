---
"@g3/worker-g3id": major
"@g3/worker-portal": major
"@g3/worker-shop": major
"@g3/worker-pit": major
"@g3/worker-orders": major
"@g3/worker-edge": major
"@g3/worker-scouting": major
"@g3/worker-skill-tree": major
"@g3/worker-attendance": major
---

Each app is now one worker: it serves the app's page and its API at /api on the app's own address (https://orders.<domain>/api), behind one gateway worker on *.<domain>. Deploying changes (see docs/deploy.md): no more Cloudflare Pages, sign-in callbacks move to https://g3id.<domain>/api/auth/<provider>/callback (add them to each provider first), and the old api.<app> addresses keep working through the gateway.
