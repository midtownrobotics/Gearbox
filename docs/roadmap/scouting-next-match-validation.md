# Scouting next-match progression

Submitting a match report previously left the scout on the completed match until its shared submission window elapsed. The worker also rejected the next match because it only accepted the shared live match.

In TBA mode, `/event-context?assign=true` now selects that scout's first unsubmitted, unexpired match at or after the shared live match. Submission validation and the check after drawing uploads use the same selection. A successful report immediately loads the next assignment and an empty draft; the previous match's countdown does not apply to it. Other scouts can finish their current match until its own deadline, and Admin's Competition overview keeps the shared live match. Manual scheduling stays under the lead's control.

The frontend starts a fresh context request after submission and ignores older responses, including a poll started before the report was saved. A successful save stays successful when the next-assignment refresh fails; the completed draft stays disabled until a later refresh. Expired, duplicate, skipped and wrong-team submissions remain rejected. Existing reports, settings and API keys are unchanged, with no database migration.

Validation on 16 October 2026:

- A regression test reproduced the old behavior: after saving match 1 before its cutoff, the next context incorrectly stayed on match 1. It now opens and accepts match 2 while unfinished scouts and the Admin overview remain on match 1.
- All 80 Scouting worker tests and populated migration checks pass, including expired forms and expiry during drawing uploads. Frontend/worker type checks, production build, Worker dry run, tenancy lint and text-field lint pass.
- Chrome at 320, 390 and 768 pixels in both themes saves two consecutive reports with the correct match/team snapshots, clears answers and drawings between matches, keeps the next draft editable after the previous deadline, and ignores a delayed pre-submit poll. Failed post-submit refreshes retain the successful save and recover on refresh. No browser exceptions or horizontal overflow.
