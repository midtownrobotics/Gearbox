---
"@g3/worker-g3id": major
"@g3/worker-portal": minor
---

Portal's Account page shows the account name behind each linked sign-in: your username on the Slack or Discord account you joined with (listed first), and the username or email of each other account, so two accounts from the same service can be told apart. Slack accounts linked from now on keep their Slack name, and ones linked before take the member's username. Deployers: apply G3ID's migration `0021_slack_identity_names.sql` before deploying G3ID.
