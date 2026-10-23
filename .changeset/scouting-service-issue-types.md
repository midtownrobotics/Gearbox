---
"@g3/worker-scouting": major
---

A service ticket can have more than one issue type, or "Not sure" when the reporter can't tell: both ticket forms pick them with chips, and each ticket shows a badge per type. Apply migration `0037_service_ticket_issue_types.sql` before deploying; the API takes and returns `issueTypes` (a list) in place of `issueType`.
