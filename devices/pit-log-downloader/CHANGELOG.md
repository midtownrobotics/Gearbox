# @g3/pit-log-downloader

## 2.2.0

### Minor Changes

- 1e15859: The pairing page can pair with a Pit at another address (Use another Pit address), such as staging, without changing config.env.
- 1e15859: A log deleted from Gearbox has an Upload again button on the status page.

### Patch Changes

- 05068af: Your team's logo keeps its shape in the top bar: a wide logo shows wider and a tall one narrower, instead of being squeezed into a square.
- 73d2f28: Long links, part names and other long text wrap or are cut short on phones instead of making the page scroll sideways.

## 2.1.0

### Minor Changes

- 3c67e43: Pit's Logs page and Monitor show what the log downloader is doing: online, connected to the robot, copying and uploading. The Monitor's Recent Logs is now Logs, and In the pit now is at the top of its left column. On the downloader, the robot shows as connected as soon as the computer joins its network, the page no longer stalls while logs copy, it checks the robot again for new logs while connected, and "In Gearbox" follows what Pit has. Deployers: apply Pit's migration 0017 first.

### Patch Changes

- 011e4d8: Pairing and uploads no longer fail with "Couldn't reach Gearbox" on networks without IPv6 or with a slow first connection.
- 6077315: A log copy cut off by the robot leaving (or one that stops moving) now ends and is tried again the next time the robot is connected, instead of staying stuck on Copying.

## 2.0.0

### Major Changes

- d9a0513: The pit log downloader moved into Gearbox. It needs no settings file: on first start it asks to be paired with your team's Pit on Gearbox (a code from Pit's Logs page), and does nothing until it is. It uploads match logs to your team's Pit instead of Google Drive, its logs are kept in `data/`, and the status page only opens on the same computer unless `HOST` says otherwise. The status page has the Gearbox look, with light and dark mode, and its Copy path button works.

### Minor Changes

- e8407dd: Each log on the pit log downloader's status page has a Delete button: it deletes the log from the pit computer (it isn't copied off the robot again) and, for a log already in Pit, can delete it from Gearbox too.
- d9a0513: Pit's Logs page shows how to set up a pit log downloader on Windows, macOS or Linux and gives mentors and admins a code to pair it with, and the downloader asks for that code and the team number when it starts, before it copies anything. Once paired, its status page takes the team's colors, names and logo from Gearbox, and it uploads match logs to Pit, whose Logs page lists them to download (mentors and admins can delete them). Google Drive isn't used any more. Logs are gzipped and at most 40 MB each (a bigger one is trimmed on the downloader, with a suggested trim around the match) and 20 per team; teams choose whether a new log replaces the oldest, and can export and delete them all. Pit's Monitor shows the three newest logs under its stream feed, and Logs sits next to Admin in Pit's bar.
