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

Move Account, Users, Kiosk management, Leaderboard and Attendance pages into Gearbox Home, with redirects from ID. Combine user management and permissions on each member's page. Keep site-wide Admin and Mentor roles, reserve Home settings and permission assignments for Admins, and let trusted students receive granular capabilities for enabled apps without changing global roles. Generate permission controls from the apps' manifest definitions and descriptions, including existing Orders and Scouting grants in the same section.

Apply ID migrations through 0019 before deployment. Migration 0019 converts preview app-role grants into student capabilities while preserving identity roles; global roles can no longer be denied per app. Preserve legacy catalog, strategy, publisher and service-crew assignments, enforce kiosk and team boundaries, and deploy the updated Platform, ID and app workers together before assigning new capabilities. The release workflow applies versions and changelogs.
