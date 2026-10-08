---
"@g3/worker-edge": major
"@g3/edge-agent": minor
"@g3/worker-orders": patch
"@g3/worker-shop": patch
---

Edge works for any team with its own box: each box signs in with its team's own key, made by an admin on the Edge Box page, and each team's network data, blocking and settings are its own. Days, billing cycles and "until midnight" exceptions use the box's own time zone, which the agent now reports. Part lookups in Orders and printing in Shop use your own team's box. Deployers: follow "Edge for every team" in docs/deploy.md before merging: apply migration `0005_teams.sql`, then store G3's current box key with `box-key:set`; afterward upgrade the agent and delete the `EDGE_AGENT_KEY` secret.
