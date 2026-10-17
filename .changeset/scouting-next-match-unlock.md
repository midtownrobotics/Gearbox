---
"@g3/worker-scouting": patch
---

Open a scout's next match immediately after saving a report, without a start-time submission gate. Limit automatic progression to one match ahead of the shared current match, preserve drafts during schedule failures, and prevent stale polls from restoring completed forms. Keep expired and wrong-team report protection.

Claim scout assignments atomically, repair changed lineups, and validate team membership before and after drawing uploads. Keep automatic match advancement forward-only, preserve omitted event settings, and reopen empty forms after a confirmed deadline extension. Anchor countdowns to server time so device clock changes do not erase drafts.
