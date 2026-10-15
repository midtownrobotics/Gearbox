# Schedule

Who does what at each event, 15 minutes at a time.

Built like the other apps: React, React Router and Tailwind v4 with the shared top bar, colors,
fonts and light/dark mode from `@g3/ui`, plugins under `src/plugins/`, and a typed Hono client
for [`workers/schedule`](../../workers/schedule).

## Pages

- **Schedules**: opening the app, or Schedules in the bar (`/schedules`), goes to the schedule
  closest to now (on today, else the next to start; past ones left out). Every schedule is
  listed at `/schedules/all` ("← All schedules"); editors see drafts there too and make new ones.
- **A schedule** (`/schedules/:id`): **My schedule** (the viewer's runs of roles for a day, who
  shares each, and the event's periods beside) or **Everyone** (the grid: a row per attendee, a
  column per 15 minutes, the periods across the top and a mark at "now"). Editors drag across people and times to paint: each mouse button has its own tool (a role,
  or Clear), set by clicking it in the toolbar with that button (left, middle or right) (`plugins/schedules/tools.tsx`), or
  with the number keys (Shift for the right button) in the order each editor drags the toolbar
  into, kept in their own browser (the left button starts on tool 1, the right on Clear, the middle on nothing). On this page
  the browser's menu opens only on a double right-click. The
  change shows at once and is saved in one call. Undo and Redo (Ctrl+Z, Ctrl+Y or
  Ctrl+Shift+Z; `history.ts`) step back and forward through the paints since the page loaded. Hovering or focusing a name shows that person's
  minutes in each role, on the day and over the event (`person-card.tsx`); hovering or focusing a
  column's time shows how many people have each role in that 15 minutes (`slot-card.tsx`).
  An **Editing** switch beside Settings turns painting on. It's off whenever the app is opened or
  reloaded (and stays as set while moving around the app), so looking never changes anything by
  accident. The view and the day are in
  the address.
- **Settings** (`/schedules/:id/settings`, editors): name, time zone, Slack reminders, Published,
  delete; the days and their hours; the periods; who's attending.
- **Friends** (`/friends`): search the team by name to add friends, and remove them. Only you see
  your friends. A schedule's **Friends** view (between My schedule and Everyone) is the grid with
  just you and your friends, and My schedule's "With" names only friends.
- **Roles** (`/roles`, editors): the team's roles and their colors (a preset or a custom one), in
  order; archive one that's been assigned.
- **Admin** (`/admin`, mentors and admins): the trusted students who edit schedules.

Times are wall-clock slots of the event's own day (`src/shared/time.ts`), shown in the viewer's
own format. A role's color is a preset (`src/shared/role-colors.tsx`: a tint that suits light and dark mode;
no red, which means a problem) or any color the team picks, drawn as it is with black or white
text.
