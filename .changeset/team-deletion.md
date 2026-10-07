---
"@g3/worker-platform": minor
"@g3/worker-attendance": patch
"@g3/worker-pit": patch
"@g3/worker-skill-tree": patch
"@g3/worker-inventory": patch
"@g3/worker-shop": patch
"@g3/worker-edge": patch
"@g3/worker-orders": major
---

When an operator deletes a team, its data in every app is deleted too (Shop's files and Onshape webhook, Edge's box key included), and nothing else is deleted if an app can't. Orders keeps each team's Share-A-Cart connection encrypted. Deployers: set Orders' `SECRETS_KEY` secret before deploying it.
