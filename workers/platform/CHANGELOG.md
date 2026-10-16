# @g3/worker-platform

## 2.0.0

### Major Changes

- 0a36c71: Before switching an app off, admins can download its data; every admin hears on Slack when an app is switched on or off; and the Apps page's log now shows big settings changes in any app. Apply platform migration 0006_team_log_actions.sql before deploying.
- 9eae762: Teams choose their apps: a team's admins switch apps on and off on the new Apps page of their team's admin pages (`<number>.frcgearbox.com/admin`), which also has Appearance and Slack, moved there from G3ID (the old G3ID pages redirect). An app that's off can't be opened by anyone on the team, and the home lists only the apps that are on. Its data is kept for 90 days, so switching it on again brings everything back; after that it's deleted. Teams already on Gearbox keep every app on; new teams start with none. Deployers: apply the platform's migration `0005_team_apps.sql` (`pnpm --filter @g3/worker-platform run db:migrate:remote`) before deploying.
- fb68da5: Operators can write notifications for every team on the console's new Notifications page: Informational, Warning or Critical, each with a short description, the full text and when it expires.
- 5befc47: G3's apps moved to frcgearbox.com: 1648-<app>.frcgearbox.com (home at 1648.frcgearbox.com, sign-in at 1648-id.frcgearbox.com). The old g3robotics.com app addresses no longer work; they show where each app went. Everyone signs in again once. Deployers: follow "Moving G3 to frcgearbox.com" in docs/deploy.md before releasing.
- fb68da5: Team admins choose where Gearbox notifications go on the new Notifications admin page: for each type, who sees it under the apps on the home page (everyone, admins or nobody), a Slack channel and the members it's sent to.
- 680a558: Platform operators get a console at `admin.<domain>`: the list of teams and the reports against their numbers, with tools to hand a team to another member, change its team number, suspend it or delete it, all kept in a 12-month log. G3ID can now send an operator back to the console after sign-in. Deployers: apply the platform's D1 migration 0003_operators before deploying its worker, and add the first operator by hand (docs/deploy.md).
- 50a060d: Signing a team up no longer asks for a time zone. Deployers: apply the platform's migration 0004 before deploying.

### Minor Changes

- 9eae762: Gearbox's home page is rewritten around what Gearbox does for a team, and has a "My team" button that goes straight to the team you last signed in to, or asks for your team number. An address for a team that isn't on Gearbox now shows a page to try another number or sign that team up, and any other address on frcgearbox.com that doesn't exist shows a not-found page instead of an error.
- 14b0f52: The landing page is shorter and leads into the demo: an open beta bar across the top, demo buttons for a student, mentor or admin in the hero, app cards and launcher tiles that open the demo, and link previews when the page is shared.
- 235ba86: Operators see how many people visit the landing page each day, and how many of them were signed in, on the console's new Visitors page.
- 883e23d: Operators can no longer change a team's number from the console. A team that claimed the wrong number is deleted and signs up again under the right one.
- c678136: Team admins can see each time a Gearbox operator opened their team's information or changed their team, and why, on the new Operator Access admin page.
- dc89f2e: The public demo: anyone can try Gearbox as a student, mentor or admin of team 9999 without an account, with sample data in every app that resets every night at midnight Eastern. In the demo, text is picked with a rotate button instead of typed. Every text box now uses one shared part, which looks the same as before outside the demo.
- fb68da5: Operators get a Slack DM when someone reports a team number, with a link to the console's Reports page.
- dc89f2e: Make Scouting available to every team through the app library, with private forms, reports, schedules, roles, files, service tickets and optional predictions. Add subscription setup, export and deletion, and send service alerts through each team's Slack installation. Preserve the original team's data and file links; new teams start with empty editable forms and points disabled.
  
  Align Scouting with the shared app UI while preserving its scouting, analysis, drawing and touch workflows. Add direct page links and in-page questions, repair Service Tickets formatting, polish predictions, remove redundant descriptions and show the configured points name beside Available.
  
  Deployment requires action: apply Scouting migration 0033, then deploy Scouting before Platform exposes it to other teams. Existing writes require the updated Scouting worker after migration. Rehearse this order on staging.
