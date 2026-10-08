---
"@g3/worker-platform": major
"@g3/worker-portal": minor
"@g3/worker-g3id": minor
---

Teams choose their apps: a team's admins switch apps on and off on the new Apps page of their team's admin pages (`<number>.frcgearbox.com/admin`), which also has Appearance and Slack, moved there from G3ID (the old G3ID pages redirect). An app that's off can't be opened by anyone on the team, and the home lists only the apps that are on. Its data is kept for 90 days, so switching it on again brings everything back; after that it's deleted. Teams already on Gearbox keep every app on; new teams start with none. Deployers: apply the platform's migration `0005_team_apps.sql` (`pnpm --filter @g3/worker-platform run db:migrate:remote`) before deploying.
