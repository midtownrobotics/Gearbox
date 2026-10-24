# @g3/worker-inventory

## 1.1.0

### Minor Changes

- 9006f60: Report a problem or suggest an idea from any app: the menu has "Report a problem", which posts it as a public issue on Gearbox's GitHub with the page and app versions (never your name), and you get a Slack or Discord message when it's fixed or closed. No GitHub account needed. Not in the public demo. Deployers: apply the platform's migration `0012_problem_reports.sql` before deploying it, and set its `GITHUB_TOKEN` secret (`docs/deploy.md`, "Problem reports on GitHub"); without it, reports are kept, and those under a week old are sent once it's set.

### Patch Changes

- 05068af: Your team's logo keeps its shape in the top bar: a wide logo shows wider and a tall one narrower, instead of being squeezed into a square.
- 05068af: On a phone, a long team and app name in the top bar and the menu is cut short ("ROBOWARRIORS SKILL TR…") instead of pushing the menu's close button and your greeting off the screen.
- 73d2f28: Long links, part names and other long text wrap or are cut short on phones instead of making the page scroll sideways.

## 1.0.0

### Major Changes

- eff34b8: Inventory is a new app: everything your team owns, how many, and where. Parts are in storage at a location (a tree of places, up to four levels deep) or in use on a robot's subsystem, with Check out and Check in to move them between the two. Quantities and locations are changed right in the main table. Each entry has its own page with your team's fields, the vendor listings it's bought as (linked to the Orders catalog, with product page, price and a Request button), and a history of everything done to it. Mentors can merge equivalent parts into one entry and split them again. Admins set up fields, locations, robots and subsystems on Settings, or load them from a setup file.
  
  Orders: marking parts received now asks where they go in Inventory (a storage location, or in use on a robot) and adds them there. A new switch on Orders' Settings makes that required; it's off to begin with, and parts received without it don't appear in Inventory.
  
  Inventory: a Locations page shows every location as a panel that opens, with what's kept in it. From there you can move an entry, or everything in a location, in one go, and give a location a title that says what belongs there ("A1 - Misc. Electronics"), which then shows beside its name everywhere.
  
  Orders: when marking parts received, each part has its own place in Inventory. It starts as where Inventory already keeps that part, or else where it went the last time it was received.
  
  Orders: requests and catalog parts have a "Pack of" number, for things sold several to a unit. A pack of 4 is still ordered and budgeted as 1, and arrives in Inventory as 4 parts. New Request fills it in from the catalog, or guesses it from the product's name for you to check.
  
  Orders: anyone signed in can now mark parts received on the Receiving page, not only mentors and whoever asked for the part. Approving and placing orders are still for mentors.
  
  Orders: name and category suggestions on New Request no longer fail for long product links.
  
  Before deploying: create Inventory's database, apply its migration and deploy its worker first. Orders' worker now binds to it and won't deploy until it exists (see docs/deploy.md). Apply Orders' new migrations (0016 and 0017) and Inventory's second (0002) before deploying them.
- 883e23d: Inventory keeps each team's parts, locations and history to itself, and parts received in Orders go into the receiving member's own team's Inventory. Deployers: apply Inventory's migration `0003_teams.sql` (`pnpm --filter @g3/worker-inventory run db:migrate:remote`) before deploying its worker.

### Minor Changes

- 3e1cc08: The menu button is in the top bar at every screen width. It lists your team's apps under "All Apps": the team's home first, then each app that's on, in your home page's order, so any app is one step from any other. On a phone the app's own pages are still at the top of the menu. The top bar also greets you by name, with a link to your account. The separate All Apps link is gone.
- 0a36c71: Your team's admins can download this app's data, and changes to its team settings appear in the team's log on the home's Apps page.
- 615ffd1: Features that need another app are hidden while your team has that app switched off: part lookup and printing without Edge, receiving into Inventory without Inventory, the Orders catalog in Inventory without Orders, and the Leaderboard without Attendance.
- aee560c: On Settings, admins can put locations in order by dragging them: each location has a handle, and it moves among the ones in the same place. It works with a mouse, a touch screen, or the keyboard (space to pick up, arrow keys to move, space to put down).
- dc89f2e: The public demo: anyone can try Gearbox as a student, mentor or admin of team 9999 without an account, with sample data in every app that resets every night at midnight Eastern. In the demo, text is picked with a rotate button instead of typed. Every text box now uses one shared part, which looks the same as before outside the demo.
- 887e1c5: App icons now use your team's primary color from Team Appearance in place of the built-in burgundy: in the top bar, on the browser tab, on a phone's home screen and on the app list's tiles. Teams that keep the default color see no change.

### Patch Changes

