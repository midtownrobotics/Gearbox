---
"@g3/worker-shop": major
"@g3/worker-scouting": major
"@g3/worker-pit": major
---

Keep file storage within per-team caps. When a new upload would exceed a cap, permanently remove only files older than six calendar months, oldest first, targeting 90% usage. Newer files are protected; uploads pause when eligible old files cannot free enough room. Written Scouting reports and auton steps remain when their images are removed. Admin cleanup summaries include sizes and age. Apply coordination and notice migrations before deployment and honor the owner-notice period before changing live retention.
