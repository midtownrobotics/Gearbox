# Automatic match advancing

Validated locally on 16 October 2026.

- The default wait is two minutes after TBA's result timestamp, or its existing estimate of when a match finished. Scouting Admin's Event Configuration accepts a whole number from 0 to 30 minutes; 0 advances immediately after the match finishes.
- The setting belongs to each team. Existing event updates that omit it preserve the saved value. The manifest and team-settings API expose the same value.
- Automatic selection uses TBA, independently of Statbotics. Event context, scout assignments and submitted report links use the same delay. The existing 30-second cache and page polling can defer when a new match appears.
- Manual schedules continue using the lead's selected match, and hide the automatic-delay field. Switching modes preserves the setting.
- Migration `0034_auto_advance_delay.sql` preserves existing configuration and gives existing and new rows a two-minute default. Apply it before deploying the worker.

All 50 worker tests pass. Eight match-advance tests cover exact timing boundaries, longer and zero delays, unfinished matches, timing fallbacks, saved values and team isolation, permission and invalid-input rejection, report linkage, manual schedules and the manifest-backed API. The populated migration test verifies preserved rows, the new default and database constraints.

Browser checks at 320, 390 and 768px in both themes verify the two-minute default, validation, save confirmation, reloading a saved value and hiding the field in manual mode. Six captures show no horizontal overflow or browser exceptions. Browser API responses are fixtures; worker storage and cache tests use the real local runtime. Physical devices and production deployment were not part of validation.
