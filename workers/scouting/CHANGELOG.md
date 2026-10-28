# @g3/worker-scouting

## 3.1.0

### Minor Changes

- dcb9da4: The menu has a "Need help?" link to the Gearbox docs page about the page you're on, and on a computer, Tutorial mode: that docs page beside the app, following you from page to page.
- aa5cd00: Report a problem is there when you're signed out and on the demo too: it lets you write the report and opens it on GitHub, filled in with the page, versions, browser and team.
- ab9aa57: Support multiple active named match and pit forms, with one submission per form and match and advancement after all active match forms are complete. Accept explicit no/minimal Auto movement, expose match-specific reports and event pit coverage, and retain the existing multiple service issue categories. Migration 0038 updates the atomic duplicate-submission rule while preserving the service-ticket schema from migration 0037.
- 72a2f11: Show missing match reports by robot and active form in the admin Competition overview. Distinguish local draft saves, partial or failed storage, submitting and server-confirmed reports, including pit drafts and warnings that survive reloads. Balance new robot assignments using current participation and submitted work, interleave alliances and rotate ties each match while preserving existing valid assignments.
- 7665b2b: Let form managers hide or show each form directly from its card. Scouts only receive visible forms, with their list refreshing automatically; hidden forms and historical reports remain available to managers. Visibility changes preserve the form definition and enforce management permissions and team isolation.

### Patch Changes

- 754ede0: The demo has a second match form, Driver ratings, filled in for the first matches, and a hidden Practice day form.
- 9667d17: When the top bar's pages don't fit, a mouse wheel over the bar scrolls them sideways (never the page) and the edge with more fades out.
- 46b26b4: Your team's logo is now its avatar from The Blue Alliance: turn on Use Team Avatar on the Appearance page in place of giving a logo's address. With it off, the apps show their own icons.
- a1832e8: Switching between light and dark mode changes the page's background and cards right away, not only its text.

## 3.0.0

### Major Changes

- 24cbdaf: A service ticket can have more than one issue type, or "Not sure" when the reporter can't tell: both ticket forms pick them with chips, and each ticket shows a badge per type. Apply migration `0037_service_ticket_issue_types.sql` before deploying; the API takes and returns `issueTypes` (a list) in place of `issueType`.

### Minor Changes

- 9006f60: Report a problem or suggest an idea from any app: the menu has "Report a problem", which posts it as a public issue on Gearbox's GitHub with the page and app versions (never your name), and you get a Slack or Discord message when it's fixed or closed. No GitHub account needed. Not in the public demo. Deployers: apply the platform's migration `0012_problem_reports.sql` before deploying it, and set its `GITHUB_TOKEN` secret (`docs/deploy.md`, "Problem reports on GitHub"); without it, reports are kept, and those under a week old are sent once it's set.
- 24cbdaf: Multiple choice questions with up to six short choices, like Yes/No, are answered with one tap on large bubbles instead of a dropdown; tap the chosen answer again to clear it. Longer lists keep the dropdown.

### Patch Changes

- 05068af: Your team's logo keeps its shape in the top bar: a wide logo shows wider and a tall one narrower, instead of being squeezed into a square.
- 05068af: On a phone, a long team and app name in the top bar and the menu is cut short ("ROBOWARRIORS SKILL TR…") instead of pushing the menu's close button and your greeting off the screen.
- 73d2f28: Long links, part names and other long text wrap or are cut short on phones instead of making the page scroll sideways.

## 2.1.0

### Minor Changes

- db2c78c: Teams can use Discord instead of Slack: connect your server on Integrations (or when signing your team up), sign in with Discord, and get everything Gearbox sends (approvals, releases, daily summaries, reminders, service alerts and notifications) on Discord. Deployers run G3ID's and the platform's migrations first, and set up the Discord app (docs/deploy.md, "Discord") to switch it on.
- c6d1e89: Scouting's Admin page opens with the announcement box, then a Competition overview: who's in the app, this match's submissions, the Strategy leads online, the match everyone is scouting, and the next team match. The manual schedule section is now called Match schedule and explains itself. Strategy leads also set how long scouts have to send a form in after a match ends (two minutes to start, with whole-second precision). Apply migrations through 0035 before deploying; saved minute-based delays are preserved.
- 7f8f724: Analysis now lists teams instead of single reports: match scouting shows each team's average for every number and its most common answer to every choice at the current event, and pit scouting shows each team's answers. Sort by any column, and click a team's number to see each of its reports, labeled with the match and scout.
- c6d1e89: Default automatic match advancing to two minutes after a match finishes and let teams customize the delay in Scouting Admin.
- 1585566: Match forms never lose a scout's work: answers and drawings are kept on the device, a bar counts down before the form moves on (with +30 s to finish), a report that missed the move can still be sent and goes to its own match marked late, and a done screen shows what was sent and the next match. Admins set how long late reports are accepted.
- f9bd8ec: Separate match and pit scouting forms, filter and sort reports by type, and show competition names instead of event codes. Apply report type and competition filters to statistics, auto paths and team comparisons.

