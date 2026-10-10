---
"@g3/worker-g3id": major
---

Each team signs in on its own G3ID page, which shows the team's number and name, and only that team's members can sign in there. Deployers: sign-in providers now call back on https://id.<domain>/api/auth/<provider>/callback; add that address to Google, GitHub and Onshape before deploying G3ID.
