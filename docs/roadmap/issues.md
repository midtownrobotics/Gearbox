# Reporting problems and ideas

Goal: anyone using Gearbox can report a problem or ask for something, without a GitHub account or knowing how GitHub works, and hear back when it's dealt with.

Status: **steps 1 to 3 built** (branch `issue-reports`): every app's menu has "Report a problem", each report becomes a public issue on midtownrobotics/Gearbox (decided 23 October 2026: public, like any GitHub issue), and the reporter gets a DM on the team's chat when it's closed. The daily Claude task's instructions are in [ai-task-prompt.md](ai-task-prompt.md), with the issue template `.github/ISSUE_TEMPLATE/ai-ready.yml`. Issues made on GitHub use `problem.yml` and `idea.yml`, which ask for the details a report adds (app, page, app version, platform version, browser, team) and carry its labels; the routine itself and the labels are set up by hand (`docs/deploy.md`, "Problem reports on GitHub"). Step 4 (votes) waits for demand.

## What was built

- **The button**: "Report a problem" in the foot of the shared bar's menu (`AppNavBar`), or in the bar itself when it has no app list. Signed out, on the public demo and on pages that are no team's, it opens `GitHubReportDialog` instead: it opens the repository's Problem or Idea form on GitHub with what they wrote and the page, app and platform versions, browser and team filled in from the link, to write on their own GitHub account. For a team's signed-in member it opens `ReportDialog` (`packages/ui/src/components/report-dialog.tsx`): a problem or an idea, and what happened. Its hint says reports are public.
- **The platform** (`workers/platform/src/reports.ts`, migration `0012`, table `problem_reports`): `POST /team/reports` checks it (10 to 4,000 characters, 5 a member an hour; a team's first 5 a day freely, then one every 10 minutes until midnight UTC), stores it and makes the issue: titled with the member's optional title (migration `0014`, up to 80 characters) or else the text's first line; laid out like an issue made with the Problem and Idea forms (a `###` heading per field), the text as written with @mentions broken so nobody is pinged; the app (from the page's address), the page without its query string, the versions, the browser, the team's number and the sender's reporter ID (`reporters`, migration `0013`: a random ID per member, never their account id), and the sender's name only when they turn on the form's "Put my name on it" (`withName`, kept as `reporter_name`, migration `0015`; off by default); labels `from-gearbox`, `bug` or `idea`, and the app's label where the repository has one. `GET /team/reports` is the member's own. In the demo guard's `DEMO_BLOCKED`, and refused for the demo team.
- **Blocking reporters**: an operator who sees a reporter misusing it blocks their reporter ID on the console's Reporters page (`/console/reporters`; `GET /console/reporters`, `POST /console/reporters/:id { blocked, reason }`, logged as `block_reporter`/`unblock_reporter` with no team, so the team's admins don't see it). The console shows the ID and the team's number (both on the public issue), never the member; the team's admins get a chat DM (`tellBlocked`) with who it is, a link to their page and the reason, and another when it's unblocked. A blocked reporter's `POST /team/reports` answers 403, and their unsent reports are never sent.
- **Members see their own ID**: the report form (`ReportDialog`) shows it from `GET /team/reports/reporter` (made then if they have none) and says it can be blocked for spam or misuse, and that the team's admins would be told. **Admins see everyone's**: `GET /team/reports/reporters` (admins only) feeds Portal's member page (a Reporter ID row, with Blocked and the reason) and the Members search, which finds a member by their reporter ID.
- **The hourly cron** makes issues GitHub didn't take before (for a week), then asks GitHub about up to 50 open ones and DMs each reporter when theirs is closed: fixed (closed as completed) or closed without a change. Deleting a team deletes its rows; the public issues stay.
- `workers/platform/test/reports.test.ts`, against a fake GitHub in `vitest.config.mts`.

Not yet: a "My reports" page (the route is there) and console errors.

**Screenshots: left out for now** (23 October 2026). We won't host them ourselves, and GitHub has no API for attaching an image to an issue (only github.com's own uploads, which need a signed-in browser). The way to keep them on GitHub, if we want them later: commit each one to a separate public repository (`midtownrobotics/gearbox-screenshots`) through the Contents API, with its own token for that repository only, and embed it in the issue. Commits are permanent, so removing a screenshot means rewriting that repository's history.

## A tracker of our own: the downsides

- **It's a whole product to build and keep up.** Labels, statuses, comments, assignees, search, notifications, attachments, spam handling. Every hour on it is an hour not on Orders, Shop or Scouting.
- **Public issues need moderation.** Most users are students. Once teams see each other's posts there are duplicates, "+1" comments, off-topic posts and now and then something inappropriate, and someone has to clean them up every week.
- **People don't write good bug reports.** Most write "Orders is broken". What helps is the context gathered for them (app, page, version, browser), not a tracker's features.
- **Two backlogs.** Our real work lives in GitHub with pull requests, changesets and the roadmap. A second tracker means copying issues across by hand or building a sync.
- **Legal and privacy.** Screenshots and descriptions will hold member names, budgets and scouting data. The drafts in `docs/legal/` have to say what's collected, who sees it and how long it's kept.
- **The demo.** Nothing typed on team 9999 may leave the visitor's computer, so the form would need to be blocked there (`DEMO_BLOCKED`) or limited to safe text.

## Recommended, in order

