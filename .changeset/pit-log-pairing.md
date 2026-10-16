---
"@g3/worker-pit": minor
"@g3/pit-log-downloader": minor
---

Pit's Logs page shows how to set up a pit log downloader on Windows, macOS or Linux and gives mentors and admins a code to pair it with, and the downloader asks for that code and the team number when it starts, before it copies anything. Once paired, its status page takes the team's colors, names and logo from Gearbox, and it uploads match logs to Pit, whose Logs page lists them to download (mentors and admins can delete them). Google Drive isn't used any more. Logs are gzipped and at most 40 MB each (a bigger one is trimmed on the downloader, with a suggested trim around the match) and 20 per team; teams choose whether a new log replaces the oldest, and can export and delete them all. Pit's Monitor shows the three newest logs under its stream feed, and Logs sits next to Admin in Pit's bar.
