---
"@g3/worker-scouting": major
"@g3/worker-platform": minor
---

Make Scouting available to every team through the app library, with private forms, reports, schedules, roles, files, service tickets and optional predictions. Add subscription setup, export and deletion, and send service alerts through each team's Slack installation. Preserve the original team's data and file links; new teams start with empty editable forms and points disabled.

Align Scouting with the shared app UI while preserving its scouting, analysis, drawing and touch workflows. Add direct page links and in-page questions, repair Service Tickets formatting, polish predictions, remove redundant descriptions and show the configured points name beside Available.

Deployment requires action: apply Scouting migration 0033, then deploy Scouting before Platform exposes it to other teams. Existing writes require the updated Scouting worker after migration. Rehearse this order on staging.
