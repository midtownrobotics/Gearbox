---
"@g3/worker-edge": major
"@g3/edge-agent": minor
---

The edge box now keeps its own connection open to the edge worker, so printing, part lookups, door sounds and the live Network pages reach it without a Cloudflare Tunnel. The Edge Box page's Tunnel card is now a Connection card. Deployers: deploy the edge worker and install the new agent together (an older agent can't be reached by the new worker), then remove the old tunnel as described in `infra/edge/README.md`.
