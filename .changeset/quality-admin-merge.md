---
"@g3/worker-shop": major
---

Quality control is one section on the Admin page: quality reports and their table moved into it, the process picker only shows once "Require quality control" is on, and the checklist a report goes through is now the team's own, edited under the reports table.

A part that fails its check can go to any of its steps, not only one before the check. Two new choices sit beside Send back: Fix it, which sends the part to a step and writes what has to be done onto the part's notes, and Start over, which makes the part obsolete and adds a new one at its first step. A fix can send the part to a step it doesn't have yet — sanding a part that failed — and that step joins this one part, just before its quality check.

Turning quality reports or a required quality check on now takes effect on the shop floor without reloading the page, so a Quality Control step no longer offers Mark Complete when it needs a quality report.

Run the Shop worker's D1 migrations (`0020`, `0021`) before deploying: they widen what a report's outcome can be and move its four fixed questions into the team's editable checklist.
