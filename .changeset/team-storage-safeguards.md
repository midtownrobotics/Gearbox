---
"@g3/worker-shop": major
"@g3/worker-scouting": major
"@g3/worker-pit": major
---

Keep file storage within per-team caps. When a new upload would exceed a cap, permanently remove files older than six calendar months first, then the oldest remaining files, including recent files, as needed toward 90% usage. Pit's match logs are only removed when the team chose Delete the oldest logs (the default keeps every log). Written Scouting reports and auton steps remain when their images are removed. Scouts saving at the same time no longer wait for each other while the team is well under its cap. Admin cleanup summaries include sizes and age. Apply coordination and notice migrations before deployment and honor the owner-notice period before changing live retention.