- c678136: Signing up a team now asks you to confirm you understand Gearbox is an early open beta, and a new team's first stop is choosing where Gearbox's notifications go, with a link on to choosing its apps.
- 615ffd1: Team admins can choose how members sign in and see what the apps are connected to, from the team's admin pages.
- 883e23d: When an operator deletes a team, its data in every app is deleted too (Shop's files and Onshape webhook, Edge's box key included), and nothing else is deleted if an app can't. Orders keeps each team's Share-A-Cart connection encrypted. Deployers: set Orders' `SECRETS_KEY` secret before deploying it.
- 680a558: Teams can sign up at the platform's site: their details, their Slack workspace, and a code the founder sends to the Slack bot, which makes them the team's first admin. Other teams get their addresses on the platform's domain.

### Patch Changes

- 09a3f2d: Team Appearance has simpler colors. Your team's color is now its accent, in a shade for light mode and one for dark mode; the separate primary brand color is gone, and a color you chose there carries over. The two accents can be linked, so a color entered for one gives the other the same hue, and each has saturation and brightness sliders to set it against its own background. The other palette colors are under "More options", with a preview of each theme showing them together. In the apps, buttons and icons use the light accent, and in dark mode links and highlights use the dark accent.
  
  Every app now follows those colors. Shop, Pit, Scouting and the portal's sign-in screen used fixed colors of their own and now take your team's accent, backgrounds, borders and text, as do the cards, borders and gray text inside the other apps and the text in the top bar. Colors that carry a meaning (green for done, red for an error or deleting, status badges, alliance colors) stay as they are. On the default colors, Pit's and the portal's bright red buttons become the burgundy used everywhere else.
- b532aa2: Attendance has a new icon, in your team's color.
- c678136: Attendance is now its own app with a menu: the Leaderboard, a new My Attendance page with your own hours, meetings and visits, QR Codes (the sign-in displays and how to set up a shop screen) and Admin. ID's Leaderboard and Attendance pages take you there, and Portal has an Attendance tile. A QR display that can't get a new code now says why and tries again, and the displays fit the screen without scrolling.
- 70e73f0: The operators' console has the same top bar, page titles, buttons, fields and colors as the apps, with a light/dark switch and a menu on phones.
- eb87549: The default accent colors are now #a32035 in light mode and #bd263e in dark mode, and the Gearbox site's top bar matches the apps' bar, with its name in Agency FB in the accent color.
- 2a0df40: Added to an Android home screen, each app installs as its own app with a full-size icon instead of a small one on a white circle.
- eff34b8: Inventory is a new app: everything your team owns, how many, and where. Parts are in storage at a location (a tree of places, up to four levels deep) or in use on a robot's subsystem, with Check out and Check in to move them between the two. Quantities and locations are changed right in the main table. Each entry has its own page with your team's fields, the vendor listings it's bought as (linked to the Orders catalog, with product page, price and a Request button), and a history of everything done to it. Mentors can merge equivalent parts into one entry and split them again. Admins set up fields, locations, robots and subsystems on Settings, or load them from a setup file.
  
  Orders: marking parts received now asks where they go in Inventory (a storage location, or in use on a robot) and adds them there. A new switch on Orders' Settings makes that required; it's off to begin with, and parts received without it don't appear in Inventory.
  
  Inventory: a Locations page shows every location as a panel that opens, with what's kept in it. From there you can move an entry, or everything in a location, in one go, and give a location a title that says what belongs there ("A1 - Misc. Electronics"), which then shows beside its name everywhere.
  
  Orders: when marking parts received, each part has its own place in Inventory. It starts as where Inventory already keeps that part, or else where it went the last time it was received.
  
  Orders: requests and catalog parts have a "Pack of" number, for things sold several to a unit. A pack of 4 is still ordered and budgeted as 1, and arrives in Inventory as 4 parts. New Request fills it in from the catalog, or guesses it from the product's name for you to check.
  
  Orders: anyone signed in can now mark parts received on the Receiving page, not only mentors and whoever asked for the part. Approving and placing orders are still for mentors.
  
  Orders: name and category suggestions on New Request no longer fail for long product links.
  
  Before deploying: create Inventory's database, apply its migration and deploy its worker first. Orders' worker now binds to it and won't deploy until it exists (see docs/deploy.md). Apply Orders' new migrations (0016 and 0017) and Inventory's second (0002) before deploying them.