- 09a3f2d: Team Appearance has simpler colors. Your team's color is now its accent, in a shade for light mode and one for dark mode; the separate primary brand color is gone, and a color you chose there carries over. The two accents can be linked, so a color entered for one gives the other the same hue, and each has saturation and brightness sliders to set it against its own background. The other palette colors are under "More options", with a preview of each theme showing them together. In the apps, buttons and icons use the light accent, and in dark mode links and highlights use the dark accent.
  
  Every app now follows those colors. Shop, Pit, Scouting and the portal's sign-in screen used fixed colors of their own and now take your team's accent, backgrounds, borders and text, as do the cards, borders and gray text inside the other apps and the text in the top bar. Colors that carry a meaning (green for done, red for an error or deleting, status badges, alliance colors) stay as they are. On the default colors, Pit's and the portal's bright red buttons become the burgundy used everywhere else.
- 9eae762: Each app describes itself to Gearbox's app library. Switching Orders or Skill Tree on gets the team's starter parts catalog or default skill trees ready straight away.
- 67ba6d1: After an admin saves the team's appearance, every app they open or switch back to shows it straight away, including the new order of apps in the menu, instead of up to a minute later.
- 7b432c1: Team Appearance has a button text color for each theme: Automatic, Light or Dark. Light is your dark palette's text color and Dark your light palette's; Automatic picks whichever stands out more against your team's color. Each accent's preview now shows it on a button. Every button and other element filled with your team's color uses it in every app, so a bright team color can carry dark text.
  
  In dark mode, buttons and other filled elements now use your dark mode accent, where they used the light accent in both themes; app icons still use the light accent. On the default colors, dark mode's buttons are the lighter red with dark text.
- eb87549: The default accent colors are now #a32035 in light mode and #bd263e in dark mode, and the Gearbox site's top bar matches the apps' bar, with its name in Agency FB in the accent color.
- 2a0df40: Added to an Android home screen, each app installs as its own app with a full-size icon instead of a small one on a white circle.
- cec0c43: Inventory fits a phone. The main list no longer scrolls sideways there: each row is two lines, the entry and its Check out / Check in button, then its location, quantity and status. Your team's own columns are left out on a phone; they're on the entry's page.
  
  The Locations page is more compact. A location's count is always at the right of its first line. The box for what's kept there is gone: "Add description" beside the name opens it, and a description shows on its own line under the name, with Edit. "Move all" is now under a location's entries.
- eb87549: Pages that fit on the screen no longer scroll: not by the top bar's height, not while a page loads, and not by a phone's address bar. Skill Tree's Overview no longer scrolls sideways on a phone.
- c678136: Pages no longer stretch or bounce when you scroll past their edges on a phone, the same in every app.
- 4cdbe3b: Errors, Delete buttons and other marks of a problem (a denied or blocking request, an order to place today, a late or over-budget line, a printer error) are now red whatever your team's color; they used to take the team's color. Buttons and text boxes show a ring when you reach them with the keyboard. Inventory's "In use" and "In storage" labels have the same outline as the other apps' status labels.
- c678136: Every app now takes you straight to sign in when you're signed out, and back to the page you were on. Your team's home is the exception: signed out, it shows Sign in, Sign up and your team's public site. The sign-in app is called "ID", its pages show your team's name as set in Team Appearance, and a "Find your team" link helps if you're on another team's sign-in page. Renaming your team in Team Appearance now renames it everywhere.
- 883e23d: When an operator deletes a team, its data in every app is deleted too (Shop's files and Onshape webhook, Edge's box key included), and nothing else is deleted if an app can't. Orders keeps each team's Share-A-Cart connection encrypted. Deployers: set Orders' `SECRETS_KEY` secret before deploying it.
- c5cf623: The "Hello, name!" link to your account is at the right of the top bar at every screen width, on a phone too. A name too long for the room is cut short.
- 6fbfadb: Shorter descriptions and hints across the apps: they say what you can do on a page and leave out how it works underneath. Spelling follows US English throughout, so a canceled request now reads "Canceled".
- b5ce375: Names are the same across the apps. An app's settings page is called Admin: Orders' and Inventory's Settings pages are now Admin (old links still open them), and Shop's Admin is last in its bar. Every "Log in" and "Log Out" is now "Sign in" and "Sign out". A page's title matches its link in the top bar: Pit's Editor is Edit Checklists and its admin page is titled Admin; ID's Dash is Account, its Kiosk Devices page is titled that, and its Attendance admin page is Attendance; Portal's Manage Apps and Appearance; Edge's Overview and Drive.
  
  Fixes: in Pit, card headings that couldn't be read, error messages that were a dark block in light mode, and checklist progress bars that were red until complete (they are your team's color now). In Pit, Shop and Portal, pages no longer scroll a little when they have nothing to scroll. In ID, revoking a kiosk asks first. In Orders and Inventory, dates follow your own language. Inventory's search and filters stay when you reload or go back.
