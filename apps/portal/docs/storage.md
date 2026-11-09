---
title: Storage
summary: Check storage usage, see which older files may be removed, and download a copy.
order: 5.5
pages: /admin/storage /admin/storage/seasons
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

## Export and reset a season

Open **Export and reset** on Storage, enter the **Game year**, and choose **Review season**. This covers Scouting's game data. Records linked to that year's official events are selected. Review and select any items marked **Choose manually** that belong to the same game, such as manual events, auton routines, shared field maps, robot profiles and photos, or reports without an event. Event dates and upload dates do not decide which game an item belongs to.

1. Choose **Prepare export**, then **Download** every archive part. Each part contains up to 100 records and 64 MiB of files, with records in `data.json`, the available uploaded files, a file manifest, relevant form templates, and the generic field image. Missing files are listed. Unusually large items need a separate download and help before resetting.
2. Keep the downloaded archives somewhere safe. Use **Verify saved archives** to select all the saved **.tar** files. An incomplete, changed, or unrelated archive will not pass. You can choose **Finish without reset** to keep all the data in Gearbox.
3. To clear the selected game data, choose **Reset backed-up data**, type the displayed **RESET** confirmation, and choose **Permanently reset**. This is permanent and can remove files less than six months old. It is separate from automatic cleanup at capacity.

Other game years and unselected items stay. Accounts, settings, form templates, permissions, API keys, points balances and points history stay. An active event being reset is cleared, while its credentials and other settings stay. Shop, Pit and other apps are unchanged. Maps and drafts saved only on a device are outside the export and reset. There is no automatic restore from these archives.

Records edited after the export and new records stay. A profile or event stays if it still has related data that was not removed. Files still referenced by another record, changed file versions, and older files outside the team's storage folder also stay. Review the season again after a reset to handle anything kept or added since export.

One export can be in progress per team. Use **Resume** after reopening the page and verify your saved archives again. Finish within 24 hours or close the export and start another; expiration never deletes game data. If a reset is interrupted, keep every archive and resume the same export. Completed parts are safe to retry. Exports and resets require an admin signed in with their own account, not a kiosk PIN, and requests are recorded in the team's Log.