### Patch Changes

- c6d1e89: Analysis sorts reports by form, so a team's match forms and its pit form no longer sit mixed together.
- f29e1e4: Allow signed-in team members to open Analysis and view their team's reports and drawings. Keep report management restricted to Strategy leads and admins.
- c6d1e89: Keep Scouting API credentials private to each team. Restrict legacy deployment-key fallbacks to the original team, and report missing credentials correctly for other teams.
- f9bd8ec: Show the match submission deadline and countdown, clear answers and drawings at expiry or assignment changes, and reject stale match or team submissions before saving reports or awarding points.
- 1585566: A scout who has sent a match report in moves to the match on the field at once, instead of waiting out the window after the finished match, and the confirmation names the match the report went to and the match they are on now.
- f29e1e4: Open a scout's next match immediately after saving a report, without a start-time submission gate. Limit automatic progression to one match ahead of the shared current match, preserve drafts during schedule failures, and prevent stale polls from restoring completed forms. Keep expired and wrong-team report protection.
  
  Claim scout assignments atomically, repair changed lineups, and validate team membership before and after drawing uploads. Keep automatic match advancement forward-only, preserve omitted event settings, and reopen empty forms after a confirmed deadline extension. Anchor countdowns to server time so device clock changes do not erase drafts.
- c6d1e89: Load scouting points and history before external predictions, limit Statbotics requests to three seconds, and reuse recent public match data. Name the active event in prediction errors and distinguish missing events from server failures and timeouts. Keep points and standings usable during outages, allow retrying failed loads, and validate submitted picks against fresh data.
- c6d1e89: Every answer on a scouting form takes 0. A rating of 0, a choice named "0", a selection including it and a note reading "0" were all refused as if the field were blank; a robot that did nothing is now recorded as doing nothing. Each field still needs an answer, and says so instead of blaming 0.
- da8964e: Save tier list edits automatically, serialize pending changes, and retry failed saves. Use stable list IDs so retrying a new list does not create duplicates.

## 2.0.0

### Major Changes

