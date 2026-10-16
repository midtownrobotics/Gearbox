# @g3/worker-attendance

## 2.0.0

### Major Changes

- 1d0c685: Move attendance history and hour totals to Cloudflare D1. The production data was copied and verified before the worker changed over. Deployments must create and populate the attendance D1 database before deploying this worker.
- 9450028: Attendance moves to a single address, attendance.<domain> (the two-level signin.attendance / signout.attendance addresses no longer worked). Open /signin, /signout or /kiosk (both codes side by side) there; point kiosk screens at the new address.
- 883e23d: Attendance keeps each team's records and settings to itself, and admins set when the school year starts and how long a session may stay open on G3ID's Attendance page. The kiosk and sign-in pages use the same colors and fonts as the other apps, with the kiosk always dark. Deployers: apply Attendance's migration `0002_teams.sql` (`pnpm --filter @g3/worker-attendance run db:migrate:remote`) before deploying its worker.
- 5befc47: G3's apps moved to frcgearbox.com: 1648-<app>.frcgearbox.com (home at 1648.frcgearbox.com, sign-in at 1648-id.frcgearbox.com). The old g3robotics.com app addresses no longer work; they show where each app went. Everyone signs in again once. Deployers: follow "Moving G3 to frcgearbox.com" in docs/deploy.md before releasing.
- c3fc43e: Each app is now one worker: it serves the app's page and its API at /api on the app's own address (https://orders.<domain>/api), behind one gateway worker on *.<domain>. Deploying changes (see docs/deploy.md): no more Cloudflare Pages, sign-in callbacks move to https://g3id.<domain>/api/auth/<provider>/callback (add them to each provider first), and the old api.<app> addresses keep working through the gateway.

### Minor Changes

- 0a36c71: Your team's admins can download this app's data, and changes to its team settings appear in the team's log on the home's Apps page.
- c678136: Attendance is now its own app with a menu: the Leaderboard, a new My Attendance page with your own hours, meetings and visits, QR Codes (the sign-in displays and how to set up a shop screen) and Admin. ID's Leaderboard and Attendance pages take you there, and Portal has an Attendance tile. A QR display that can't get a new code now says why and tries again, and the displays fit the screen without scrolling.
- b4bdfea: Every member can see attendance reports for the school year on ID's Leaderboard page (sign-ins by meeting day, how many signed in each day, meetings attended and hours over time), and admins can sign everyone out at once.
- dc89f2e: The public demo: anyone can try Gearbox as a student, mentor or admin of team 9999 without an account, with sample data in every app that resets every night at midnight Eastern. In the demo, text is picked with a rotate button instead of typed. Every text box now uses one shared part, which looks the same as before outside the demo.
- 615ffd1: Team admins can choose how members sign in and see what the apps are connected to, from the team's admin pages.

### Patch Changes

- 09a3f2d: Team Appearance has simpler colors. Your team's color is now its accent, in a shade for light mode and one for dark mode; the separate primary brand color is gone, and a color you chose there carries over. The two accents can be linked, so a color entered for one gives the other the same hue, and each has saturation and brightness sliders to set it against its own background. The other palette colors are under "More options", with a preview of each theme showing them together. In the apps, buttons and icons use the light accent, and in dark mode links and highlights use the dark accent.
  
  Every app now follows those colors. Shop, Pit, Scouting and the portal's sign-in screen used fixed colors of their own and now take your team's accent, backgrounds, borders and text, as do the cards, borders and gray text inside the other apps and the text in the top bar. Colors that carry a meaning (green for done, red for an error or deleting, status badges, alliance colors) stay as they are. On the default colors, Pit's and the portal's bright red buttons become the burgundy used everywhere else.
- 9eae762: Each app describes itself to Gearbox's app library. Switching Orders or Skill Tree on gets the team's starter parts catalog or default skill trees ready straight away.
- 67ba6d1: After an admin saves the team's appearance, every app they open or switch back to shows it straight away, including the new order of apps in the menu, instead of up to a minute later.
- b532aa2: Attendance has a new icon, in your team's color.
- eb87549: The default accent colors are now #a32035 in light mode and #bd263e in dark mode, and the Gearbox site's top bar matches the apps' bar, with its name in Agency FB in the accent color.
- 2a0df40: Added to an Android home screen, each app installs as its own app with a full-size icon instead of a small one on a white circle.
- eb87549: Pages that fit on the screen no longer scroll: not by the top bar's height, not while a page loads, and not by a phone's address bar. Skill Tree's Overview no longer scrolls sideways on a phone.
- c678136: Pages no longer stretch or bounce when you scroll past their edges on a phone, the same in every app.
- 50a060d: Sign-in pages, messages, Scouting's logo and colors, and tab icons use each team's own name, logo and color instead of G3's.
- 50a060d: The old api.<app> addresses are retired: they answer 410 with the app's address to use instead (https://<app>.<domain>/api). Deployers: before releasing, move Slack's command and event URLs, re-save Shop's Onshape settings (which now replaces its webhook rather than adding one), and point the edge box at https://edge.<domain>/api (docs/deploy.md).
- 883e23d: Signing in now also checks that your account belongs to the team whose address you're on.
- c678136: Every app now takes you straight to sign in when you're signed out, and back to the page you were on. Your team's home is the exception: signed out, it shows Sign in, Sign up and your team's public site. The sign-in app is called "ID", its pages show your team's name as set in Team Appearance, and a "Find your team" link helps if you're on another team's sign-in page. Renaming your team in Team Appearance now renames it everywhere.
- 50a060d: Every app shows the team it's on, from that team's appearance settings: its names, links and sign-in address. A team that hasn't set its appearance gets its own name, number and FRC links rather than G3's.
- 883e23d: When an operator deletes a team, its data in every app is deleted too (Shop's files and Onshape webhook, Edge's box key included), and nothing else is deleted if an app can't. Orders keeps each team's Share-A-Cart connection encrypted. Deployers: set Orders' `SECRETS_KEY` secret before deploying it.
- 680a558: Apps are reachable only through the gateway (no more workers.dev addresses), which now also serves teams at <number>-<app> addresses and keeps each team's sessions to its own apps. G3ID reports the signed-in user's team and answers team lookups.
- 50a060d: Teams on the platform's domain now keep one light/dark setting across all their apps, as G3's do.
