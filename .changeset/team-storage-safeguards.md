---
"@g3/worker-shop": major
"@g3/worker-scouting": major
"@g3/worker-pit": major
---

Keep team file storage bounded while preserving existing files and downloads. Apply the new storage upload lock migrations before deploying these workers. Shop and Scouting show clear quota errors; Pit rejects oversized or excess unfinished log uploads.
