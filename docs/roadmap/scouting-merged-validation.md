# Combined Scouting changes

Validated locally on 16 October 2026 with the report filters, prediction reliability and PR #233's Admin and form improvements together.

- Admin opens with announcements and Competition overview, including live users, submissions, strategy leads and the match control. Event settings remain together, and Match schedule offers an in-page explanation.
- There is one active automatic-advance setting: submission_window_seconds, default 120, accepting whole seconds from 0 to 1800. 0 advances immediately after a match finishes. The manifest, settings API, event context and report linkage use the same value. Legacy minutes-based pages remain compatible.
- Migration 0035_submission_window.sql follows 0034_auto_advance_delay.sql, converts saved minutes to seconds and removes the superseded column. The populated migration check verifies preserved configuration, converted values, defaults and constraints.
- Form sorting and report-type sorting coexist. Match/pit and named-event filters still apply to stats, paths and comparisons. Zero slider ratings and zero-valued choices remain valid while unanswered fields are rejected.
- API-key isolation and fresh prediction validation remain enforced.

All 70 combined worker tests pass. Each PR also passes independently (66 prediction-branch tests, 61 report-branch tests), and frontend/worker type checks pass. The production frontend/worker dry-run bundle passes.

Browser checks at 320, 390 and 768px in both themes cover delay validation, 75-second saving/reload, manual-mode visibility, the schedule help dialog, both sort modes, named-event/type filters, paths and comparison summaries. The help control keeps a 44px target without stretching the heading. No horizontal overflow or browser exceptions were observed. Browser responses are fixtures; worker tests use real local storage and caches. The actual local preview shows the merged Admin and form controls. No production deployment was performed.
