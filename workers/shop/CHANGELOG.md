# @g3/worker-shop

## 4.0.0

### Major Changes

- 4b489a5: Admins can remove subsystems and processes on the Admin page: unused ones are deleted, and ones parts use are hidden from new parts and can be restored. Only admins add or remove them now. Apply migration 0024 before deploying.

### Minor Changes

- dcb9da4: The menu has a "Need help?" link to the Gearbox docs page about the page you're on, and on a computer, Tutorial mode: that docs page beside the app, following you from page to page.
- aa5cd00: Report a problem is there when you're signed out and on the demo too: it lets you write the report and opens it on GitHub, filled in with the page, versions, browser and team.
- 3252560: A part's details view and its part page link to the part in Onshape and to the release it came from.
- 13405a2: Ingest: each part's name opens it in Onshape, and each release has an Open in Onshape link.
- 26e042d: Admin has an Onshape API Usage section: how many calls Shop makes to Onshape, which kinds, and the ones that failed, for the current API keys or all the team has used. Every page shows a banner while Shop has no Onshape API keys or Onshape is refusing its calls, such as when the API limit is reached.
- 9667d17: Admins can change the shop status words on the Shop Floor's overview ("Raw 🥩", "Cooked 🍳", "Ash 🔥") and the queue size each starts at. The Files page has a box by every file and drawing for Delete selected, and Delete all on the Complete and Obsolete groups.

### Patch Changes

- 754ede0: The demo requires a quality check at the end of every part, with two shop managers, a passed and a failed quality report, and its sample releases no longer link to Onshape, where they never were.
- 9667d17: When the top bar's pages don't fit, a mouse wheel over the bar scrolls them sideways (never the page) and the edge with more fades out.
- 9667d17: In kiosk mode, the machine's pop-up in the top bar shows Shop's version.
- 46b26b4: Your team's logo is now its avatar from The Blue Alliance: turn on Use Team Avatar on the Appearance page in place of giving a logo's address. With it off, the apps show their own icons.
- a1832e8: Switching between light and dark mode changes the page's background and cards right away, not only its text.

## 3.0.0

### Major Changes

- 9c00961: Quality control is one section on the Admin page: quality reports and their table moved into it, the process picker only shows once "Require quality control" is on, and the checklist a report goes through is now the team's own, edited under the reports table.
  
  A part that fails its check can go to any of its steps, not only one before the check. Two new choices sit beside Send back: Fix it, which sends the part to a step and writes what has to be done onto the part's notes, and Start over, which makes the part obsolete and adds a new one at its first step. A fix can send the part to a step it doesn't have yet — sanding a part that failed — and that step joins this one part, just before its quality check.
  
  Turning quality reports or a required quality check on now takes effect on the shop floor without reloading the page, so a Quality Control step no longer offers Mark Complete when it needs a quality report.
  
  Run the Shop worker's D1 migrations `0020`–`0023` before deploying: they add Quality Control processes, shop managers and quality reports, widen what a report's outcome can be and move a report's four fixed questions into the team's editable checklist.
