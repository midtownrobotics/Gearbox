---
"@g3/pit-log-downloader": major
---

The pit log downloader moved into Gearbox. It needs no settings file: on first start it asks to be paired with your team's Pit on Gearbox (a code from Pit's Logs page), and does nothing until it is. It uploads match logs to your team's Pit instead of Google Drive, its logs are kept in `data/`, and the status page only opens on the same computer unless `HOST` says otherwise. The status page has the Gearbox look, with light and dark mode, and its Copy path button works.
