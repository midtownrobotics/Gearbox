# Users and permissions in Gearbox Home

Gearbox Home owns Account, Users, Kiosk Devices, Leaderboard and Attendance pages. ID owns sign-in flows and the identity backend. Existing ID page URLs redirect to Home, preserving member IDs and query strings. Home's Users list opens each member's account details, site-wide roles and student permissions together; the separate central Admin permission page is retired.

## Roles and authority

- Admin and Mentor remain site-wide roles within a team. Admin grants every permission in every team app, including permission assignments and Home settings. Mentor grants the existing mentor capabilities throughout the team's apps.
- Trusted students have explicitly assigned app capabilities, without becoming site-wide Admins or Mentors. App permissions cannot deny or downgrade global roles.
- Only Admins assign roles or student permissions. Home's app selection, appearance, sign-in, integrations and notification settings are restricted to Admins on both frontend and backend.
- Kiosk PIN sessions receive neither elevated roles nor student permissions. Every mutation validates the manager's team, active membership, enabled app and declared permission key. Admins cannot remove their own Admin access.

## Manifest authority and enabled apps

Each app's `manifest.ts` declares a `permissions` array with stable keys, labels, descriptions, Mentor defaults and any included capabilities. Home generates the permission controls from those definitions. ID asks Platform for the signed-in team's enabled manifests; the browser never chooses the permission catalog. Disabled apps are hidden and cannot receive new assignments. Their stored grants survive being switched off.

Workers declare `appAuthContext(manifest)`. `userIsAdmin` and `userIsMentor` always mean global roles; `userPermissions` contains additional student grants. `hasPermission` and `requirePermission` enforce manifest capabilities, including implied permissions. Global `requireAdmin` is reserved for Admin-only actions. Existing app API capability flags remain compatible with their frontend consumers.

Orders and Scouting now have one generated permission section each. Orders offers order management and catalog editing. Scouting offers settings, strategy/forms, field-map publishing and service crew. The old ID roles badge, inheritance/reset controls and per-app Admin/Mentor switches are removed.

## Storage and compatibility

Migration `0019_student_permissions.sql` adds team-owned student grants with composite ownership foreign keys, cascading account cleanup and actor/timestamp metadata. It converts the preview's positive app-role assignments into student capabilities, normalizes Skill Tree's manifest slug and discards Home overrides. It never modifies site-wide identity roles. Preview denial rows no longer suppress Admin or Mentor access; the old table remains only for migration compatibility.

Existing Orders catalog-editor and Scouting strategy, publisher and service-crew grants stay in their app-owned tables. Platform's authenticated adapters read and update those assignments for ID, so Home displays them alongside manifest-defined permissions without a second section. Existing service skills are preserved. Assignment APIs continue to require a global Admin. Configuration and operational tools stay with their apps; moving user pages does not transfer their databases to Platform.

## Validation and rollout

Validation passed: 508 tests across all 12 workers, workspace type checks, Biome, tenancy/configuration checks, both frontend builds and ID/Platform production dry-run builds. Coverage includes global Admin/Mentor access, granular student capabilities, kiosk refusal, forged headers, cross-team reads and writes, account/team cleanup, disabled apps, Home settings authorization and preserved legacy grants. The local browser workflow checked Account to Users, direct role/grant edits, all enabled app tabs, existing ID redirects, preservation of service-crew skills and 48 light/dark/mobile/desktop views with no overflow or browser exceptions. A populated SQLite migration rehearsal confirmed preview grants convert without changing global roles.

Apply ID migrations through `0019` before the updated ID worker (including `0018` when not yet applied). Deploy Platform's manifest catalog/adapters, updated ID and all affected app workers as a coordinated rollout; finish before assigning student capabilities. Deploy the Home and ID frontends together so old links redirect to the moved pages. No production database changes or deployment were performed.
