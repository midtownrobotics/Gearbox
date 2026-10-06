---
"@g3/worker-g3id": major
"@g3/worker-shop": major
"@g3/worker-edge": major
"@g3/worker-portal": patch
"@g3/worker-pit": patch
"@g3/worker-orders": patch
"@g3/worker-scouting": patch
"@g3/worker-skill-tree": patch
"@g3/worker-attendance": patch
---

The old api.<app> addresses are retired: they answer 410 with the app's address to use instead (https://<app>.<domain>/api). Deployers: before releasing, move Slack's command and event URLs, re-save Shop's Onshape settings (which now replaces its webhook rather than adding one), and point the edge box at https://edge.<domain>/api (docs/deploy.md).
