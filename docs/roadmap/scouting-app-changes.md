# Scouting app change plan

Updated 21 October 2026. Source: the user's Changes.docx and follow-up answers. The changes below are implemented locally and awaiting PR review against `staging`; they are not deployed. The feature descriptions remain the acceptance plan.

Implementation is split between the Scouting interface (extending PR #261) and a separate compatible Worker PR. Review and merge the Worker, including migration `0037`, before the interface. The Worker accepts existing single-category ticket clients and form creation without a kind (defaulting to match scouting).

Verification: Scouting app build and both TypeScript checks pass; all 102 Worker tests pass, including five new workflow cases; populated migration checks verify ticket preservation and per-form duplicate protection. App regression checks cover newest-match ordering and draft separation. Repository Biome, text-field and tenancy lint pass. Browser visual verification is still needed: no browser was connected in this session.

## Confirmed decisions

- Remove highlights from Analysis. Do not add a Highlights tab.
- In Stats, sort both the team list and each team's expanded reports by most recent match first.
- Auto paths should stay compact until a match is opened: team, then match, then its paths.

## 1. Group Auto paths by team and match

Status: implemented in [PR #261](https://github.com/midtownrobotics/Gearbox/pull/261), alongside clearer Compare team labels. The interface PR is extended with the remaining interface work below. Merge and deployment remain separate from implementation.

- Show teams in numeric order, with matches nested beneath each team.
- Show the path only when its match is expanded. Keep multiple reports for that match together.
- Keep events distinct and retain full-size viewing and authorized deletion.

Acceptance: team 2 precedes team 10; qualification and playoff matches follow match order; closed groups do not load all their images. Reports without a match remain identifiable.

## 2. Open a match summary, then a team's report

Current Matches cards list alliances and scores without scouting drilldown.

- Selecting a match opens its summary: match identity, alliance lineups and scores, and available scouting data for each team.
- Selecting a team opens that team's match-specific answers, comments and Auto path. Identify the form and scout when multiple reports exist.
- Label missing scouting data explicitly; do not display missing values as zero or silently substitute another match's data.
- Preserve event and form filters throughout the drilldown, with a clear way back to the match summary.

Acceptance: a match with six teams can show a mix of submitted and missing reports; each team opens only its own reports for that match and event. The flow works on mobile.

## 3. Record no/minimal Auto movement

- Add a selectable **No/minimal movement** option directly below each Auto path image in the scouting form.
- Save that choice explicitly with the report, including local drafts and delayed submissions. An empty drawing alone does not mean no movement.
- Make switching between drawing and this option clear, so a report cannot unintentionally claim both a path and no/minimal movement.
- Show a labeled entry in Analysis even when there is no path image. Existing blank-image filtering must retain this explicit result.

Implementation: extend the report payload and persistence with a field-specific movement status; validate it on the Worker. Keep existing reports readable without backfilling inferred movement.

Acceptance: selection survives reload, submission and reopening in Analysis; clearing it restores an unanswered state; existing drawn paths still work. Preserve assignment checks and submission deadlines.

## 4. Clean up Stats and remove highlights

- Remove the Highlights count, report-star controls and highlighted field styling from Analysis. Remove star-based prioritization from its report query.
- Preserve stored historical star data initially; this UI change does not require deleting it.
- Fix empty structural cells, alignment and spacing in the expanded Stats table. Use a consistent missing-value marker where a form has no answer for a column.
- Default the team list to each team's most recent match first. Within each expanded team, show the most recent match first as well.
- Determine recency by event context and match order, with deterministic ties. A late upload for an old match must not become the newest match. Keep reports without match identity after identified matches; pit reports can use submission time.
- Preserve useful user-selected column sorting. Do not reverse the shared chronological helper globally, because Auto paths use match order independently.

Acceptance: a team last seen in qualification 20 precedes one last seen in qualification 9; each team's reports follow the same newest-first rule. Playoffs sort correctly. Late uploads, missing answers and different form columns do not break alignment or ordering.

## 5. Name forms and allow multiple active forms

- Keep Match scouting and Pit scouting as the two categories. Show each form's editable descriptive name underneath its category and on the form itself.
- Let authorized form managers create, rename and manage multiple forms in either category.
- Give each form an explicit Active switch; more than one form in either category may be active. Make active choices easy to distinguish on mobile.
- Scouts choose among active forms. Managers can also see and edit inactive forms, with a clear inactive label.
- Renaming preserves the form ID, drafts and historical reports. Deactivation preserves history and does not silently discard a draft.

Implementation: build on existing `name`, `form_kind` and `is_active` fields. Creation must save the requested kind; updates must respect active state instead of always reactivating a form. Keep authorization checks on the Worker. Retain existing admin/strategy-lead form-management permissions unless a separate role change is requested.

Allow a scout to submit each active match form for the same assigned team/match; the duplicate guard must distinguish form IDs. Selecting another form must preserve the first form's draft and retain all assignment, deadline and tenant checks. Automatic match advancement must not skip another active form's unfinished work.

Acceptance: two match forms and two pit forms can be active together; each has a distinct name and selection card. Editing an inactive form leaves it inactive. Unauthorized users cannot create, rename or activate forms. Historical reports remain readable after rename or deactivation.

## 6. Select multiple service issue categories

- Replace the issue-type dropdown with a compact multi-select for Mechanical, Electrical and Programming, retaining an Other/Not sure choice.
- Apply this to both Operations and the service-ticket form within Scouting.
- Require an explicit choice instead of preselecting Mechanical. One ticket can carry multiple categories.
- Show every selected category on ticket lists and details. Update filters and any skill-based routing or notifications to consider all categories.

Implementation: add array storage with a migration from each existing scalar issue type to a one-item array. Validate allowed values, reject duplicates and preserve existing tickets and status history. Update API types and both clients together; provide compatibility during rollout if old clients can still submit scalar values.

Acceptance: a Mechanical + Electrical ticket appears once, shows both categories and matches either category filter. Existing single-category tickets remain readable. Unknown categories and cross-team access are rejected.

## 7. Use bubbles for Yes/No questions

- Render Yes/No questions as a labeled pair of radio choices instead of a dropdown.
- Keep unanswered distinct from No. Retain existing answer values and required-field validation.
- Keep other multiple-choice questions unchanged. Use a shared renderer so all scouting entry flows behave consistently.

Acceptance: keyboard and touch selection work, each pair has an accessible group label, and saved Yes/No values reopen correctly without selecting an answer by default.

## 8. List teams still needing pit scouting

- Add an event-scoped **Not pit scouted** list with team number, name and a direct way to begin a pit report.
- Compute it from the full event roster minus teams with a non-archived pit report for that event. Teams with no scouting submissions must still appear.
- Reuse the existing event-team lookup and supported manual roster. Show loading and roster failures clearly rather than presenting an unreliable complete/missing count.
- Show completed and remaining counts; refresh coverage after submission or archival.

Planned default with multiple active pit forms: a team counts as pit scouted after any submitted pit report for the event. If coverage must require every active pit form, make that a separate explicit completion rule rather than silently changing the count.

Acceptance: reports from another event do not complete the current event; duplicate reports count once; archived reports do not count. Teams and reports stay scoped to the signed-in organization.

## Implementation PRs and verification

| PR | Scope | Dependencies |
| --- | --- | --- |
| Worker workflows | Form kind/activation, per-form submissions and advancement, explicit movement answers, match report filtering, pit coverage, service category storage and migration | Based on `staging`; merge first |
| Extended #261 interface | Compare labels, grouped Auto paths, match/team drilldown, Stats cleanup, named active forms, Yes/No controls, movement choice, service multi-select and category filter, pit coverage with a Scout action | Requires the Worker workflows PR |

For each implementation PR, run the affected app build, repository lint and relevant tenancy checks. Add focused verification for match ordering, report/form identity, draft preservation, migration compatibility and event/team isolation where behavior changes. Review mobile layouts using realistic missing data and multiple reports, not only fully populated samples. Record actual results in each PR.

Merge implementation into `staging` for verification. Production release and deployment are separate actions; this plan does not merge release PRs or update the Edge box.

## Main code locations

- Analysis: `apps/scouting/src/Analysis.tsx`, `AnalysisTeamTable.tsx`, `analysis-table.ts`, `AnalysisAutoPaths.tsx` and `analysis-auto-paths.ts`.
- Forms, draft integration and field rendering: `apps/scouting/src/ScoutingForms.tsx`, `FormFieldMap.tsx` and the scouting draft helpers.
- Service tickets: `apps/scouting/src/Operations.tsx` and the service form in `ScoutingForms.tsx`.
- API, authorization, reports, event roster and ticket handling: `workers/scouting/src/index.ts`.
- Persistence: `workers/scouting/src/db/schema.ts` and the Scouting migration directory.