- e937581: Gearbox has a new icon, on the Gearbox site and on each team's home (in the team's own color).
- eb87549: Pages that fit on the screen no longer scroll: not by the top bar's height, not while a page loads, and not by a phone's address bar. Skill Tree's Overview no longer scrolls sideways on a phone.
- c678136: Pages no longer stretch or bounce when you scroll past their edges on a phone, the same in every app.
- 615ffd1: The home page's example pick list no longer names a real team.
- fb68da5: The "nothing is here" and "couldn't find that team" pages have a picture.
- 50a060d: Sign-in pages, messages, Scouting's logo and colors, and tab icons use each team's own name, logo and color instead of G3's.
- 259d6a5: The operators' console asks in the page before removing an operator.
- 9450028: Team sign-up's "Add to Slack" button has the Slack app's client ID, so it opens Slack instead of failing.
- 6d29e25: Schedule is a new app for who does what at each event, 15 minutes at a time. Mentors and the students they trust set up an event's days, its agenda (Load in, Lunch, Practice matches) and who's attending, then drag across the grid to give people roles like Drive Team, Scouting or Pit. Once a schedule is published, everyone sees their own day and the whole team's, and Slack reminds each person a few minutes before their role changes. It's switched on for every team that's already signed up.
- 883e23d: Signing in now also checks that your account belongs to the team whose address you're on.
- c678136: Every app now takes you straight to sign in when you're signed out, and back to the page you were on. Your team's home is the exception: signed out, it shows Sign in, Sign up and your team's public site. The sign-in app is called "ID", its pages show your team's name as set in Team Appearance, and a "Find your team" link helps if you're on another team's sign-in page. Renaming your team in Team Appearance now renames it everywhere.
- c678136: Gearbox's notifications in Slack now open with "Gearbox Critical Notification" (or Warning, Informational) and show the message as a quote.
- 50a060d: Teams on the platform's domain now keep one light/dark setting across all their apps, as G3's do.
- 6fbfadb: Shorter descriptions and hints across the apps: they say what you can do on a page and leave out how it works underneath. Spelling follows US English throughout, so a canceled request now reads "Canceled".
- Updated dependencies [09a3f2d]
- Updated dependencies [c9827c9]
- Updated dependencies [0a36c71]
- Updated dependencies [9eae762]
- Updated dependencies [9eae762]
- Updated dependencies [3e1cc08]
- Updated dependencies [c678136]
- Updated dependencies [67ba6d1]
- Updated dependencies [0a36c71]
- Updated dependencies [1d0c685]
- Updated dependencies [b532aa2]
- Updated dependencies [c678136]
- Updated dependencies [9450028]
- Updated dependencies [b4bdfea]
- Updated dependencies [883e23d]
- Updated dependencies [7b432c1]
- Updated dependencies [590cf98]
- Updated dependencies [590cf98]
- Updated dependencies [48599df]
- Updated dependencies [9eae762]
- Updated dependencies [eb87549]
- Updated dependencies [5dfc5b0]
- Updated dependencies [e8407dd]
- Updated dependencies [d699aad]
- Updated dependencies [1d4929b]
- Updated dependencies [615ffd1]
- Updated dependencies [337a26b]
- Updated dependencies [615ffd1]
- Updated dependencies [f8d09fa]
- Updated dependencies [d699aad]
- Updated dependencies [a1b1142]
- Updated dependencies [883e23d]
- Updated dependencies [615ffd1]
- Updated dependencies [9eae762]
- Updated dependencies [5befc47]
- Updated dependencies [21262f9]
- Updated dependencies [680a558]
- Updated dependencies [615ffd1]
- Updated dependencies [a525a2e]
- Updated dependencies [c678136]
- Updated dependencies [e5329d3]
- Updated dependencies [b4bdfea]
- Updated dependencies [2a0df40]
- Updated dependencies [eff34b8]
- Updated dependencies [cec0c43]
- Updated dependencies [aee560c]
- Updated dependencies [883e23d]
- Updated dependencies [e937581]
- Updated dependencies [eb87549]
- Updated dependencies [c678136]
- Updated dependencies [883e23d]
- Updated dependencies [fb68da5]
- Updated dependencies [c3fc43e]
- Updated dependencies [d1b9635]
- Updated dependencies [d1b9635]
- Updated dependencies [c678136]
- Updated dependencies [680a558]
- Updated dependencies [14d9fbd]
- Updated dependencies [259d6a5]
- Updated dependencies [40d6ab6]
- Updated dependencies [2224734]
- Updated dependencies [f624f93]
- Updated dependencies [f624f93]
- Updated dependencies [40d6ab6]
- Updated dependencies [883e23d]
- Updated dependencies [f624f93]
- Updated dependencies [fb68da5]
- Updated dependencies [50a060d]
- Updated dependencies [883e23d]
- Updated dependencies [5e13bcf]
- Updated dependencies [d9a0513]
- Updated dependencies [227660d]
- Updated dependencies [3f52367]
- Updated dependencies [39f9309]
- Updated dependencies [259d6a5]
- Updated dependencies [5ccb9db]
- Updated dependencies [1a7f1b1]
- Updated dependencies [d9a0513]
- Updated dependencies [4fa73e5]
- Updated dependencies [b912dd1]
- Updated dependencies [63b1ee2]
- Updated dependencies [883e23d]
- Updated dependencies [9eae762]
- Updated dependencies [f624f93]
- Updated dependencies [f624f93]
- Updated dependencies [883e23d]
- Updated dependencies [dc89f2e]
- Updated dependencies [680a558]
- Updated dependencies [3ecf4f6]
- Updated dependencies [615ffd1]
- Updated dependencies [50a060d]
- Updated dependencies [6d29e25]
- Updated dependencies [4490d2f]
- Updated dependencies [4490d2f]
- Updated dependencies [4490d2f]
- Updated dependencies [4490d2f]
- Updated dependencies [4490d2f]
- Updated dependencies [39f9309]
- Updated dependencies [4490d2f]
- Updated dependencies [4490d2f]
- Updated dependencies [c678136]
- Updated dependencies [627dca4]
- Updated dependencies [eb87549]
- Updated dependencies [dc89f2e]
- Updated dependencies [5dfdf0b]
- Updated dependencies [4cdbe3b]
- Updated dependencies [dc89f2e]
- Updated dependencies [680a558]
- Updated dependencies [4cdbe3b]
- Updated dependencies [5e13bcf]
- Updated dependencies [f576bee]
- Updated dependencies [c21a4cc]
- Updated dependencies [2e57a8f]
- Updated dependencies [c7d0251]
- Updated dependencies [8a5745e]
- Updated dependencies [f624f93]
- Updated dependencies [a95a057]
- Updated dependencies [883e23d]
- Updated dependencies [883e23d]
- Updated dependencies [680a558]
- Updated dependencies [c678136]
- Updated dependencies [c678136]
- Updated dependencies [f1bca7f]
- Updated dependencies [259d6a5]
- Updated dependencies [fb68da5]
- Updated dependencies [26c0a57]
- Updated dependencies [680a558]
- Updated dependencies [680a558]
- Updated dependencies [50a060d]
- Updated dependencies [615ffd1]
- Updated dependencies [883e23d]
- Updated dependencies [680a558]
- Updated dependencies [887e1c5]
- Updated dependencies [680a558]
- Updated dependencies [88f0d3c]
- Updated dependencies [50a060d]
- Updated dependencies [c5cf623]
- Updated dependencies [6fbfadb]
- Updated dependencies [b5ce375]
- Updated dependencies [c678136]
- Updated dependencies [615ffd1]
  - @g3/worker-g3id@2.0.0
  - @g3/worker-portal@2.0.0
  - @g3/worker-shop@2.0.0
  - @g3/worker-pit@2.0.0
  - @g3/worker-scouting@2.0.0
  - @g3/worker-orders@2.0.0
  - @g3/worker-edge@2.0.0
  - @g3/worker-skill-tree@2.0.0
  - @g3/worker-inventory@1.0.0
  - @g3/worker-attendance@2.0.0
  - @g3/worker-schedule@0.1.0
