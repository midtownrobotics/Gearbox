# @g3/pit-log-downloader

## 2.0.0

### Major Changes

- d9a0513: The pit log downloader moved into Gearbox. It needs no settings file: on first start it asks to be paired with your team's Pit on Gearbox (a code from Pit's Logs page), and does nothing until it is. It uploads match logs to your team's Pit instead of Google Drive, its logs are kept in `data/`, and the status page only opens on the same computer unless `HOST` says otherwise. The status page has the Gearbox look, with light and dark mode, and its Copy path button works.

### Minor Changes

- e8407dd: Each log on the pit log downloader's status page has a Delete button: it deletes the log from the pit computer (it isn't copied off the robot again) and, for a log already in Pit, can delete it from Gearbox too.
- d9a0513: Pit's Logs page shows how to set up a pit log downloader on Windows, macOS or Linux and gives mentors and admins a code to pair it with, and the downloader asks for that code and the team number when it starts, before it copies anything. Once paired, its status page takes the team's colors, names and logo from Gearbox, and it uploads match logs to Pit, whose Logs page lists them to download (mentors and admins can delete them). Google Drive isn't used any more. Logs are gzipped and at most 40 MB each (a bigger one is trimmed on the downloader, with a suggested trim around the match) and 20 per team; teams choose whether a new log replaces the oldest, and can export and delete them all. Pit's Monitor shows the three newest logs under its stream feed, and Logs sits next to Admin in Pit's bar.
