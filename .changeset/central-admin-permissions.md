---
"@g3/worker-g3id": major
"@g3/worker-shop": minor
"@g3/worker-pit": minor
"@g3/worker-orders": minor
"@g3/worker-inventory": minor
"@g3/worker-edge": minor
"@g3/worker-scouting": minor
"@g3/worker-skill-tree": minor
"@g3/worker-attendance": minor
"@g3/worker-platform": minor
"@g3/worker-portal": minor
---

Add a central Admin page in ID, available from the Account page and navbar. ID's trusted students assign trusted student and mentor access separately for each app, including Orders catalog editors and Scouting strategy, publishing and service-crew permissions. Each app keeps its settings and enforces its assigned permissions. Rename the admin role to Trusted student in the interface.

Preserve existing ID roles and app grants. App-specific overrides take effect on authenticated requests, cannot grant ID authority and are unavailable to kiosk PIN sessions. Apply G3ID migration 0018 before deployment, and deploy all updated app workers before using app-specific assignments.
