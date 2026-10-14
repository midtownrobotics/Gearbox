# Central permissions in ID

Implemented on central-admin-page. ID's Account page has an Admin card and a Manage permissions button; Admin is also a navbar link. Its app tabs contain permission controls only, with compact member names and short summaries beneath the trusted student and mentor labels. The summaries describe the selected app's access and share the existing switches' height. App settings stay on their existing pages.

## Authority

- Only ID's trusted students manage assignments. An app's trusted student can use that app's restricted controls without gaining access to ID's permission editor or account administration.
- Trusted student is the displayed name for the existing admin role. Stored `isAdmin` fields, manifest roles and API keys retain their existing names for compatibility. Mentor identity remains distinct from an app's mentor access.
- Every data-owning app declares its permission scope with `appAuthContext` before mounting routes. Shared auth asks ID for that app's effective roles. Client role and app-scope headers are ignored.
- `userIsAdmin` and `userIsMentor` are effective app roles; `userIsIdentityAdmin` separately identifies who may assign permissions. Kiosk sessions never receive any of these powers, including through legacy Orders catalog grants.
- ID reads active members and edits only its signed-in manager's team. Cross-team identifiers, invalid roles, inactive members and self-removal of ID trusted student access are refused.

## Existing roles and settings

Migration 0018 adds `app_permissions` without rewriting existing accounts. No override means the member keeps their existing ID roles in that app. Editing an app creates an explicit assignment; Use ID roles removes it. Identity and app roles are shown separately in the editor. Composite ownership keys and foreign keys prevent a grant from referring to another team's member. Account deletion cascades its overrides; team deletion removes only that team's grants.

Orders' catalog-editor grants and Scouting's strategy, field-map publishing and service-crew grants remain in their existing team-scoped app tables. Their existing assignments are preserved and their editing controls move to ID's app tabs. Their APIs now require ID's trusted student authority, even when the caller is trusted in the app. Orders can grant catalog access before a member first opens it. Service skills remain alongside the service-crew assignment.

The old assignment controls are removed from ID's Users pages, Orders Admin, Scouting Admin, Field Maps and Service Tickets. Users still approves, rejects, merges and deletes accounts; app Admin pages retain configuration, operational tools and API-key settings. Attendance's existing settings page in ID follows Attendance's assigned access. Gearbox Home's settings follow its own app scope. Shop and Home can list Slack channel choices using their app-specific trusted student access without gaining ID management authority.

## Rollout and validation

Apply G3ID migration 0018 locally or on staging before starting the updated ID worker. Production requires the same migration first. Deploy the updated ID and app workers as one coordinated rollout; finish deploying all app workers before using app-specific assignments. The shared SDK remains compatible with an older ID worker during deployment, and existing roles continue to work until overrides are chosen.

Validation passed: 505 tests across all 12 workers, workspace type checks, Biome CI, tenancy lint, configuration checks, production builds for ID, Scouting, Shop, Home and Orders, and an ID worker dry-run build. Worker tests cover scoped grants and revocation with existing sessions, inherited-role overrides and reset, separate mentor access, ID-only management, kiosk exclusion, forged headers, cross-team isolation and database constraints, account/team deletion, Slack channel authorization, and preserved Orders/Scouting workflows.

Real local browser checks verified grants and revocation, strategy access, field-map publishing, service-crew skills, catalog editing and the ID-only assignment boundary. All ten app tabs passed 80 views across light and dark themes at four mobile-to-desktop widths, with no horizontal overflow or browser exceptions. A separate role-summary review compared 100 views against the previous layout at widths from 320 to 1440 pixels in both themes: card heights did not increase, switch dimensions stayed unchanged, and no overflow or browser exceptions occurred. Temporary QA accounts were removed afterward. Migration and browser testing used local databases; no production deployment or remote database changes were made.
