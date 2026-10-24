---
"@g3/worker-g3id": major
"@g3/worker-portal": minor
---

Someone new who joins with Slack or Discord now enters their full name (filled in from their Slack or Discord name) before the team's admins are asked to approve them. Admins can correct any member's name on Portal's Members page, and each member's username, the name on the chat account they joined with, is shown beside it and can't be edited. Everyone's current name stays as it is and becomes their username too. Deployers: apply G3ID's migration `0020_member_names.sql` before deploying G3ID.
