---
"@g3/worker-platform": minor
"@g3/worker-portal": minor
---

Each problem report's GitHub issue shows the sender's reporter ID, a random ID that doesn't say who they are, and the report form shows members their own. Operators can block a reporter ID that sends spam or misuses reports, from the console's Reporters page; the team's admins get a Slack or Discord message saying who it is and why, and see each member's reporter ID on their page in Members (the search finds it too). Deployers: apply the platform's migration `0013_reporters.sql` first.
