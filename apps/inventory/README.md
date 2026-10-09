# Inventory

What a team owns, where it is, and what's on a robot.

Built like the other apps: React, React Router and Tailwind v4 with the shared top bar, colors,
fonts and light/dark mode from `@g3/ui`, plugins under `src/plugins/`, and a typed Hono client
for [`workers/inventory`](../../workers/inventory).

## How it's arranged

- An **entry** is one kind of part. It has a name, the team's own **fields**, and one or more
  **vendor listings** (the ways to buy it). Equivalent parts from different vendors are several
  listings on one entry.
- An entry's parts are counted per place. A place is a **location** in storage, or a location plus
  the **robot** and **subsystem** the parts are in use on. The main table has a row for each place
  an entry has parts.
- Locations are a tree, up to four levels (a room, a cabinet, a drawer, a bin).

None of that arrangement is part of the app. A team defines its fields, locations, robots and
subsystems on Settings, or loads them from a setup file. A new team starts empty and can load the
starter setup that comes with the app.

## Who can do what

- **Anyone signed in** (kiosk PIN sessions too) sees everything, adds and edits entries, counts,
  moves, checks parts out and in, adds or removes vendor listings, gives a location its description and
  moves everything in a location somewhere else.
- **Mentors and admins** (the G3ID roles, never a kiosk PIN session) delete entries, merge two
  entries into one, and split a listing off as its own entry.
- **Admins** arrange Settings: fields, locations, robots, subsystems and setup files. Locations
  are put in order by dragging them by their handles, each among the ones in the same place.

Every change to an entry is in its History, with who made it.

## Pages

- **Inventory** (`/inventory`): the main table. Type a new quantity to record a count, click a
  location to change it, and use Check out / Check in to move parts between storage and a robot.
  Check in is preset to put parts back with the entry's parts already in storage (the first such
  row, if it's kept in several places). On a phone each row is two lines, so nothing scrolls
  sideways: the entry and its Check out / Check in button, then its location, quantity and
  status. The team's own columns are left out there; they're on the entry's page.
- **Locations** (`/locations`): the table the other way round. Every location is a panel that
  opens, nested like the tree, with what's kept in it. "Add description" beside a location's name
  says what belongs there: it shows under the name, and the location then reads
  "A1 - Misc. Electronics" everywhere else, in Orders' receive pop-up too (in a setup file it is
  the location's `title`). Move an entry, or everything in a location with "Move all", when things
  are rearranged:
  whole quantities move at once, and the locations themselves stay as they are.
- **Add an entry** (`/new`).
- **An entry** (`/items/:id`): details, where its parts are, vendor listings, history.
- **Settings** (`/settings`, admins).

## Orders

- A listing can be a part from Orders' catalog. It then shows the catalog's product page and what
  was last paid, and has a Request button that starts a request in Orders. A part is on one entry
  at most. The catalog is read through Orders' API (`/api/~orders/catalog`); without Orders, a
  listing shows its own saved copy.
- When a part is marked received in Orders, the person receiving it can say where it goes, and it's
  added here (`POST /intake` on the worker): to the entry with that listing, or a new entry.
  Whether that's required is a setting in Orders. Each part's location starts as where this app
  already keeps it, else where it went the last time it was received.

## Setup files

```json
{
  "format": "gearbox-inventory-setup",
  "version": 1,
  "fields": [
    { "name": "Type", "type": "choice", "options": ["Hardware", "Motors"] },
    { "name": "Notes", "type": "paragraph", "showInTable": false }
  ],
  "locations": [
    { "name": "Shop", "children": [{ "name": "Shelves", "children": ["Bin 1", "Bin 2"] }] }
  ],
  "robots": ["Competition robot"],
  "subsystems": ["Drivetrain", "Intake"]
}
```

Field types: `text`, `paragraph`, `number`, `choice` (with `options`), `checkbox`, `link`, `date`.
A location is a name, or `{ "name", "title", "children" }` (the title is optional), at most four
levels deep. Loading a file only
adds what the team doesn't have yet, matched by name; nothing is changed or removed.

## Development

```bash
pnpm --filter @g3/worker-inventory run db:migrate:local
pnpm dev   # page on :5186, worker on :8797
pnpm --filter @g3/worker-inventory test
```
