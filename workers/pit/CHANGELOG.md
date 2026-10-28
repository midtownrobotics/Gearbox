# @g3/worker-pit

## 3.2.0

### Minor Changes

- dcb9da4: The menu has a "Need help?" link to the Gearbox docs page about the page you're on, and on a computer, Tutorial mode: that docs page beside the app, following you from page to page.
- aa5cd00: Report a problem is there when you're signed out and on the demo too: it lets you write the report and opens it on GitHub, filled in with the page, versions, browser and team.

### Patch Changes

- e7877ec: The log downloader's setup steps download only the released downloader, with its status page already built (about 8 MB in all, instead of all of Gearbox and its build tools).
- 195d258: The Pit Monitor no longer stays on "Loading…" when The Blue Alliance, Nexus, Statbotics or another part of Pit doesn't answer: it shows what it has and tries again at the next refresh.
- 9667d17: When the top bar's pages don't fit, a mouse wheel over the bar scrolls them sideways (never the page) and the edge with more fades out.
- 46b26b4: Your team's logo is now its avatar from The Blue Alliance: turn on Use Team Avatar on the Appearance page in place of giving a logo's address. With it off, the apps show their own icons.
- a1832e8: Switching between light and dark mode changes the page's background and cards right away, not only its text.

## 3.1.0

### Minor Changes

- b8d939a: The Pit Monitor is three columns on a wide screen and leads with "Our next match": its name on our alliance's color, all six teams by driver station with ours ringed and each team's rank and pit address beside it, how many matches until we're called to queue (then Now queuing, On deck, On field), and countdowns to queuing and going on the field. Its color grows more urgent as it gets closer. The event's On deck, Now queuing and Queuing soon are at the top right, and each played qualification match's score shows its bonus RPs as dots, as The Blue Alliance does. When Nexus has no times the panel uses The Blue Alliance's schedule, and it says so plainly when there's no schedule or we have no more matches. The Monitor's battery tiles are two lines each, and the Monitor no longer scrolls sideways on a phone.
- 1e15859: AdvantageScope's field and robot models download about a third the size and stay on the device after the first time, and so does each match log you open. The log picker says which logs are on this device and how much the others download, and the Logs page saves AdvantageScope, your team's fields and robots and all the logs to the device ahead, so AdvantageScope opens with no connection.
- 9006f60: Report a problem or suggest an idea from any app: the menu has "Report a problem", which posts it as a public issue on Gearbox's GitHub with the page and app versions (never your name), and you get a Slack or Discord message when it's fixed or closed. No GitHub account needed. Not in the public demo. Deployers: apply the platform's migration `0012_problem_reports.sql` before deploying it, and set its `GITHUB_TOKEN` secret (`docs/deploy.md`, "Problem reports on GitHub"); without it, reports are kept, and those under a week old are sent once it's set.

### Patch Changes

- 05068af: Your team's logo keeps its shape in the top bar: a wide logo shows wider and a tall one narrower, instead of being squeezed into a square.
- 05068af: On a phone, a long team and app name in the top bar and the menu is cut short ("ROBOWARRIORS SKILL TR…") instead of pushing the menu's close button and your greeting off the screen.
- 73d2f28: Long links, part names and other long text wrap or are cut short on phones instead of making the page scroll sideways.
- b8d939a: On staging, with the event snapshot on, admins can move its clock on or back from the Monitor (a match, five minutes or a minute at a time, or back to the start), and each match's status and score follow it, so every state of "Our next match" can be seen without waiting.

## 3.0.0

### Major Changes