1. **A "Report a problem" button in the shared bar** (`AppNavBar`'s drawer, or by the greeting). It opens a `Dialog` with one `TextField` (`multiline`, a new `kind` in `packages/demo/src/safe-text.ts`) and an optional screenshot, and adds on its own the app, the page's address, the app's version (`versionLabel()`), the team, the role, the browser and a recent console error if there is one. That context is most of the value, and it's about a day's work.
2. **Each report becomes a GitHub issue,** made by the platform's worker with a GitHub App or token (a secret, never sent to a page). Users need no GitHub account, and reports are triaged where we already work. Use a private repository or keep team data out of the issue, so nothing a team wrote becomes public.
3. **The reporter hears back.** A status they can see: a "My reports" page on Portal, or a DM on the team's chat (`sendMemberDM`) when the issue is closed. Hearing back is what keeps people reporting.
4. **Feature requests with votes, only if people ask for them.** A board with upvotes and no comment threads gives a signal for what to build next with little moderation. Built ourselves, or Canny, Featurebase or Fider (open source, could be self-hosted). A new vendor or host needs the owners' yes first (roadmap, "Hosting and stack decisions").

## Other options

| Option | Good | Not so good |
| --- | --- | --- |
| A forum channel on Discord, or a Slack channel | Free, and teams are already there | Hard to track; Slack teams and Discord teams can't see each other's |
| GitHub Discussions behind a form that needs no account | Cheap | The reporter can't follow what happens |
| Linear or Jira Service Management's portals | Made for exactly this | Paid, and a new vendor |

## A different idea: an issues app for teams

A tracker is worth building as **a Gearbox app for a team's own work**: robot and mechanism problems, to-dos, who's on what. That's a different thing from feedback on Gearbox, and it fits the app library (team-scoped, a manifest, delete and export hooks, demo data). Pit's checklist issues are a small version of it already. If we build it, keep it separate from reporting problems with Gearbox.

## A daily Claude task for issues marked `ai-ready`

Once reports are GitHub issues, a scheduled Claude Code task (a routine, made with `/schedule`) can take the small, clear ones each day and open a pull request for each. It runs on our Claude subscription in Claude's cloud, the same as a session started by hand: **no Claude API key, no GitHub Action and no code of ours calls Claude.** A person still decides which issues it gets and reviews every pull request.

### Where it reads issues from

- **GitHub (recommended).** The task runs `gh issue list --label ai-ready --state open` and `gh issue view` in its checkout of the repository. Nothing to build.
- **Our own API, if reports stay in Gearbox.** If we keep reports in the platform's D1 instead of turning them into issues, the platform would need a read-only route listing reports marked ready (behind a token the task holds). That's more to build and keep secure, so prefer GitHub.

### What each daily run does

1. Lists open `ai-ready` issues, oldest first, skipping any that already have an open pull request (`gh pr list --search "<number> in:body"`) or the `ai-working` label.
2. Takes at most *N* a day (start with 2), so there's never more to review than we can review.
3. For each: adds `ai-working`, reads the issue, `CLAUDE.md`, and the roadmap and UI alignment pages it touches, and works on a branch `ai/<issue number>-<short name>` from `staging` (never `staging` or `public`; the rulesets block those anyway).
4. Follows the repository's rules like any change: a changeset, the roadmap's Progress table when a step moves, `pnpm biome check --write`, typecheck, and the affected worker's tests.
5. Opens a **draft** pull request into `staging` that says "Closes #123", what changed, which bump it chose and why, and what it couldn't check. Removes `ai-working`.
6. If the issue is unclear or too big, it changes nothing, comments with its questions, and swaps `ai-ready` for `ai-needs-info`.

A person reviews the draft and merges it like any other, or comments what to change and leaves `ai-ready` on for the next run to pick up. Nothing reaches production without a merge into `staging` and a release.

The task's prompt is short, since `CLAUDE.md` carries the rules. Keep it in the repository (`docs/roadmap/ai-task-prompt.md`) so changes to it are reviewed, and have the routine read it.

### What makes an issue `ai-ready`

A person checks these before adding the label:

- One app or one shared part, and roughly one pull request's worth of work.
- What's wrong (or wanted) and what "done" looks like, in the issue's own words.
- No schema change that needs a migration applied to production first, no new Cloudflare product, vendor or domain, and no change to what data is collected or who sees it. Those need the owners first (CLAUDE.md, "Platform Roadmap").
- The issue's text is the maintainer's, not just a user's report pasted in (below).

An issue template (`.github/ISSUE_TEMPLATE/ai-ready.yml`) with these fields makes the check quick.

### Safety

- **Reports are untrusted text.** A report written through the in-app button is anyone's writing, and Claude reads issue text as instructions. Only people with triage access can add labels, so the label is the check: before adding it, the maintainer rewrites the issue in their own words, or quotes the report as a block that's clearly the user's and not instructions. The task only takes issues whose `ai-ready` label was added by a maintainer (it checks the issue's timeline).
- **The task's environment holds no deploy secrets.** Only the GitHub access it needs for issues and pull requests. No Cloudflare token, no `RELEASE_DEPLOY_KEY`, no Slack or Discord tokens.
- **It never merges.** Pull requests are drafts, and the branch rulesets still require review.

### Setup

- Labels: `ai-ready`, `ai-working`, `ai-needs-info`, and `ai` on the task's pull requests so they're easy to filter.
- The prompt file above, and the issue template.
- The routine itself (`/schedule` in Claude Code): daily, on this repository, with the prompt "Follow `docs/roadmap/ai-task-prompt.md`". It uses our subscription's usage, so the daily cap in step 2 is also the cost cap.

## Open questions

- Who triages reports, and how often?
- Do teams see each other's reports and ideas (votes), or only their own?
- How many `ai-ready` issues a day should the task take? (The prompt starts at 2.)
- Who may add `ai-ready`: every maintainer, or only the owners?
