---
"@g3/worker-orders": major
"@g3/worker-g3id": minor
---

Orders keeps each team's requests, budgets, vendors, lists and catalog to itself. Each team starts with its own copy of the parts catalog, so its edits and prices are its own. Mentors can set the team's currency and the month its fiscal year starts on the Settings page, and dates are shown and counted in your own local time. Approval messages go out on your team's own Slack, and Share-A-Cart is connected per team. Deployers: deploy G3ID first (it sends Orders' Slack messages now), then apply Orders' migration `0018_teams.sql` (`pnpm --filter @g3/worker-orders run db:migrate:remote`) before deploying Orders. Orders' `SLACK_BOT_TOKEN` secret is no longer used and can be deleted.