- 3c67e43: AdvantageScope is in Pit: open it from the Logs page, and open any match log in it with one click. Its preferences and layout are shared by the whole team, and mentors can add your robot or another field for everyone. Deployers: apply Pit's migration 0016 first.
- 3c67e43: Pit's Logs page and Monitor show what the log downloader is doing: online, connected to the robot, copying and uploading. The Monitor's Recent Logs is now Logs, and In the pit now is at the top of its left column. On the downloader, the robot shows as connected as soon as the computer joins its network, the page no longer stalls while logs copy, it checks the robot again for new logs while connected, and "In Gearbox" follows what Pit has. Deployers: apply Pit's migration 0017 first.
- 2aa06eb: Pit's Monitor keeps the team's played matches in its match list, with the blue and red scores and a green W or red L in place of the time; the list opens at the next match. On a wide screen the Monitor fits the window: the match list and the checklists scroll on their own, with the column names and the overall progress bar kept at the top. The Batteries page has Pause All and Unpause All, which stop and restart every battery's timer without changing any battery's state. On the days of a published Schedule event, the timers go back to zero and pause when the first day opens, pause when each day closes, and carry on when the next day opens. In dev and staging only, Pit's Admin page has Use event snapshot, which shows GRITS 2026 halfway through qualifications on the Monitor instead of the team's event. Deployers: apply Pit's migration 0018 first, and deploy Schedule with Pit (Pit's new `SCHEDULE` service binding).

### Minor Changes

- fe63d3f: The Monitor shows whether it's online, checked every second, and covers the screen with a big Offline notice when Pit can't be reached. A failed refresh keeps what it last showed.

### Patch Changes

- c429a6e: Pit deploys again when AdvantageScope comes from the build cache.

## 2.0.0

### Major Changes

