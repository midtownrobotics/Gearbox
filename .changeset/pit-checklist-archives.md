---
"@g3/worker-pit": major
---

Checklists are archived when they're reset. "Archive and Reset" (in place of "Reset All") asks what the checklists were for: the event, whether it was a match, a practice or something else, and details such as the match. At an event the event is filled in from Settings and the details start with the team's next official match. It then saves what was checked, who archived it and when, and unchecks everything; open issues stay. The new Logs tab lists every archive, and each opens to show all the lists with their items and issues marked New, Still Open or Resolved. An issue you resolve shows as Resolved in the next archive. Apply migration `0012_checklist_archives.sql` before deploying.
