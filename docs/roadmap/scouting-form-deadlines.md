# Scouting form deadlines

A match form has to move scouts on to the next match in time to watch it, without sending a report
to the wrong match and without throwing away anything a scout wrote. These are the rules.

## The match a report is for

A report goes to the match its form was filled in for: the page sends that match's `matchKey`,
never "whichever match is current when it arrives". `reportMatch` in `workers/scouting/src/index.ts`
takes it:

- **On time**: `matchKey` is the scout's own match (`resolveEventLink`) and its window hasn't closed.
- **Late**: `matchKey` is an earlier match in the schedule, and the team's late window
  (`late_window_seconds`, 600 by default, 0 to 3600; migration `0036`) hasn't run out since that
  match moved on. With The Blue Alliance, a match moves on at its close (`matchSubmissionClosesAt`:
  results posted plus the team's move-on window). On a manual schedule there are no results, so it
  moves on when the scout is given a later match (the earliest later `assigned_at`).
- Never for a match that hasn't come up yet.

Either way the scout's assignment for that match must name the team sent, and they mustn't have a
report for it already. A late report is saved with `submitted_late = 1`; the leads' overview marks
it "Late" and Analysis shows "Sent late". The checks run again after drawings upload, and a report
that became late meanwhile is recorded as late; one that became too late is refused and its uploads
removed.

## Moving on

`submission_window_seconds` ("Move on after a match", 120 by default) is how long a match stays
current after it's scored. A scout who has sent their report doesn't wait for it: `/event-context`
answers them with `scoutMatch`, the next match (`matchAfterSubmitting`), while `currentMatch` stays
the team's own for the leads' overview. `upcomingMatch` is the match after the scout's.

## On the page

`MatchEntry` in `apps/scouting/src/ScoutingForms.tsx`, with the parts in `match-handover.tsx`:

- **Drafts are kept on the device** (`match-drafts.ts`): answers and field map drawings (as JPEG
  data URLs), per scout, form and match, saved as they're written and at once when the page is
  hidden or closed. A reload picks the draft back up ("Your saved answers are back"). Drafts more
  than 12 hours old, and beyond the newest 8, are removed; if storage is full the drawings are
  dropped before the answers.
- **A form with answers in it is never pulled away.** A clean form follows the server's match at
  once, with "Now scouting …" when it changes. A form with answers stays on its match until:
- **The move-on bar**, pinned to the bottom, 20 seconds before the close (or, on a manual schedule,
  for 20 seconds once the lead moves on): "Moving to Qualification 21 in 0:19", Send now and
  +30 s. Each +30 s puts the bar away until the last 20 seconds of the added time. A scout can add
  time at most three times, never past the late window and not once the next match has started.
- **When the time runs out** the draft stays on the device and the form moves to the next match.
  The kept report is offered above it ("Unsent Qualification 20 report · Team 254"): Send it sends
  it late to its own match, Discard asks first. Nothing is deleted on its own.
- **After a report is sent**, a done screen replaces the form: what was sent, then the next match
  and team once it's open ("Opens on its own"), at the next match's start time, or a minute later
  without one. Start opens it at once. Before the next match is open it says it opens once this one
  is scored.

Pit forms have no match timing and keep no drafts.

## Validation (17 October 2026)

- Scouting worker tests: 84 pass, including on-time and late reports landing on their own match,
  the late window running out, a match that hasn't come up yet, the final match after its close, a
  manual match after the lead moves on, a report that becomes late during its upload, one that
  becomes too late (uploads removed), and the admin setting's limits.
- The real page in Chrome (Vite dev server, API answered by fixtures, the clock moved by the test)
  at 390 and 768 pixels, light and dark: the countdown banner, the bar and +30 s, the form staying
  on its match past the close, moving on with the report kept, sending it late (its match, team and
  answers), the done screen waiting for scoring then naming the next match, Start, and a reload
  restoring typed answers. No sideways scroll or page errors.
