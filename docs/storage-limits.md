# Storage safeguards

These limits stop a single team from rapidly filling the file buckets while leaving normal
downloads, deletion and existing records available. They take effect after migrations and deployment.

| App | Per-team allowance | Per upload |
| --- | --- | --- |
| Shop | 5 GiB or 10,000 objects, including manual drawings, part files and Onshape exports | 100 MiB per file |
| Scouting | 2 GiB or 25,000 objects under the team's prefix | 12 MiB per image; 24 MiB of images per submission |
| Pit match logs | Existing 20 completed logs, up to 800 MiB compressed, plus at most three pending logs | 40 MiB compressed, at most four 10 MiB parts |
| Pit AdvantageScope assets | Existing 100 MiB uncompressed and 10 assets | Existing 50 MiB ZIP |

Ordinary request bodies are limited to 2 MiB at the gateway before any downstream fetch. Checking
the actual stream also covers chunked bodies, missing Content-Length and misleading Content-Type
headers. Known file and printing routes keep their separate limits; changing Content-Type alone
does not exempt an ordinary data endpoint. Cross-app aliases receive the same checks.

## Quotas and replacements

`packages/auth/src/storage-limit.ts` scans actual objects under a team's prefix before storing a
file. Existing and orphaned files count; there is no stale usage cache. Pagination covers the full
prefix. Replacements spend only the difference, and deleting a file frees room for the next upload.
A team already over its allowance can replace files without increasing its byte or object count.
No existing files are automatically purged by the new quotas.

Each app's existing D1 database holds a short-lived, team-keyed upload lock so concurrent isolates
cannot spend the same space. Competing requests wait briefly, then return `409 upload_busy` with
retry guidance if another upload is still saving. Locks are released after writes and failures,
expire after 10 minutes if a worker is interrupted, and are removed on team deletion. This avoids
introducing another Cloudflare product. The guarantee assumes a write finishes within its lease;
this is a storage abuse safeguard, not an exact account billing ledger.

Quota exhaustion returns `409 storage_full` with instructions to remove unneeded files; individual
oversized uploads return 413. Downloads and deletion continue to work. The only automatic deletion
of completed Pit logs remains the team's existing opt-in "Delete the oldest" setting.

R2 listings are strongly consistent, including completed writes and deletions:
[Cloudflare consistency model](https://developers.cloudflare.com/r2/reference/consistency/).
Quota scans add R2 list operations to uploads, not ordinary page loads or downloads. At capacity
there are up to 10 pages in Shop and 25 in Scouting; monitor upload latency and list costs before
raising the object ceilings.

## Multipart uploads

Pit now reserves at most three pending log rows per team. An individual part must match the bytes
remaining in the declared log, and the part number cannot exceed four. Completion requires exactly
the expected contiguous parts and checks the actual resulting size. Starts and completions hold
the team lock, including the skip-new capacity check, so overlapping completions cannot exceed
the completed-log policy.

Pending uploads expire after 30 minutes and are aborted and removed on the next start. Deletion
also aborts unfinished log uploads. A failed metadata save aborts the multipart upload it just
created. Existing older abandoned uploads without database rows are not discoverable through
the Workers bucket listing: verify the bucket's incomplete-multipart lifecycle rule separately.
Cloudflare's default is seven days, but this PR has not inspected the deployed account's rules:
[R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## Deployment and remaining boundaries

Apply these migrations before deploying their workers (the normal deploy workflow already runs
migrations first): Shop `0026_storage_upload_locks.sql`, Scouting `0039_storage_upload_locks.sql`,
Pit `0019_storage_upload_locks.sql`. Without the table, affected uploads fail closed.

Limits are per team and per app, not an account-wide storage allowance. Existing Scouting objects
outside its modern team prefix retain their existing access rules and are not newly charged to
the prefix quota. Quotas do not count D1 rows, KV values, device disks, or storage held by external
providers. Request size and rate limits reduce their growth; there is no hard database-size or
account-spend cap here. Existing retention and cleanup jobs remain in effect. Verify deployed
usage, lifecycle rules and account alerts separately before treating the whole account as bounded.