- 5befc47: G3's apps moved to frcgearbox.com: 1648-<app>.frcgearbox.com (home at 1648.frcgearbox.com, sign-in at 1648-id.frcgearbox.com). The old g3robotics.com app addresses no longer work; they show where each app went. Everyone signs in again once. Deployers: follow "Moving G3 to frcgearbox.com" in docs/deploy.md before releasing.
- c3fc43e: Each app is now one worker: it serves the app's page and its API at /api on the app's own address (https://orders.<domain>/api), behind one gateway worker on *.<domain>. Deploying changes (see docs/deploy.md): no more Cloudflare Pages, sign-in callbacks move to https://g3id.<domain>/api/auth/<provider>/callback (add them to each provider first), and the old api.<app> addresses keep working through the gateway.
- dc89f2e: Make Scouting available to every team through the app library, with private forms, reports, schedules, roles, files, service tickets and optional predictions. Add subscription setup, export and deletion, and send service alerts through each team's Slack installation. Preserve the original team's data and file links; new teams start with empty editable forms and points disabled.
  
  Align Scouting with the shared app UI while preserving its scouting, analysis, drawing and touch workflows. Add direct page links and in-page questions, repair Service Tickets formatting, polish predictions, remove redundant descriptions and show the configured points name beside Available.
  
  Deployment requires action: apply Scouting migration 0033, then deploy Scouting before Platform exposes it to other teams. Existing writes require the updated Scouting worker after migration. Rehearse this order on staging.

### Minor Changes

- 09a3f2d: Team Appearance has simpler colors. Your team's color is now its accent, in a shade for light mode and one for dark mode; the separate primary brand color is gone, and a color you chose there carries over. The two accents can be linked, so a color entered for one gives the other the same hue, and each has saturation and brightness sliders to set it against its own background. The other palette colors are under "More options", with a preview of each theme showing them together. In the apps, buttons and icons use the light accent, and in dark mode links and highlights use the dark accent.
  
  Every app now follows those colors. Shop, Pit, Scouting and the portal's sign-in screen used fixed colors of their own and now take your team's accent, backgrounds, borders and text, as do the cards, borders and gray text inside the other apps and the text in the top bar. Colors that carry a meaning (green for done, red for an error or deleting, status badges, alliance colors) stay as they are. On the default colors, Pit's and the portal's bright red buttons become the burgundy used everywhere else.
- 3e1cc08: The menu button is in the top bar at every screen width. It lists your team's apps under "All Apps": the team's home first, then each app that's on, in your home page's order, so any app is one step from any other. On a phone the app's own pages are still at the top of the menu. The top bar also greets you by name, with a link to your account. The separate All Apps link is gone.
- 0a36c71: Your team's admins can download this app's data, and changes to its team settings appear in the team's log on the home's Apps page.
- 14d9fbd: Make scouting points and match predictions optional in admin settings, off by default. Teams can name their points, choose combined picks and standings separately, and use points without predictions. Replace sportsbook and betting language with match picks and points. Keep existing balances and picks when activities are disabled.
- dc89f2e: The public demo: anyone can try Gearbox as a student, mentor or admin of team 9999 without an account, with sample data in every app that resets every night at midnight Eastern. In the demo, text is picked with a rotate button instead of typed. Every text box now uses one shared part, which looks the same as before outside the demo.
- c678136: Every app now takes you straight to sign in when you're signed out, and back to the page you were on. Your team's home is the exception: signed out, it shows Sign in, Sign up and your team's public site. The sign-in app is called "ID", its pages show your team's name as set in Team Appearance, and a "Find your team" link helps if you're on another team's sign-in page. Renaming your team in Team Appearance now renames it everywhere.
- 887e1c5: App icons now use your team's primary color from Team Appearance in place of the built-in burgundy: in the top bar, on the browser tab, on a phone's home screen and on the app list's tiles. Teams that keep the default color see no change.

### Patch Changes

- 9eae762: Each app describes itself to Gearbox's app library. Switching Orders or Skill Tree on gets the team's starter parts catalog or default skill trees ready straight away.
- 67ba6d1: After an admin saves the team's appearance, every app they open or switch back to shows it straight away, including the new order of apps in the menu, instead of up to a minute later.
- 7b432c1: Team Appearance has a button text color for each theme: Automatic, Light or Dark. Light is your dark palette's text color and Dark your light palette's; Automatic picks whichever stands out more against your team's color. Each accent's preview now shows it on a button. Every button and other element filled with your team's color uses it in every app, so a bright team color can carry dark text.
  
  In dark mode, buttons and other filled elements now use your dark mode accent, where they used the light accent in both themes; app icons still use the light accent. On the default colors, dark mode's buttons are the lighter red with dark text.
- eb87549: The default accent colors are now #a32035 in light mode and #bd263e in dark mode, and the Gearbox site's top bar matches the apps' bar, with its name in Agency FB in the accent color.
- 2a0df40: Added to an Android home screen, each app installs as its own app with a full-size icon instead of a small one on a white circle.
- eb87549: Pages that fit on the screen no longer scroll: not by the top bar's height, not while a page loads, and not by a phone's address bar. Skill Tree's Overview no longer scrolls sideways on a phone.
- c678136: Pages no longer stretch or bounce when you scroll past their edges on a phone, the same in every app.
- 50a060d: Sign-in pages, messages, Scouting's logo and colors, and tab icons use each team's own name, logo and color instead of G3's.
- 50a060d: The old api.<app> addresses are retired: they answer 410 with the app's address to use instead (https://<app>.<domain>/api). Deployers: before releasing, move Slack's command and event URLs, re-save Shop's Onshape settings (which now replaces its webhook rather than adding one), and point the edge box at https://edge.<domain>/api (docs/deploy.md).
- 627dca4: Scouting counters take any whole count again. A count above 10 (30 fuel) was refused, and so was a count of 0 — a robot that scored nothing can now be recorded as scoring nothing. A counter left untouched counts as the 0 it shows, and its − button stops at 0.
- eb87549: Errors, delete buttons and failed-save messages in Scouting use the same red as the rest of the apps, in light and dark mode.
- dc89f2e: Make the fullscreen scouting workspace cover the entire viewport, including the navbar and side gutters on wide screens. Keep the normal page width when exiting fullscreen.
- 5dfdf0b: Keep Undo and Clear visible in Scouting's mobile field and autonomous route editors, enlarge drawing controls, and prevent sticky toolbars from covering the canvas. Preserve routes through canceled or secondary touch gestures and fullscreen transitions; allow undoing Clear in the auto library.
- 4cdbe3b: The app is called Scouting in its own top bar and browser tab, where it said Strategy.
- 680a558: Scouting's BoyleBucks migrations now apply on Cloudflare's D1 (they stopped with "incomplete input"); bets and parlays still need enough BoyleBucks.
- 883e23d: Signing in now also checks that your account belongs to the team whose address you're on.
- 50a060d: Every app shows the team it's on, from that team's appearance settings: its names, links and sign-in address. A team that hasn't set its appearance gets its own name, number and FRC links rather than G3's.
- 680a558: Apps are reachable only through the gateway (no more workers.dev addresses), which now also serves teams at <number>-<app> addresses and keeps each team's sessions to its own apps. G3ID reports the signed-in user's team and answers team lookups.
- 50a060d: Teams on the platform's domain now keep one light/dark setting across all their apps, as G3's do.
- c5cf623: The "Hello, name!" link to your account is at the right of the top bar at every screen width, on a phone too. A name too long for the room is cut short.
- 6fbfadb: Shorter descriptions and hints across the apps: they say what you can do on a page and leave out how it works underneath. Spelling follows US English throughout, so a canceled request now reads "Canceled".
