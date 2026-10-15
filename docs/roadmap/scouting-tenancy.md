# Scouting team isolation

Implemented on 13 October 2026 in gearbox-scouting-changes. Deployment is separate.

Scouting now follows the other apps: authenticated team context from @g3/auth, Drizzle queries with inTeam/withTeam, the shared tenancy lint and isolation harness, and the platform's subscription lifecycle. Its manifest offers it to every team.

## Data ownership

Migration 0033 adds ownership to all 27 private tables. The two TBA caches remain shared public reference data. Every list, ID lookup, mutation, role check, join, archive and points operation is scoped to its authenticated team.

| Data | Ownership and keys |
| --- | --- |
| Forms, submissions and assignments | Forms and reports have composite team keys; submissions reference forms in the same team. Assignment and one-report-per-match guards include the owner |
| Event configuration and manual schedules | One configuration per team; event, match and team-number keys include the owner, so teams can use the same event key independently |
| Tier lists, maps, autos and retired robot records | Private rows and files. robot_images.robot_id now identifies the scouted robot separately from team_id |
| Strategy leads, helpers and map publishers | Grants belong to a team. Recipients come from activeMembers, never a global identity search. Kiosk sessions cannot inherit strategy/helper privileges |
| Presence, announcements and team comments | Private to the owning team, including schedule assignments and closed-ticket references |
| OCR cache and quotas | Image hashes and usage windows include the team; identical uploads never reuse another team's private results |
| Points, ledger, bets and combined picks | Balances, reference uniqueness, funds triggers, history, standings and settlement include ownership |
| Engagement settings | team_id and the shared helpers; points name is also exposed through the platform team-settings contract |

## Existing data and files

The migration preserves every original column and row. A reserved migration owner is adopted by the configured site team in db/bootstrap.ts before requests or cron work run. A different team's first visit cannot claim it. Parents are adopted before dependent rows, with cascading composite foreign keys. No new team's identifier is embedded in the migration.

Existing R2 addresses are retained and authorized through their scoped database records; copying files is unnecessary for isolation and would add release risk. New uploads use teams/<encoded-owner>/. Team deletion removes referenced legacy objects, current uploads and orphaned uploads under that team's prefix. Original file links continue to work.

## Modules and integrations

- Predictions and settlement, manual schedules and OCR, roles, engagement, internal hooks and database helpers are separate modules.
- Scheduled work discovers explicit teams, purges expired manual events and settles enabled predictions within each team. One team's provider failure does not stop the others.
- Service alerts go through G3ID's team member DM service, which uses that team's Slack installation. Scouting no longer holds a Slack token or searches a global user list.
- TBA/Nexus overrides remain in each team's event configuration. Worker-level provider keys remain an intentional shared fallback, as in Pit. Exports omit API keys.
- New subscriptions seed empty editable match and pit forms. Seed is idempotent and also runs when forms are opened. Points start disabled.
- Seed, export and deletion hooks are mounted at /api/internal/teams/:teamId. The gateway blocks external access. Platform bindings for local, staging and production call them using the same registry as the other apps.

## Validation

- Populated migration test compares every original row and column across all 27 private tables, checks foreign keys and exercises legacy adoption order.
- The shared two-team harness calls every public data route as admin, mentor, student and kiosk sessions using forged foreign IDs. OCR extraction has its own controlled AI test.
- Lifecycle tests cover isolated export without secrets, complete D1/R2 deletion and retries, and idempotent seed.
- Workflow tests cover original-team adoption after a different team's first visit, real multipart uploads, forged image IDs, team membership grants and Slack recipients, repeated user/match IDs, concurrent spending, funds triggers, combined picks, repeated cron settlement and private OCR caches/quotas.
- All 492 worker tests pass across the workspace (including the latest Shop updates); workspace type checks, Biome, tenancy lint and production dry-run builds for Scouting and Platform pass. The migrated local app passes 32 real page views, and a fresh local team starts with blank forms, no foreign content and disabled points.
- The staging copier now filters Scouting by team_id, matching the other apps; a controlled dry run confirms another team is preserved and API keys are omitted.
- UI remains documented in scouting-ui-validation.md. Specialized touch and canvas layouts are retained.

## Release order

Apply migration 0033, deploy Scouting, then deploy Platform with the updated manifest and service binding. The platform must not offer Scouting to new teams while an older unscoped worker is serving it. Existing writes require the new worker after migration; schedule the rollout accordingly. Existing deployment ordering already places Scouting before its dependent Platform worker. Rehearse on staging before production; no remote deployment was performed during this work.
