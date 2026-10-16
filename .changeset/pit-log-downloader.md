---
"@g3/pit-log-downloader": major
---

The pit log downloader moved into Gearbox. Its team number, Google Drive folder and key file are now set in `config.env` (copy `config.env.example`) instead of in the code, its logs are kept in `data/`, Drive is optional, and the status page only opens on the same computer unless `HOST` says otherwise. The status page has the Gearbox look, with light and dark mode, and its Copy path button works.