- 9c00961: Quality Control processes: a process type only shop managers and admins can check off. The Admin page's new Quality Control section picks the team's shop managers, and can require a quality check, which puts a chosen Quality Control process at the end of every part.
- 9c00961: Quality reports: with them on (the Admin page's new Quality Reports section), a part at a Quality Control process gets one Start Quality Report button. A shop manager checks the part against its drawing; if something's wrong, they pick the step it likely came from, see who did it and when, and send the part back. Every report is listed on the Admin page. "Require a quality check" is now "Require quality control".

### Minor Changes

- 9006f60: Report a problem or suggest an idea from any app: the menu has "Report a problem", which posts it as a public issue on Gearbox's GitHub with the page and app versions (never your name), and you get a Slack or Discord message when it's fixed or closed. No GitHub account needed. Not in the public demo. Deployers: apply the platform's migration `0012_problem_reports.sql` before deploying it, and set its `GITHUB_TOKEN` secret (`docs/deploy.md`, "Problem reports on GitHub"); without it, reports are kept, and those under a week old are sent once it's set.

### Patch Changes

- 05068af: Your team's logo keeps its shape in the top bar: a wide logo shows wider and a tall one narrower, instead of being squeezed into a square.
- 05068af: On a phone, a long team and app name in the top bar and the menu is cut short ("ROBOWARRIORS SKILL TR…") instead of pushing the menu's close button and your greeting off the screen.
- 73d2f28: Long links, part names and other long text wrap or are cut short on phones instead of making the page scroll sideways.

## 2.1.0

### Minor Changes

- db2c78c: Teams can use Discord instead of Slack: connect your server on Integrations (or when signing your team up), sign in with Discord, and get everything Gearbox sends (approvals, releases, daily summaries, reminders, service alerts and notifications) on Discord. Deployers run G3ID's and the platform's migrations first, and set up the Discord app (docs/deploy.md, "Discord") to switch it on.

## 2.0.0

### Major Changes

- 5befc47: G3's apps moved to frcgearbox.com: 1648-<app>.frcgearbox.com (home at 1648.frcgearbox.com, sign-in at 1648-id.frcgearbox.com). The old g3robotics.com app addresses no longer work; they show where each app went. Everyone signs in again once. Deployers: follow "Moving G3 to frcgearbox.com" in docs/deploy.md before releasing.
- c3fc43e: Each app is now one worker: it serves the app's page and its API at /api on the app's own address (https://orders.<domain>/api), behind one gateway worker on *.<domain>. Deploying changes (see docs/deploy.md): no more Cloudflare Pages, sign-in callbacks move to https://g3id.<domain>/api/auth/<provider>/callback (add them to each provider first), and the old api.<app> addresses keep working through the gateway.
- d1b9635: Releases are read from the Onshape release package: Shop keeps each release's name, notes, who made it, who approved it and its comments, and the Slack post shows them. Run migration 0018 before deploying.
- 50a060d: The old api.<app> addresses are retired: they answer 410 with the app's address to use instead (https://<app>.<domain>/api). Deployers: before releasing, move Slack's command and event URLs, re-save Shop's Onshape settings (which now replaces its webhook rather than adding one), and point the edge box at https://edge.<domain>/api (docs/deploy.md).
- f576bee: Batches are tracked as one unit. A batch is not started, in progress or complete at its File Producer process and then at its File Consumer process, and its parts move with it. It has a name you can change, a detail view of its own (its file, its parts and where they are), a Send back button for a part that failed, and Duplicate batch. A file now reaches parts only through a batch, a part can go through a File Producer process without one, and the Files page groups files and drawings by progress. A File Consumer process must come after the File Producer process in a part's processes. Run migration `0019_batches.sql` before deploying: files assigned straight to instances become batches.
- c21a4cc: Shop works better on a phone. In a machine's queue, a part's name is now the link that opens it (the Open button is gone), and on a narrow screen the buttons sit on their own row so names and part numbers stay visible. The shop view puts the part's information and buttons under the drawing on a narrow screen. A part's two views link to each other with "Switch to Shop View" and "Switch to Details View", and the details view's top bar no longer lets the drawing show through it.
  
  On the Files page, a file's name gets the whole top row on a narrow screen, with its status and buttons under its details. Assigning a file to a part by number no longer asks for a revision: it always uses the part's most recent one.
  
  An obsolete part's details are now view only: no Files panel and no Add One, Send Back or Edit & Obsolete buttons, and its information shows when it was made obsolete and by whom. A file can no longer be assigned to an obsolete part.
  
  Deployers: apply Shop's migration `0017_obsoleted.sql` before deploying.
- f624f93: The BOM tab is gone (it was an empty "coming soon" page); FRCBOM is on the apps grid instead.
- 883e23d: Shop keeps each team's parts, production steps, files and drawings to itself. Each team connects its own Onshape on the Admin page (API keys and webhook signing keys, stored encrypted), and release and daily summary posts go to the team's own Slack. Drawings now need you to be signed in. Deployers: follow "Shop for every team" in docs/deploy.md before merging: set Shop's `SECRETS_KEY` secret, copy the files in R2 with `pnpm --filter @g3/worker-shop r2:move-to-team`, then apply migration `0016_teams.sql`.

### Minor Changes

- 09a3f2d: Team Appearance has simpler colors. Your team's color is now its accent, in a shade for light mode and one for dark mode; the separate primary brand color is gone, and a color you chose there carries over. The two accents can be linked, so a color entered for one gives the other the same hue, and each has saturation and brightness sliders to set it against its own background. The other palette colors are under "More options", with a preview of each theme showing them together. In the apps, buttons and icons use the light accent, and in dark mode links and highlights use the dark accent.
  
  Every app now follows those colors. Shop, Pit, Scouting and the portal's sign-in screen used fixed colors of their own and now take your team's accent, backgrounds, borders and text, as do the cards, borders and gray text inside the other apps and the text in the top bar. Colors that carry a meaning (green for done, red for an error or deleting, status badges, alliance colors) stay as they are. On the default colors, Pit's and the portal's bright red buttons become the burgundy used everywhere else.
- 3e1cc08: The menu button is in the top bar at every screen width. It lists your team's apps under "All Apps": the team's home first, then each app that's on, in your home page's order, so any app is one step from any other. On a phone the app's own pages are still at the top of the menu. The top bar also greets you by name, with a link to your account. The separate All Apps link is gone.
- 0a36c71: Your team's admins can download this app's data, and changes to its team settings appear in the team's log on the home's Apps page.
- 615ffd1: Features that need another app are hidden while your team has that app switched off: part lookup and printing without Edge, receiving into Inventory without Inventory, the Orders catalog in Inventory without Orders, and the Leaderboard without Attendance.
- d1b9635: A new Onshape page lists every approved release in a table; each opens its own page with who made and approved it, its parts and comments, and links to Onshape at that release. The Ingest page groups parts under the release they came from, newest first.
- dc89f2e: The public demo: anyone can try Gearbox as a student, mentor or admin of team 9999 without an account, with sample data in every app that resets every night at midnight Eastern. In the demo, text is picked with a rotate button instead of typed. Every text box now uses one shared part, which looks the same as before outside the demo.
- 2e57a8f: At a File Producer process, a part's name is now the link that opens it in Onshape, and a "Release" link beside its part number opens the release it came from. Both appear for parts Onshape has released; a part added by hand keeps a plain name. A part whose revision isn't in any release links to its newest one.
- 8a5745e: Shop's Onshape page lists every release's parts in the table, with their names, numbers, revisions and quantities, grouped under the release they came in. Every column sorts; sorting by a part's column lists the parts one per line. A release is named by when it was released. Parts a later release replaced are marked obsolete and can be hidden. A release's own page has a column each for its Part, Drawing and Onshape links. On a phone both pages stack into lines instead of scrolling sideways.
- a95a057: Shop opens on a new Overview: parts in progress, ready to start, complete and waiting on Ingest, each opening its page. Its pages look and work like the other apps'. Errors and Delete buttons are red whatever the team's color, every question is asked in the page instead of a browser box, deleting a part waiting on Ingest asks first, and members who aren't admins no longer see the parts of Admin that only work for an admin.
- fb68da5: Choose Slack channels by searching their names instead of pasting IDs, on Shop's Admin page and the Notifications admin page. Teams that connected Slack before this have to connect it again on Integrations to see their channels.
- 615ffd1: Team admins can choose how members sign in and see what the apps are connected to, from the team's admin pages.
- 887e1c5: App icons now use your team's primary color from Team Appearance in place of the built-in burgundy: in the top bar, on the browser tab, on a phone's home screen and on the app list's tiles. Teams that keep the default color see no change.

### Patch Changes

- 9eae762: Each app describes itself to Gearbox's app library. Switching Orders or Skill Tree on gets the team's starter parts catalog or default skill trees ready straight away.
- 67ba6d1: After an admin saves the team's appearance, every app they open or switch back to shows it straight away, including the new order of apps in the menu, instead of up to a minute later.
- 7b432c1: Team Appearance has a button text color for each theme: Automatic, Light or Dark. Light is your dark palette's text color and Dark your light palette's; Automatic picks whichever stands out more against your team's color. Each accent's preview now shows it on a button. Every button and other element filled with your team's color uses it in every app, so a bright team color can carry dark text.
  
  In dark mode, buttons and other filled elements now use your dark mode accent, where they used the light accent in both themes; app icons still use the light accent. On the default colors, dark mode's buttons are the lighter red with dark text.
- eb87549: The default accent colors are now #a32035 in light mode and #bd263e in dark mode, and the Gearbox site's top bar matches the apps' bar, with its name in Agency FB in the accent color.
- 883e23d: Edge works for any team with its own box: each box signs in with its team's own key, made by an admin on the Edge Box page, and each team's network data, blocking and settings are its own. Days, billing cycles and "until midnight" exceptions use the box's own time zone, which the agent now reports. Part lookups in Orders and printing in Shop use your own team's box. Deployers: follow "Edge for every team" in docs/deploy.md before merging: apply migration `0005_teams.sql`, then store G3's current box key with `box-key:set`; afterward upgrade the agent and delete the `EDGE_AGENT_KEY` secret.
- 2a0df40: Added to an Android home screen, each app installs as its own app with a full-size icon instead of a small one on a white circle.
- eb87549: Pages that fit on the screen no longer scroll: not by the top bar's height, not while a page loads, and not by a phone's address bar. Skill Tree's Overview no longer scrolls sideways on a phone.
- c678136: Pages no longer stretch or bounce when you scroll past their edges on a phone, the same in every app.
- 50a060d: Sign-in pages, messages, Scouting's logo and colors, and tab icons use each team's own name, logo and color instead of G3's.
- 3ecf4f6: A release opened from the Ingest page links back to Ingest.
- 5e13bcf: Links that open a drawing or download a part file work again. They were showing the app's own page instead.
- c7d0251: Shop's Onshape table shows each release's name beside when it was released. The name opens the release and has its own column to sort by; a release with no name reads "Name not found".
- 883e23d: Signing in now also checks that your account belongs to the team whose address you're on.
- c678136: Every app now takes you straight to sign in when you're signed out, and back to the page you were on. Your team's home is the exception: signed out, it shows Sign in, Sign up and your team's public site. The sign-in app is called "ID", its pages show your team's name as set in Team Appearance, and a "Find your team" link helps if you're on another team's sign-in page. Renaming your team in Team Appearance now renames it everywhere.
- 50a060d: Every app shows the team it's on, from that team's appearance settings: its names, links and sign-in address. A team that hasn't set its appearance gets its own name, number and FRC links rather than G3's.
- 883e23d: When an operator deletes a team, its data in every app is deleted too (Shop's files and Onshape webhook, Edge's box key included), and nothing else is deleted if an app can't. Orders keeps each team's Share-A-Cart connection encrypted. Deployers: set Orders' `SECRETS_KEY` secret before deploying it.
- 680a558: Apps are reachable only through the gateway (no more workers.dev addresses), which now also serves teams at <number>-<app> addresses and keeps each team's sessions to its own apps. G3ID reports the signed-in user's team and answers team lookups.
- 50a060d: Teams on the platform's domain now keep one light/dark setting across all their apps, as G3's do.
- c5cf623: The "Hello, name!" link to your account is at the right of the top bar at every screen width, on a phone too. A name too long for the room is cut short.
- 6fbfadb: Shorter descriptions and hints across the apps: they say what you can do on a page and leave out how it works underneath. Spelling follows US English throughout, so a canceled request now reads "Canceled".
- b5ce375: Names are the same across the apps. An app's settings page is called Admin: Orders' and Inventory's Settings pages are now Admin (old links still open them), and Shop's Admin is last in its bar. Every "Log in" and "Log Out" is now "Sign in" and "Sign out". A page's title matches its link in the top bar: Pit's Editor is Edit Checklists and its admin page is titled Admin; ID's Dash is Account, its Kiosk Devices page is titled that, and its Attendance admin page is Attendance; Portal's Manage Apps and Appearance; Edge's Overview and Drive.
  
  Fixes: in Pit, card headings that couldn't be read, error messages that were a dark block in light mode, and checklist progress bars that were red until complete (they are your team's color now). In Pit, Shop and Portal, pages no longer scroll a little when they have nothing to scroll. In ID, revoking a kiosk asks first. In Orders and Inventory, dates follow your own language. Inventory's search and filters stay when you reload or go back.
- c678136: An address that isn't a page now takes you to the app's home instead of showing a blank page.
