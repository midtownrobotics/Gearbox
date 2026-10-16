# Scouting report filters

Validated locally on 16 October 2026. This follows the mobile drawing changes in merged PR #220 and is based on current main, including the counter fixes in #226.

## Behavior

- Scouting Forms has separate Match scouting and Pit scouting selectors. Each shows only its own forms, including the appropriate entry and editing tools.
- Analysis defaults to match scouting. Report type can select match scouting, pit scouting or all reports. Sort reports can group by report type, newest first within each type.
- Report type and competition apply together to Stats, Auto path and Compare. Comparison averages and report counts use the filtered data for both teams; events belonging only to the second team remain selectable.
- Competition choices, report details, comments and auto-path captions display resolved event names and sort by those names. The worker reads public TBA short names (full names if no short name exists) and caches them for a day. Manual-event names stay scoped to their team. If TBA is unavailable or unconfigured, reports remain accessible with their existing event identifiers.
- Opening a particular submission selects its report type so a pit submission is not hidden by the match default.

## Validation

- Scouting worker tests: 37 passing, including four new tests covering match/pit metadata, TBA short/full names, cached names without credentials, two-team manual-event isolation, and unavailable/unconfigured TBA. The populated migration check also passes.
- Frontend and worker type checks, frontend production build, Biome on changed code, text-field lint, tenancy lint and whitespace checks.
- Six browser configurations: light/dark at widths 320, 390 and 768. Fixtures include match and pit reports, multiple teams, STING, Dalton, a named manual event and an unassigned report. Thirty page captures have no viewport overflow or browser exceptions.
- Browser checks cover separate form choices and editable pit team numbers; default match-only reports; combined pit/STING filtering and counts/averages; readable competition choices and expanded report metadata; filtered auto paths; both teams' filtered comparison averages; events found only for team B; sorting all reports by type; and an empty combined-filter result.

Browser API responses are fixtures; these checks validate real frontend controls and calculations. Backend tests exercise the real worker and local D1/cache against mocked outbound TBA responses. Physical-device and production validation are outside these checks.

## Manual check

1. In Scouting Forms, switch between Match scouting and Pit scouting. Only forms of the selected type should appear.
2. In Analysis, choose Pit scouting and a named competition. Reports, counts and averages should reflect those two filters together.
3. Select All reports and sort by Report type. Match reports should precede pit reports, newest first within each group.
4. Switch to Auto path and Compare. The chosen report type and competition should still apply, including to both teams' comparison figures.
