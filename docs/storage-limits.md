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

Per-team D1 locks serialize quota checks and writes across isolates. Competing uploads briefly
retry, then return 409 upload_busy if another save continues. Locks expire after ten minutes if
interrupted; writes must finish within the lease. This is not an account-wide billing ledger.

After expiration-based or explicitly approved cleanup, the notification helper summarizes count, bytes,
upload-date range and age to the team log and active admins' connected Slack/Discord. It reports
first cleanup immediately, then accumulates follow-ups until another cleanup occurs at least an
hour later. There is no hourly timer or general email sender. Delivery is best effort. Merely approaching a cap sends nothing; summaries follow actual deletion.

The Gearbox team owner's account ID is stored by the platform, and their account email by G3ID.
That person is not necessarily the Slack workspace owner. Storage APIs expose no email addresses.

## Deployment and boundaries

Apply coordination migrations first: Shop 0026, Scouting 0039 and Pit 0019. Cleanup-notice support
uses Shop 0027, Scouting 0040 and Pit 0020. Existing committed migrations are not rewritten.
This PR does not deploy workers or send live messages. Before changing live retention for
existing teams, honor the owner-notice period in the current Terms of Service and publish the
matching retention notice.

Caps are per team/app. They do not cap D1, KV, device disks, external providers or total account
spend. Legacy Scouting objects outside the modern team prefix retain existing ownership and are
not newly counted by that prefix quota. Incomplete multipart lifecycle rules and live usage still
need account-level verification. The six-month policy is an explicit retention rule, not proof that an old file lacks value;
teams should export files they want to keep beyond the policy.
