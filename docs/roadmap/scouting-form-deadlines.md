# Scouting form deadline validation

Match forms now show the team's configured submission window (120 seconds by default), then the local cutoff time and a countdown when TBA supplies match timing. The cutoff is calculated by the same helper as automatic match advancement. Manual schedules reset on the lead's match or assignment change rather than inventing an automatic cutoff.

At expiry, the draft's answers, counters, selections and drawings clear, the assigned team clears, and submission locks while the page refreshes its assignment. A changed match or assigned team mounts an empty draft. Returning to the page refreshes assignments immediately. Pit forms do not reset with match timing.

Normal match submissions must include `matchKey` and the assigned `teamName`. The worker checks the current schedule, cutoff and assignment, and repeats those checks after drawing uploads. Rejected uploads are removed. An old draft is never silently reassigned to a new match or team. Previously loaded clients without `matchKey` receive a refresh error; reloading loads the updated form. Existing saved reports and settings are preserved, with no new migration.

Validation on 16 October 2026:

- All 78 Scouting worker tests pass, including valid snapshots, stale match IDs, missing IDs, wrong teams, changed assignments, expired final matches, manual match changes, and expiry during drawing upload with cleanup. Populated migration checks pass.
- Scouting frontend and worker type checks pass. Production frontend build and Worker dry run pass without deploying.
- Local Chrome exercises text and canvas resets, expiry while offline, disabled late submission, correct multipart match/team/drawing payloads, delayed responses after a match change, and pit draft preservation at 320, 390 and 768 pixels in light and dark themes. No horizontal overflow or page errors.