- 5befc47: G3's apps moved to frcgearbox.com: 1648-<app>.frcgearbox.com (home at 1648.frcgearbox.com, sign-in at 1648-id.frcgearbox.com). The old g3robotics.com app addresses no longer work; they show where each app went. Everyone signs in again once. Deployers: follow "Moving G3 to frcgearbox.com" in docs/deploy.md before releasing.
- c3fc43e: Each app is now one worker: it serves the app's page and its API at /api on the app's own address (https://orders.<domain>/api), behind one gateway worker on *.<domain>. Deploying changes (see docs/deploy.md): no more Cloudflare Pages, sign-in callbacks move to https://g3id.<domain>/api/auth/<provider>/callback (add them to each provider first), and the old api.<app> addresses keep working through the gateway.
- 227660d: Checklists are archived when they're reset. "Archive and Reset" (in place of "Reset All") asks what the checklists were for: the event, whether it was a match, a practice or something else, and details such as the match. At an event the event is filled in from Settings and the details start with the team's next official match. It then saves what was checked, who archived it and when, and unchecks everything; open issues stay. The new Logs tab lists every archive, and each opens to show all the lists with their items and issues marked New, Still Open or Resolved. An issue you resolve shows as Resolved in the next archive. Apply migration `0012_checklist_archives.sql` before deploying.
- 883e23d: Pit keeps each team's checklists, batteries and event settings to itself, and the pit monitor uses your own team number. The Blue Alliance and Nexus API keys are no longer settings: the monitor always uses the platform's. Deployers: before applying Pit's migration `0011_teams.sql` (`pnpm --filter @g3/worker-pit run db:migrate:remote`), make sure the worker's `TBA_AUTH_KEY` and `NEXUS_API_KEY` secrets hold working keys, because the migration drops the keys stored as settings. Then deploy the worker.

### Minor Changes

- 09a3f2d: Team Appearance has simpler colors. Your team's color is now its accent, in a shade for light mode and one for dark mode; the separate primary brand color is gone, and a color you chose there carries over. The two accents can be linked, so a color entered for one gives the other the same hue, and each has saturation and brightness sliders to set it against its own background. The other palette colors are under "More options", with a preview of each theme showing them together. In the apps, buttons and icons use the light accent, and in dark mode links and highlights use the dark accent.
  
  Every app now follows those colors. Shop, Pit, Scouting and the portal's sign-in screen used fixed colors of their own and now take your team's accent, backgrounds, borders and text, as do the cards, borders and gray text inside the other apps and the text in the top bar. Colors that carry a meaning (green for done, red for an error or deleting, status badges, alliance colors) stay as they are. On the default colors, Pit's and the portal's bright red buttons become the burgundy used everywhere else.
- 3e1cc08: The menu button is in the top bar at every screen width. It lists your team's apps under "All Apps": the team's home first, then each app that's on, in your home page's order, so any app is one step from any other. On a phone the app's own pages are still at the top of the menu. The top bar also greets you by name, with a link to your account. The separate All Apps link is gone.
- 0a36c71: Your team's admins can download this app's data, and changes to its team settings appear in the team's log on the home's Apps page.
- d9a0513: The checklist archives page is now called Archives (at /archives), and a new Logs page will list the robot's match logs.
- 39f9309: Pit's Overview and Monitor show who's in the pit now: everyone with a Pit role on the team's Schedule at this moment, and until when. It's hidden while Schedule is off.
- d9a0513: Pit's Logs page shows how to set up a pit log downloader on Windows, macOS or Linux and gives mentors and admins a code to pair it with, and the downloader asks for that code and the team number when it starts, before it copies anything. Once paired, its status page takes the team's colors, names and logo from Gearbox, and it uploads match logs to Pit, whose Logs page lists them to download (mentors and admins can delete them). Google Drive isn't used any more. Logs are gzipped and at most 40 MB each (a bigger one is trimmed on the downloader, with a suggested trim around the match) and 20 per team; teams choose whether a new log replaces the oldest, and can export and delete them all. Pit's Monitor shows the three newest logs under its stream feed, and Logs sits next to Admin in Pit's bar.
- 63b1ee2: Pit opens on a new Overview: checklist progress, open issues, the next battery and the next match at a glance, each opening its page. Its pages look and work like the other apps', resetting one checklist asks first, and an open issue's Resolve button is always shown. Battery colors changed: Next Up is green, Charging amber, In Robot blue and Broken red.
- dc89f2e: The public demo: anyone can try Gearbox as a student, mentor or admin of team 9999 without an account, with sample data in every app that resets every night at midnight Eastern. In the demo, text is picked with a rotate button instead of typed. Every text box now uses one shared part, which looks the same as before outside the demo.
- c678136: Every app now takes you straight to sign in when you're signed out, and back to the page you were on. Your team's home is the exception: signed out, it shows Sign in, Sign up and your team's public site. The sign-in app is called "ID", its pages show your team's name as set in Team Appearance, and a "Find your team" link helps if you're on another team's sign-in page. Renaming your team in Team Appearance now renames it everywhere.
- 615ffd1: Team admins can choose how members sign in and see what the apps are connected to, from the team's admin pages.
- 887e1c5: App icons now use your team's primary color from Team Appearance in place of the built-in burgundy: in the top bar, on the browser tab, on a phone's home screen and on the app list's tiles. Teams that keep the default color see no change.

### Patch Changes

- 9eae762: Each app describes itself to Gearbox's app library. Switching Orders or Skill Tree on gets the team's starter parts catalog or default skill trees ready straight away.
- 67ba6d1: After an admin saves the team's appearance, every app they open or switch back to shows it straight away, including the new order of apps in the menu, instead of up to a minute later.
- 7b432c1: Team Appearance has a button text color for each theme: Automatic, Light or Dark. Light is your dark palette's text color and Dark your light palette's; Automatic picks whichever stands out more against your team's color. Each accent's preview now shows it on a button. Every button and other element filled with your team's color uses it in every app, so a bright team color can carry dark text.
  
  In dark mode, buttons and other filled elements now use your dark mode accent, where they used the light accent in both themes; app icons still use the light accent. On the default colors, dark mode's buttons are the lighter red with dark text.
- eb87549: The default accent colors are now #a32035 in light mode and #bd263e in dark mode, and the Gearbox site's top bar matches the apps' bar, with its name in Agency FB in the accent color.
- e8407dd: Each log on the pit log downloader's status page has a Delete button: it deletes the log from the pit computer (it isn't copied off the robot again) and, for a log already in Pit, can delete it from Gearbox too.
- 2a0df40: Added to an Android home screen, each app installs as its own app with a full-size icon instead of a small one on a white circle.
- eb87549: Pages that fit on the screen no longer scroll: not by the top bar's height, not while a page loads, and not by a phone's address bar. Skill Tree's Overview no longer scrolls sideways on a phone.
- 5e13bcf: An address under `/api` opened in the browser now reaches the API instead of showing the app's own page. No link in Pit was affected.
- 3f52367: Pit: an open issue on the Checklists page opens the checklist it's on, at its item. Each checklist has links at the bottom to the lists before and after it, named for them.
- 259d6a5: Making battery labels with nothing chosen shows an error on the page.
- 5ccb9db: Pit: the buttons at the bottom of a checklist that open the lists before and after it are in the team's color.
- 1a7f1b1: The Logs page no longer fails to open once there are match logs.
- 4fa73e5: Only admins can delete match logs in Pit, one at a time or all after an export.
- b912dd1: Pit's Monitor starts its right-hand column at the top, beside the Nexus status, instead of under an empty gap.
- 50a060d: The old api.<app> addresses are retired: they answer 410 with the app's address to use instead (https://<app>.<domain>/api). Deployers: before releasing, move Slack's command and event URLs, re-save Shop's Onshape settings (which now replaces its webhook rather than adding one), and point the edge box at https://edge.<domain>/api (docs/deploy.md).
- 883e23d: Signing in now also checks that your account belongs to the team whose address you're on.
- 50a060d: Every app shows the team it's on, from that team's appearance settings: its names, links and sign-in address. A team that hasn't set its appearance gets its own name, number and FRC links rather than G3's.
- 883e23d: When an operator deletes a team, its data in every app is deleted too (Shop's files and Onshape webhook, Edge's box key included), and nothing else is deleted if an app can't. Orders keeps each team's Share-A-Cart connection encrypted. Deployers: set Orders' `SECRETS_KEY` secret before deploying it.
- 680a558: Apps are reachable only through the gateway (no more workers.dev addresses), which now also serves teams at <number>-<app> addresses and keeps each team's sessions to its own apps. G3ID reports the signed-in user's team and answers team lookups.
- 50a060d: Teams on the platform's domain now keep one light/dark setting across all their apps, as G3's do.
- c5cf623: The "Hello, name!" link to your account is at the right of the top bar at every screen width, on a phone too. A name too long for the room is cut short.
- 6fbfadb: Shorter descriptions and hints across the apps: they say what you can do on a page and leave out how it works underneath. Spelling follows US English throughout, so a canceled request now reads "Canceled".
- b5ce375: Names are the same across the apps. An app's settings page is called Admin: Orders' and Inventory's Settings pages are now Admin (old links still open them), and Shop's Admin is last in its bar. Every "Log in" and "Log Out" is now "Sign in" and "Sign out". A page's title matches its link in the top bar: Pit's Editor is Edit Checklists and its admin page is titled Admin; ID's Dash is Account, its Kiosk Devices page is titled that, and its Attendance admin page is Attendance; Portal's Manage Apps and Appearance; Edge's Overview and Drive.
  
  Fixes: in Pit, card headings that couldn't be read, error messages that were a dark block in light mode, and checklist progress bars that were red until complete (they are your team's color now). In Pit, Shop and Portal, pages no longer scroll a little when they have nothing to scroll. In ID, revoking a kiosk asks first. In Orders and Inventory, dates follow your own language. Inventory's search and filters stay when you reload or go back.
- c678136: An address that isn't a page now takes you to the app's home instead of showing a blank page.
