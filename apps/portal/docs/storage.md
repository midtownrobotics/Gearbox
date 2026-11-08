---
title: Storage
summary: Check storage usage, see which older files may be removed, and download a copy.
order: 5.5
pages: /admin/storage
access: admin
---

Open **Admin → Storage** to check your team's files in Shop, Scouting, and Pit. Each allowance shows its size and file or item count. Pit match logs and AdvantageScope assets have separate allowances. Use **Refresh usage** to check again; counts may be up to one minute old. An app that cannot be checked shows an error rather than zero usage.

## Which files may be removed

**Eligible** means a file is strictly older than six calendar months and may be removed when a new save exceeds that allowance. Eligible files appear oldest first. **Protected** files are kept; their row shows when they may become eligible, if their saved date is known. AdvantageScope assets stay protected while any of their files are recent.

There is no scheduled deletion date. Pit match logs follow the choice on Logs: by default new logs wait on the downloader at capacity. Only teams that choose **Delete the oldest over six months old** allow that cleanup; Storage shows whether it is enabled. When a save exceeds a cap, cleanup removes the oldest eligible files toward 90% usage. If eligible files cannot make room, new saves pause. Download files you want to keep before reaching the cap. Deletion is permanent. Written Scouting reports and auton steps remain when their images are removed.

These allowances cover the listed uploaded files. Older Scouting files saved before team storage was introduced are outside them. Switching an app off still has its separate 90-day retention period, described in [Switch apps on and off](apps).

## Download a copy

- **Download** saves one file.
- **Download all files** saves all files in that allowance.
- **Download eligible files** saves the files currently eligible for cleanup.

Group downloads are **.tar archives**. Large downloads are split into parts of up to 1,000 files or 512 MiB; download each part shown. Extract the archive with your computer's archive tool; its `manifest.json` lists original names and saved dates. For Scouting coordinate paths, an individual download is a standalone **.svg** image. Bulk backups keep the original coordinate JSON and include **field-2026.svg** once per archive.

Files ending in **.gz** are compressed: unzip them before opening their contents. Downloading keeps the originals in Gearbox. If files change during a download, refresh the page and try again.

Files retained after switching an app off can still be downloaded here during its retention period. The JSON download on Manage Apps contains records and file references; it does not include the actual uploaded files.

## Usage warnings

Active admins receive a message through the team's connected Slack or Discord when an allowance reaches **90%, 95%, or 100%**, based on whichever of size or item count is closest to its limit. A save that would exceed the cap can also trigger the 100% warning. A jump across multiple thresholds sends the highest warning once. Warnings are also recorded in the team's Log.

Each threshold is reported once until usage drops **below 85%**. Automatic cleanup toward 90% does not restart the warning cycle. The next save observes manual removals and rearms warnings if enough space was freed. Usage warnings follow saves or refused saves, without needing this page open.

Cleanup summaries arrive after actual deletions: the first immediately, then at most once an hour when another cleanup happens. Chat delivery is best effort; teams without connected chat can still check Storage and the Log. These messages are separate from the announcement settings on Notifications.
