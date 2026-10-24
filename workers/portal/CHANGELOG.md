# @g3/worker-portal

## 2.1.0

### Minor Changes

- db2c78c: Teams can use Discord instead of Slack: connect your server on Integrations (or when signing your team up), sign in with Discord, and get everything Gearbox sends (approvals, releases, daily summaries, reminders, service alerts and notifications) on Discord. Deployers run G3ID's and the platform's migrations first, and set up the Discord app (docs/deploy.md, "Discord") to switch it on.

## 2.0.0

### Major Changes

- 5befc47: G3's apps moved to frcgearbox.com: 1648-<app>.frcgearbox.com (home at 1648.frcgearbox.com, sign-in at 1648-id.frcgearbox.com). The old g3robotics.com app addresses no longer work; they show where each app went. Everyone signs in again once. Deployers: follow "Moving G3 to frcgearbox.com" in docs/deploy.md before releasing.
- c3fc43e: Each app is now one worker: it serves the app's page and its API at /api on the app's own address (https://orders.<domain>/api), behind one gateway worker on *.<domain>. Deploying changes (see docs/deploy.md): no more Cloudflare Pages, sign-in callbacks move to https://g3id.<domain>/api/auth/<provider>/callback (add them to each provider first), and the old api.<app> addresses keep working through the gateway.

### Minor Changes

- 09a3f2d: Team Appearance has simpler colors. Your team's color is now its accent, in a shade for light mode and one for dark mode; the separate primary brand color is gone, and a color you chose there carries over. The two accents can be linked, so a color entered for one gives the other the same hue, and each has saturation and brightness sliders to set it against its own background. The other palette colors are under "More options", with a preview of each theme showing them together. In the apps, buttons and icons use the light accent, and in dark mode links and highlights use the dark accent.
  
  Every app now follows those colors. Shop, Pit, Scouting and the portal's sign-in screen used fixed colors of their own and now take your team's accent, backgrounds, borders and text, as do the cards, borders and gray text inside the other apps and the text in the top bar. Colors that carry a meaning (green for done, red for an error or deleting, status badges, alliance colors) stay as they are. On the default colors, Pit's and the portal's bright red buttons become the burgundy used everywhere else.
- 0a36c71: Before switching an app off, admins can download its data; every admin hears on Slack when an app is switched on or off; and the Apps page's log now shows big settings changes in any app. Apply platform migration 0006_team_log_actions.sql before deploying.
- 9eae762: Teams choose their apps: a team's admins switch apps on and off on the new Apps page of their team's admin pages (`<number>.frcgearbox.com/admin`), which also has Appearance and Slack, moved there from G3ID (the old G3ID pages redirect). An app that's off can't be opened by anyone on the team, and the home lists only the apps that are on. Its data is kept for 90 days, so switching it on again brings everything back; after that it's deleted. Teams already on Gearbox keep every app on; new teams start with none. Deployers: apply the platform's migration `0005_team_apps.sql` (`pnpm --filter @g3/worker-platform run db:migrate:remote`) before deploying.
- 3e1cc08: The menu button is in the top bar at every screen width. It lists your team's apps under "All Apps": the team's home first, then each app that's on, in your home page's order, so any app is one step from any other. On a phone the app's own pages are still at the top of the menu. The top bar also greets you by name, with a link to your account. The separate All Apps link is gone.
- c678136: Attendance is now its own app with a menu: the Leaderboard, a new My Attendance page with your own hours, meetings and visits, QR Codes (the sign-in displays and how to set up a shop screen) and Admin. ID's Leaderboard and Attendance pages take you there, and Portal has an Attendance tile. A QR display that can't get a new code now says why and tries again, and the displays fit the screen without scrolling.
- 7b432c1: Team Appearance has a button text color for each theme: Automatic, Light or Dark. Light is your dark palette's text color and Dark your light palette's; Automatic picks whichever stands out more against your team's color. Each accent's preview now shows it on a button. Every button and other element filled with your team's color uses it in every app, so a bright team color can carry dark text.
  
  In dark mode, buttons and other filled elements now use your dark mode accent, where they used the light accent in both themes; app icons still use the light accent. On the default colors, dark mode's buttons are the lighter red with dark text.
- 615ffd1: Features that need another app are hidden while your team has that app switched off: part lookup and printing without Edge, receiving into Inventory without Inventory, the Orders catalog in Inventory without Orders, and the Leaderboard without Attendance.
- c678136: Your Account page (sign-ins and kiosk PIN) and the admins' Members and Kiosk Devices pages are now on your team's home; old ID links take you there. ID is only for signing in, so it's no longer a tile on the home page. Members now show a status badge only when they're Pending or Rejected, and the Kiosk Devices page says where to enter an activation code. Admins can now make themselves a mentor, or stop being one, from Members.
- fb68da5: Team admins choose where Gearbox notifications go on the new Notifications admin page: for each type, who sees it under the apps on the home page (everyone, admins or nobody), a Slack channel and the members it's sent to.
- c678136: Team admins can see each time a Gearbox operator opened their team's information or changed their team, and why, on the new Operator Access admin page.
- f624f93: Team admins can reorder the portal's apps grid on the Team Appearance page; each team keeps its own order.
- f624f93: The apps grid has FRCTools Orders and FRCBOM tiles; admins can change or hide them like the other links in Team Appearance.
- c678136: Every app now takes you straight to sign in when you're signed out, and back to the page you were on. Your team's home is the exception: signed out, it shows Sign in, Sign up and your team's public site. The sign-in app is called "ID", its pages show your team's name as set in Team Appearance, and a "Find your team" link helps if you're on another team's sign-in page. Renaming your team in Team Appearance now renames it everywhere.
- fb68da5: Choose Slack channels by searching their names instead of pasting IDs, on Shop's Admin page and the Notifications admin page. Teams that connected Slack before this have to connect it again on Integrations to see their channels.
- 615ffd1: Team admins can choose how members sign in and see what the apps are connected to, from the team's admin pages.
- 887e1c5: App icons now use your team's primary color from Team Appearance in place of the built-in burgundy: in the top bar, on the browser tab, on a phone's home screen and on the app list's tiles. Teams that keep the default color see no change.
- 88f0d3c: Let G3ID admins edit team branding, theme defaults, and shared UI colors in a team-keyed D1 record. Add a reset to defaults and explain that text colors apply to shared UI rather than all app text. Make all portal resource links editable, including FRC-Events, The Blue Alliance, Statbotics, and match13, with separate hide and remove controls. Preserve existing saved branding when adding new link settings.

### Patch Changes

- c678136: Appearance has Save team appearance and Reset to defaults at the top of the page as well as the bottom.
- 67ba6d1: After an admin saves the team's appearance, every app they open or switch back to shows it straight away, including the new order of apps in the menu, instead of up to a minute later.
- b532aa2: Attendance has a new icon, in your team's color.
- 9eae762: The Links section of Appearance is a compact list of the links your team shows, one row each with a button to remove it; add another from the "Add a link" menu.
- eb87549: The default accent colors are now #a32035 in light mode and #bd263e in dark mode, and the Gearbox site's top bar matches the apps' bar, with its name in Agency FB in the accent color.
- 9eae762: Gearbox's home page is rewritten around what Gearbox does for a team, and has a "My team" button that goes straight to the team you last signed in to, or asks for your team number. An address for a team that isn't on Gearbox now shows a page to try another number or sign that team up, and any other address on frcgearbox.com that doesn't exist shows a not-found page instead of an error.
- e5329d3: ID's and Portal's pages now look like the other apps': the same page title, cards, buttons, text boxes and messages. Errors are red whatever your team's color. On ID's Users page the filters are near-black when chosen, Approve is the main button and Reject and Delete are red; deleting a user from the list and unlinking a sign-in from your Account ask in the page, not in a browser pop-up. Portal's switches for apps and sign-in methods ask in the same red question before switching something off.
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
- 50a060d: Sign-in pages, messages, Scouting's logo and colors, and tab icons use each team's own name, logo and color instead of G3's.
- 9eae762: Admins get an "Apps" button in the home page's top bar to get back to the app grid, and the app library page is now "Manage apps". In Appearance, removing a link also takes it out of the grid order, and a link whose address is cleared stays listed until you save.
- 883e23d: The public-site tile shows your team's logo from Team Appearance (or a globe until one is set), never a built-in one.
- dc89f2e: The public demo: anyone can try Gearbox as a student, mentor or admin of team 9999 without an account, with sample data in every app that resets every night at midnight Eastern. In the demo, text is picked with a rotate button instead of typed. Every text box now uses one shared part, which looks the same as before outside the demo.
- 680a558: G3ID's attendance pages, Portal and Skill Tree reach other apps' APIs through their own address, so they work on any team's address. Looking a member up by PIN only finds members of your own team.
- 50a060d: The old api.<app> addresses are retired: they answer 410 with the app's address to use instead (https://<app>.<domain>/api). Deployers: before releasing, move Slack's command and event URLs, re-save Shop's Onshape settings (which now replaces its webhook rather than adding one), and point the edge box at https://edge.<domain>/api (docs/deploy.md).
- 6d29e25: Schedule is a new app for who does what at each event, 15 minutes at a time. Mentors and the students they trust set up an event's days, its agenda (Load in, Lunch, Practice matches) and who's attending, then drag across the grid to give people roles like Drive Team, Scouting or Pit. Once a schedule is published, everyone sees their own day and the whole team's, and Slack reminds each person a few minutes before their role changes. It's switched on for every team that's already signed up.
- 4490d2f: Schedule has a new icon, in your team's color.
- c678136: Signing up a team now asks you to confirm you understand Gearbox is an early open beta, and a new team's first stop is choosing where Gearbox's notifications go, with a link on to choosing its apps.
- 50a060d: Every app shows the team it's on, from that team's appearance settings: its names, links and sign-in address. A team that hasn't set its appearance gets its own name, number and FRC links rather than G3's.
- 680a558: Apps are reachable only through the gateway (no more workers.dev addresses), which now also serves teams at <number>-<app> addresses and keeps each team's sessions to its own apps. G3ID reports the signed-in user's team and answers team lookups.
- 50a060d: Teams on the platform's domain now keep one light/dark setting across all their apps, as G3's do.
- c5cf623: The "Hello, name!" link to your account is at the right of the top bar at every screen width, on a phone too. A name too long for the room is cut short.
- b5ce375: Names are the same across the apps. An app's settings page is called Admin: Orders' and Inventory's Settings pages are now Admin (old links still open them), and Shop's Admin is last in its bar. Every "Log in" and "Log Out" is now "Sign in" and "Sign out". A page's title matches its link in the top bar: Pit's Editor is Edit Checklists and its admin page is titled Admin; ID's Dash is Account, its Kiosk Devices page is titled that, and its Attendance admin page is Attendance; Portal's Manage Apps and Appearance; Edge's Overview and Drive.
  
  Fixes: in Pit, card headings that couldn't be read, error messages that were a dark block in light mode, and checklist progress bars that were red until complete (they are your team's color now). In Pit, Shop and Portal, pages no longer scroll a little when they have nothing to scroll. In ID, revoking a kiosk asks first. In Orders and Inventory, dates follow your own language. Inventory's search and filters stay when you reload or go back.
- c678136: An address that isn't a page now takes you to the app's home instead of showing a blank page.
