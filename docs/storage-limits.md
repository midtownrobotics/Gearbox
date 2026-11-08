# Storage safeguards

When a new upload would exceed a cap, files strictly older than six calendar months are eligible
for automatic cleanup. Newer files are protected. Cleanup targets 90% usage where eligible files
permit it; there is no blanket age-only purge while storage stays below the cap.

| App | Per-team allowance | Per upload |
| --- | --- | --- |
| Shop | 5 GiB or 10,000 stored objects | 100 MiB per file |
| Scouting | 2 GiB or 25,000 stored objects | 12 MiB per image; 24 MiB per submission |
| Pit match logs | 20 completed logs, plus at most three pending uploads | 40 MiB compressed; at most four 10 MiB parts |
| Pit AdvantageScope assets | 100 MiB uncompressed and 10 assets | 50 MiB ZIP |

Ordinary request bodies are capped at 2 MiB at the gateway, including streamed bodies and false
Content-Type headers. Known file and printing routes retain their separate limits.

## Protection at capacity

Shop and Scouting count actual R2 objects under the team's prefix, including orphaned objects.
Replacements spend only their size difference. Expired files are selected oldest first, excluding
incoming replacement keys. If eligible files cannot free enough room for the hard cap, new growth
is refused without deleting recent files.
Downloads and existing manual deletion controls remain available.

Pit leaves new logs on the downloader at 20 unless the team chose Delete the oldest over six
months old: then it removes only expired logs when a new completed log would exceed 20, targeting
18 remaining, and never a newer one. Concurrent starts/completions
share the same team lock. AdvantageScope similarly targets 90 MiB / 9 assets on overflow, using
only expired assets and expired unreferenced files. A recently changed physical file protects an
otherwise old asset row. Missing or invalid dates do not establish expiration.

Expired incomplete multipart uploads may still be aborted after 30 minutes on the next start.
That removes unfinished staging parts, not completed match-log files. The downloader's local
source log is unaffected. Existing team-deletion, app-off retention and public-demo lifecycle
rules are separate from these storage caps.

## Six-month eligibility and the 90% target

The cutoff uses six calendar months in UTC, with month-end dates clamped (August 31 to February
28 or 29). A timestamp exactly at the cutoff is protected; it must be strictly earlier. Upload
and last-save timestamps are server-maintained. Zero, missing and invalid dates are protected.
Shop and Scouting use R2 upload timestamps. Pit uses its saved-log/asset timestamps, and verifies
referenced asset files are old too. Current app routes enable this expiration policy.

Cleanup considers the incoming save in its 90% byte/count target. Recent files are never selected
to achieve headroom. If only enough expired files exist to fit the hard cap, usage may remain above
90%. Whole-file deletion can free more than exactly 10%. An incoming batch larger than the soft
target may use the hard cap, and incoming files are never selected for deletion.

The engine still supports exact object-key/ETag approvals for an explicit reviewed operation,
but no current upload route provides these approvals and there is no new approval UI. Younger
files therefore require existing manual review/delete controls; app uploads cannot approve them.

A failed save or refused report does not trigger cleanup. Logical saves include their database
commit. An already-over-limit store is repaired before allowing more growth; cleanup failure
cannot repeatedly permit new writes. Successful writes can briefly exceed a cap by one batch.

The engine clears Shop file/drawing rows and batch links, and Scouting image references while
preserving report answers and auton steps. This is not a guarantee that approved deletions are
unimportant: value must be judged during review, not inferred from age.

## Coordination and admin notices

Shop and Scouting keep an estimate of each team's usage (`storage_usage`) that is never below
what's stored: every save adds its full size, deletes take nothing off, and only a count under the
lock corrects it. A save that keeps the estimate at or under 90% of the cap only adds itself, with
no lock and no count, so saves arriving together don't wait for each other. Past that, a save takes
the team's lock, counts R2, and cleans up as above.

Per-team D1 locks serialize those counted saves across isolates. A competing save waits up to ten
seconds, then gets 409 upload_busy with `Retry-After: 2`; Scouting's pages send it once more.
Locks expire after ten minutes if interrupted; writes must finish within the lease. This is not an
account-wide billing ledger.

