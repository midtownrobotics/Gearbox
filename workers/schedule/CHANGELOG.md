# @g3/worker-schedule

## 0.3.0

### Minor Changes

- 9006f60: Report a problem or suggest an idea from any app: the menu has "Report a problem", which posts it as a public issue on Gearbox's GitHub with the page and app versions (never your name), and you get a Slack or Discord message when it's fixed or closed. No GitHub account needed. Not in the public demo. Deployers: apply the platform's migration `0012_problem_reports.sql` before deploying it, and set its `GITHUB_TOKEN` secret (`docs/deploy.md`, "Problem reports on GitHub"); without it, reports are kept, and those under a week old are sent once it's set.

### Patch Changes

- 05068af: Your team's logo keeps its shape in the top bar: a wide logo shows wider and a tall one narrower, instead of being squeezed into a square.
- 05068af: On a phone, a long team and app name in the top bar and the menu is cut short ("ROBOWARRIORS SKILL TR…") instead of pushing the menu's close button and your greeting off the screen.
- 73d2f28: Long links, part names and other long text wrap or are cut short on phones instead of making the page scroll sideways.

## 0.2.0

### Minor Changes

- db2c78c: Teams can use Discord instead of Slack: connect your server on Integrations (or when signing your team up), sign in with Discord, and get everything Gearbox sends (approvals, releases, daily summaries, reminders, service alerts and notifications) on Discord. Deployers run G3ID's and the platform's migrations first, and set up the Discord app (docs/deploy.md, "Discord") to switch it on.
- 2aa06eb: Pit's Monitor keeps the team's played matches in its match list, with the blue and red scores and a green W or red L in place of the time; the list opens at the next match. On a wide screen the Monitor fits the window: the match list and the checklists scroll on their own, with the column names and the overall progress bar kept at the top. The Batteries page has Pause All and Unpause All, which stop and restart every battery's timer without changing any battery's state. On the days of a published Schedule event, the timers go back to zero and pause when the first day opens, pause when each day closes, and carry on when the next day opens. In dev and staging only, Pit's Admin page has Use event snapshot, which shows GRITS 2026 halfway through qualifications on the Monitor instead of the team's event. Deployers: apply Pit's migration 0018 first, and deploy Schedule with Pit (Pit's new `SCHEDULE` service binding).

## 0.1.0

### Minor Changes

- 39f9309: Pit's Overview and Monitor show who's in the pit now: everyone with a Pit role on the team's Schedule at this moment, and until when. It's hidden while Schedule is off.
- dc89f2e: The public demo: anyone can try Gearbox as a student, mentor or admin of team 9999 without an account, with sample data in every app that resets every night at midnight Eastern. In the demo, text is picked with a rotate button instead of typed. Every text box now uses one shared part, which looks the same as before outside the demo.
- 6d29e25: Schedule is a new app for who does what at each event, 15 minutes at a time. Mentors and the students they trust set up an event's days, its agenda (Load in, Lunch, Practice matches) and who's attending, then drag across the grid to give people roles like Drive Team, Scouting or Pit. Once a schedule is published, everyone sees their own day and the whole team's, and Slack reminds each person a few minutes before their role changes. It's switched on for every team that's already signed up.
- 4490d2f: Schedule: add friends on the new Friends page by searching the team. Only you can see your friends. A schedule's new Friends view shows just you and your friends, and My schedule shows which friends share each of your roles. Apply Schedule's migration 0003 before deploying.
- 39f9309: Roles have a type, Scouting, Pit or Other, chosen when a role is made or edited on the Roles page. Existing roles are Other.

### Patch Changes

- 67ba6d1: After an admin saves the team's appearance, every app they open or switch back to shows it straight away, including the new order of apps in the menu, instead of up to a minute later.
- eb87549: The default accent colors are now #a32035 in light mode and #bd263e in dark mode, and the Gearbox site's top bar matches the apps' bar, with its name in Agency FB in the accent color.
- 2a0df40: Added to an Android home screen, each app installs as its own app with a full-size icon instead of a small one on a white circle.
- eb87549: Pages that fit on the screen no longer scroll: not by the top bar's height, not while a page loads, and not by a phone's address bar. Skill Tree's Overview no longer scrolls sideways on a phone.
- c678136: Pages no longer stretch or bounce when you scroll past their edges on a phone, the same in every app.
- 4490d2f: Schedule: hovering a time on the grid shows how many people have each role in that 15 minutes, and how many have nothing assigned.
- 4490d2f: Schedule: editors switch Editing on to change a schedule's grid. It starts off each time the app is opened, so looking at a schedule can't change it by accident.
- 4490d2f: Schedule has a new icon, in your team's color.
- 4490d2f: Schedule: the list of who's attending on a schedule's Settings page can be sorted by first or last name.
- 4490d2f: Schedule: a Tips button beside Undo and Redo lists the grid's shortcuts: painting with each mouse button, the number keys, undo and redo, and what hovering shows.
- 4490d2f: Schedule: Undo and Redo for painting the grid, with Ctrl+Z and Ctrl+Y (Cmd on a Mac).
- c678136: My schedule's "With" line reads naturally: "With Sam and Alex", "With Sam, Alex, and Jordan".
- c678136: Every app now takes you straight to sign in when you're signed out, and back to the page you were on. Your team's home is the exception: signed out, it shows Sign in, Sign up and your team's public site. The sign-in app is called "ID", its pages show your team's name as set in Team Appearance, and a "Find your team" link helps if you're on another team's sign-in page. Renaming your team in Team Appearance now renames it everywhere.
