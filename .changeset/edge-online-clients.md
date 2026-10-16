---
"@g3/worker-edge": major
"@g3/edge-agent": minor
---

Network → Clients shows which devices are on the shop network right now, checked live on the edge box each time the page loads, including devices that never use the internet like printers. Filter the list with "Online now". The Edge Box page shows the box's LAN, WAN and public addresses. Deployers: apply migration `0004_public_ip.sql` (`pnpm --filter @g3/worker-edge run db:migrate:remote`) before deploying the edge worker.
