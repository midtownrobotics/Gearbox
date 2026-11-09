# Storage safeguards

When a new upload would exceed a cap, cleanup removes the oldest stored files toward 90% usage.
Files older than six calendar months go first. If they cannot reach the target, cleanup continues
with the oldest remaining files, including recent files. There is no age-only purge below the cap.

| App | Per-team allowance | Per upload |
| --- | --- | --- |
| Shop | 5 GiB or 10,000 stored objects | 100 MiB per file |
| Scouting | 2 GiB or 25,000 stored objects | 12 MiB per image; 24 MiB per submission |
| Pit match logs | 20 completed logs, plus at most three pending uploads | 40 MiB compressed; at most four 10 MiB parts |
| Pit AdvantageScope assets | 100 MiB uncompressed and 10 assets | 50 MiB ZIP |

Ordinary request bodies are capped at 2 MiB at the gateway, including streamed bodies and false
Content-Type headers. Known file and printing routes retain separate limits.

## Oldest first and the 90% target

Shop and Scouting count actual R2 objects under the team's prefix, including orphaned objects.
Replacements spend only their size difference. All existing files can participate in capacity
cleanup; incoming/replacement keys are excluded. Server upload timestamps determine order, with
unknown dates last and deterministic key ties. Strictly older-than-six-calendar-month files
naturally precede recent files. The shared `StorageEviction.deleteOldest` enables this behavior.
The separate exact key/ETag approval mode remains available for reviewed operations.

The incoming save counts toward both byte and object targets. Whole-file deletion can free more
than exactly 10%. If the incoming batch alone exceeds the 90% target, the target rises to that
batch's size/count, bounded by the hard cap. A batch larger than the hard cap is refused.

A failed save or refused report does not trigger cleanup. Logical saves include their database
commit. An already-over-limit store is repaired before allowing more growth; cleanup failure
cannot repeatedly permit new writes. Successful writes can briefly exceed a cap by one batch.
The engine clears Shop file/drawing rows and batch links, and Scouting image references while
preserving written report answers and auton steps. Capacity cleanup can remove useful files;
teams must download anything they want to keep before filling the allowance.

Pit leaves new logs on the downloader at 20 by default. With **Delete the oldest logs** enabled,
a new completed log above 20 removes the oldest stored logs toward 18 remaining, including recent
logs when needed. Concurrent starts/completions share the same team lock. Pending uploads are
never cleanup candidates. Incomplete multipart uploads may be aborted after 30 minutes on the
next start; the downloader's local source log is unaffected.

AdvantageScope targets 90 MiB / 9 assets on overflow. Assets are removed as a unit, ordered by
the most recent save across their metadata and physical files. Unreferenced files count toward
bytes and join the same oldest-first ordering. Incoming assets and their replacement keys stay.

## Coordination and admin notices

Shop and Scouting maintain a pessimistic `storage_usage` ledger. A save whose reservation stays
below 90% skips the lock/count; near capacity it takes the team lock, recounts R2 and performs
cleanup. Counted saves wait up to ten seconds, then return 409 upload_busy with Retry-After: 2;
Scouting retries once. Locks expire after ten minutes. These are not account-wide billing limits.

Cleanup notices summarize count, bytes, saved-date range and age in the team Log and active
admins' connected Slack/Discord. The first summary is immediate; later summaries accumulate until
another cleanup occurs at least one hour later. There is no hourly timer or email sender.
Threshold warnings at 90%, 95% and 100% use the higher byte/count utilization. Atomic claims
suppress duplicates until actual usage below 85% rearms the cycle on a later save. Cleanup toward
90% does not rearm alerts. Delivery is best effort, and warning text explains recent-file fallback.
The platform knows the Gearbox team owner's account ID; G3ID holds their email, which is not
necessarily a chat workspace owner's email. Storage APIs expose no email addresses.

## Compact drawings and Storage

New Scouting field paths store bounded coordinates and a pinned field version, following the
same quota and oldest-first cleanup as other files. Legacy images remain readable. Single-file
downloads render standalone SVG; archives keep original JSON and include the shared field SVG.
Rendering stores no generated image in R2. See `workers/scouting/src/field-drawing.ts`.

Portal's admin-only `/admin/storage` shows each allowance, saved dates, oldest-first file lists
and **May be removed** status, including recent files. Pit logs show **Cleanup off** while the
team keeps the default setting. Reads/downloads never delete anything. Platform enforces the
signed-in team and allowlisted app for internal storage hooks. Retained files remain downloadable
when an app is off. Bounded TAR downloads stream at most 1,000 files / 512 MiB per part (a larger
single legacy file streams alone). Files retain unique archive names and compressed .gz bytes.
Successful counts are cached for 60 seconds per team/environment; unavailable apps show errors.

Local previews: Portal at `http://127.0.0.1:5178/preview/storage`, season review at
`http://127.0.0.1:5178/preview/season`, drawing editor at `http://127.0.0.1:5182/preview/drawing`.
They use development-only sample data, with no live team writes.

## Deployment and boundaries

Required migrations remain Shop 0026-0029, Scouting 0039-0043, and Pit 0019-0022. No migration is
rewritten or added for oldest-file fallback. Season exports/reset have a separate verified-backup
workflow. Team deletion, app-off retention and public-demo lifecycle rules are unchanged.

Before changing live retention for existing teams, honor the notice period in the current Terms
of Service and publish the matching retention notice. This PR does not deploy workers or send
live messages. Caps do not limit D1, KV, device disks, external providers or total account spend.
Legacy Scouting objects outside the team prefix retain their existing ownership and are not newly
counted or cleaned by this prefix quota. Provider-side lifecycle rules still need account checks.
