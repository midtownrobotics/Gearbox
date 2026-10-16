# Scouting form deadline validation

Match forms now show the team's configured submission window (120 seconds by default), then the local cutoff time and a countdown when TBA supplies match timing. The cutoff is calculated by the same helper as automatic match advancement. Manual schedules reset on the lead's match or assignment change rather than inventing an automatic cutoff.

At expiry, the draft's answers, counters, selections and drawings clear, the assigned team clears, and submission locks while the page refreshes its assignment. A changed match or assigned team mounts an empty draft. Returning to the page refreshes assignments immediately. Pit forms do not reset with match timing.

Normal match submissions must include `matchKey` and the assigned `teamName`. The worker checks the current schedule, cutoff and assignment, and repeats those checks after drawing uploads. Rejected uploads are removed. An old draft is never silently reassigned to a new match or team. Previously loaded clients without `matchKey` receive a refresh error; reloading loads the updated form. Existing saved reports and settings are preserved, with no new migration.

## Moving on once a report is in

The window after a match keeps everyone on it so a report still being written lands on the right
match. A scout who has already sent theirs has nothing left to wait for, so `/event-context`
answers them with `scoutMatch`: the team's current match until their report for it is in, then the
match that would be current with no window at all (`matchAfterSubmitting`). Their assigned team,
countdown and `hasSubmittedCurrentMatch` are all about `scoutMatch`, and `resolveEventLink` applies
the same rule, so a report for it is accepted. `currentMatch` stays the team's own match, so the
leads' overview still follows the match being scouted, and a manual schedule is unchanged: the lead
sets the match.

This means the window can be as long as a team needs without holding scouts back. The confirmation
is shown above the draft, not inside it, so it survives the empty form that replaces it: it names
the match the report went to and the match the scout is on now.

Validation on 16 October 2026:

- All 78 Scouting worker tests pass, including valid snapshots, stale match IDs, missing IDs, wrong teams, changed assignments, expired final matches, manual match changes, and expiry during drawing upload with cleanup. Populated migration checks pass.
- Scouting frontend and worker type checks pass. Production frontend build and Worker dry run pass without deploying.
- Local Chrome exercises text and canvas resets, expiry while offline, disabled late submission, correct multipart match/team/drawing payloads, delayed responses after a match change, and pit draft preservation at 320, 390 and 768 pixels in light and dark themes. No horizontal overflow or page errors.