After expiration-based or explicitly approved cleanup, the notification helper summarizes count, bytes,
upload-date range and age to the team log and active admins' connected Slack/Discord. It reports
first cleanup immediately, then accumulates follow-ups until another cleanup occurs at least an
hour later. There is no hourly timer or general email sender. Delivery is best effort. Usage warnings are separate: saves warn active admins at 90%, 95%, and 100%, using the higher byte/count utilization. Refused growth can warn that a save would reach 100%. Atomic per-team/allowance high-water claims suppress duplicates; only usage below 85% observed before a later save rearms the cycle. Cleanup toward 90% does not rearm it. A jump across thresholds sends the highest reached warning. Threshold warnings are recorded in the team log and delivered through connected chat, best effort.

The Gearbox team owner's account ID is stored by the platform, and their account email by G3ID.
That person is not necessarily the Slack workspace owner. Storage APIs expose no email addresses.

## Compact Scouting drawings

New drawings on the built-in field and auton trajectories save coordinates, tools, colors and a pinned field version as bounded JSON, rather than flattened PNGs. There is one canonical field SVG in the app/worker build, shared by every drawing. Legacy images and custom backgrounds are preserved; there is no bulk conversion or deletion of old images. Local report drafts and built-in maps also use compact JSON, with old image drafts supported.

These coordinate objects use the existing team-prefix quota and six-month cleanup policy. Single-file Storage downloads render standalone SVGs; bulk backups retain coordinate JSON and include the shared field SVG once per archive. Rendering for Analysis and image viewers happens on demand and saves no generated image in R2. See `workers/scouting/src/field-drawing.ts` and `drawing-storage.ts`.

Local editor review: `http://127.0.0.1:5182/preview/drawing` (Vite dev only) shows coordinate size, undo, restore and the saved view without signing in or writing team data.

## Team Storage page

Portal's admin-only `/admin/storage` reads Platform's `/team/storage` and shows each allowance's usage, oldest eligible files, saved dates and eligibility dates. Reads and downloads never delete files. Reports use the same server cutoff and Pit asset-group protection as cleanup. Friendly file labels come from team-owned records; unreferenced files retain their relative paths.

Service-binding hooks `/internal/teams/:teamId/storage`, `/storage/download` and `/storage/archive` stay inaccessible through the gateway. Platform selects the signed-in admin's team and the allowlisted app. Downloads remain available for retained data while an app is off. Group downloads stream stored bytes in .tar archives with manifests, split into at most 1,000 files / 512 MiB per request (a larger single legacy file streams alone); compressed files keep .gz extensions. Legacy Scouting files outside team prefixes are not included. Archive entries have unique part prefixes so extracting multiple parts does not overwrite same-named files. The per-request bounds keep large team exports within service-call limits ([Cloudflare subrequest limits](https://developers.cloudflare.com/workers/platform/limits/)). Counts are cached internally for 60 seconds by team/environment; failed app reports are explicit. Storage routes spend the gateway's costly-request quota.

Local UI review: start Portal's Vite server and open `http://127.0.0.1:5178/preview/storage`. This development-only view uses labeled sample data, disables downloads and sends no alerts. The actual page remains admin-only.

## Deployment and boundaries

Apply coordination migrations first: Shop 0026 and 0028, Scouting 0039 and 0041, Pit 0019 and 0021. Cleanup-notice support
uses Shop 0027, Scouting 0040 and Pit 0020. Threshold warnings also need Shop 0029, Scouting 0042 and Pit 0022. Existing committed migrations are not rewritten.
This PR does not deploy workers or send live messages. Before changing live retention for
existing teams, honor the owner-notice period in the current Terms of Service and publish the
matching retention notice.

Caps are per team/app. They do not cap D1, KV, device disks, external providers or total account
spend. Legacy Scouting objects outside the modern team prefix retain existing ownership and are
not newly counted by that prefix quota. Incomplete multipart lifecycle rules and live usage still
need account-level verification. The six-month policy is an explicit retention rule, not proof that an old file lacks value;
teams should export files they want to keep beyond the policy.
