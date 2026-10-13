# UI Alignment

Status as of 12 October 2026. This file is the plan of record for giving every app one design language. When a change completes or advances a step, update the Progress table here in the same pull request.

## Summary

The eleven apps were built at different times and look and behave differently. Four of them (Orders, Inventory, Skill Tree, Edge) already shared one set of page parts, copied from app to app. That set is the platform's design language. The work is to keep those parts in one place, `@g3/ui`, and move every other app onto them, nearest first.

The rule behind every choice here: change the fewer apps to match what most apps already do. Where this file goes against the majority, it says why.

A survey of every difference, with sketches, is at <https://claude.ai/artifact/CjUj3fDismKrCcWjgZUk2q>. It is a private page that only its owner can open, so everything needed to do the work is repeated in this file. The survey was read from `main` at `40d6ab6` on 11 October 2026; counts below come from it and will drift.

## Progress

| Step | Status | Apps | What is left |
| --- | --- | --- | --- |
| 1. Shared parts in `@g3/ui` | Done | Orders, Inventory, Skill Tree, Edge | Nothing |
| 2. Fixes that need no decision | Done | Pit, Shop, ID, Portal, Orders, Inventory, Edge | Nothing. Four things it found were passed to later steps (see step 2 below) |
| 3. Edge onto the full set | Done | Edge | Nothing |
| 4. ID and Portal onto the shared frame | Done | ID, Portal | Nothing. A few things were left as they are on purpose (see step 4 below) |
| 5. Pit, with its Overview | Done | Pit | Nothing. Its few icon marks wait for the Lucide icons (see step 5 below) |
| 6. Shop | Done | Shop | Nothing. The shop view's large buttons and the green Complete buttons stay Shop's own (see step 6 below) |
| 7. Browser pop-ups | Done | Orders, Skill Tree, Platform, Pit (and Edge, ID and Shop in their own steps) | Nothing outside Scouting, whose 24 go with step 8 |
| 8. Scouting | Not started | Scouting | All of it, with its Phase 3 step in `roadmap.md` |

### What landed

| Change | Step | Pull request |
| --- | --- | --- |
| The page parts moved from each app's `shared/ui.tsx` into `@g3/ui`: `Page`, `PageLoading`, `Card`, `Stat`, `Button`, `ConfirmButton`, `Field`, `inputClass`, `ErrorBanner`, `SuccessBanner`, `Loading`, `Dialog`, `Toggle`, `Badge` with `tones`, `ProgressBar`, `focusRing`. Orders, Inventory, Skill Tree and Edge import them and have no `shared/ui.tsx`. Errors, danger buttons and every other mark of a problem in those four apps are red where they were the team's color. Buttons and inputs show a focus ring. Scouting is called Scouting in its own bar and tab, where it said Strategy | 1, and the name from 2 | [#186](https://github.com/midtownrobotics/Gearbox/pull/186) |
| Names: Orders' and Inventory's Settings page is Admin (at `/admin`; `/settings` still opens it), Pit's Admin page is titled Admin, Shop's Admin is last in the bar, and every "Log in" and "Log Out" is "Sign in" and "Sign out". Titles match their bar labels in Pit (Edit Checklists), ID (Account, Kiosk Devices, Attendance), Portal (Manage Apps, Appearance) and Edge (Overview, Drive). Bugs: Pit's unreadable headings, dark error blocks and red progress bars; pages a bar's height too tall in Pit, Shop and Portal; ID's kiosk revoke asks first; Orders' and Inventory's dates follow the viewer's language; Inventory's search and filters are in the address; unused icon libraries dropped from Pit and Shop | 2 | [#187](https://github.com/midtownrobotics/Gearbox/pull/187) |
| Edge's hand-written buttons and inputs are the shared `Button` and `inputClass`, and it has no button or input styles of its own. `Button` and `ConfirmButton` take `size="sm"`. Edge's three browser confirms (a new box key, deleting a blocklist, removing a printer) ask in the page, and deleting a door sound now asks too | 3, and Edge's part of 7 | [#188](https://github.com/midtownrobotics/Gearbox/pull/188) |
| ID's and Portal's pages are built from the shared parts: `Page` for every ordinary page, `Card`, `Button`, `Field` and `inputClass`, the banners, `Badge` for a member's status. Their titles are the shared 36px title, on the sign-in and kiosk screens too. Errors that were in the team's color are red. ID's Users filters are near-black chips. ID's last browser pop-ups are gone: unlinking a sign-in and deleting a user from the list ask in the page, and three alerts are errors on the page. New shared parts: `Switch` (Portal's two copies and Edge's are one), `Chip`, `ConfirmQuestion`, `buttonClass` for a link that looks like a button, and `size="lg"` for touch screens | 4, and ID's part of 7 | [#189](https://github.com/midtownrobotics/Gearbox/pull/189) |
| Pit's pages are built from the shared parts, and no `gray-*` class is left in the app: `Page` at the narrow width, `Card`, `Button`, `Field`, the banners, `Dialog` for its two pop-ups, `Badge` and `Chip` for a battery's state, `ProgressBar` for its bars. Home is Overview: four tiles that each show a figure and open its page (checklist items checked, open issues, the Next Up battery with the one In Robot under it, and the next match or the last archive). With no connection it shows what it last knew. A battery's state takes the shared status colors: Next Up green, Charging amber, In Robot blue, Broken red. `ProgressBar` takes `done`, which turns it green. Resetting one checklist asks first, an open issue's Resolve button is always shown, and the checklist editor's rows have one Edit button | 5 | [#190](https://github.com/midtownrobotics/Gearbox/pull/190) |
| Shop's pages are built from the shared parts, and its own color names (`crimson`, `ink`, `paper`, `steel`, `mist`) are gone: `Page` on every page, `Card`, `Button`, `Field` and `inputClass`, the banners, `Dialog` for its pop-ups, `Chip` for the Filters button. Errors, delete buttons and an overloaded machine are red where they were the team's color. Home is Overview: four tiles that each show a figure and open its page (parts in progress, ready to start, complete, and released parts waiting on Ingest). Members who aren't admins no longer see the parts of Admin that only work for an admin. Shop's ten browser pop-ups ask in the page. The version footer is gone | 6, and Shop's part of 7 | [#193](https://github.com/midtownrobotics/Gearbox/pull/193) |
| No app outside Scouting opens a browser pop-up. Orders' eight confirms and three prompts, Skill Tree's three confirms and Platform's one ask in the page; an alert in Pit that nobody could reach is an error the page shows. Orders' two hand copies of `Dialog` (Replace item, Mark received) are the shared one, which takes a `size` for their widths | 7 | This PR |

## Decisions

Erik chose these on 12 October 2026. They are settled; don't reopen them in a pull request.

| Question | Decision |
| --- | --- |
| A home page for every app? | No. Each app opens on its most-used page. Pit Home becomes an overview with live figures. No page exists only to list other pages |
| Where the shared parts live | `@g3/ui` |
| Page title | 36px display type, regular weight (`text-4xl`, no `font-bold`) |
| The name of an app's settings page | **Admin**, last in the bar. The survey recommended Settings; Admin was chosen |
| A chosen filter | Near-black (`bg-secondary-900 text-white`), not the team's color |
| Errors and deleting | Red in every app, never the team's color |
| Icons | One set, Lucide, for controls, through `@g3/ui` |
| Wording | "Sign in" and "Sign out" |
| Scouting | Restyled with its team-scoping step (Phase 3). Its name is Scouting everywhere |

## The design language

What a page follows. The first group restates the decisions above as rules. The second comes from the survey's recommendations, which were read but not picked one by one; follow them, and say so in the pull request if one doesn't fit a page.

### Decided

- **First page.** An app's address opens the first page in its bar. That page either does the app's main job (Orders' Requests, the Inventory table) or shows live figures that each link to their page (Skill Tree's Overview, Edge's Network). A summary page is called Overview. Shop's Home becomes Overview and ID's Dash becomes Account.
- **Page parts.** Pages are built from the parts in `@g3/ui` (below). An app doesn't keep its own `Page`, `Card`, `Button`, field or banner.
- **Title.** The shared `Page` draws it. A page's title is its bar label, word for word. Two pages are left out on purpose: Portal's home (the team's front door, titled with the team's name) and Pit's Monitor (a wall display that hides the bar, so its header names the team).
- **Admin.** The page for an app's own settings is called Admin and is the last item in the bar.
- **Filters.** A chosen filter chip is near-black. The team's color is for the page's main action.
- **Red means a problem.** An error, a delete or danger button, a "no" status, an overdue or over-budget mark: all red (`ErrorBanner`, `Button variant="danger"`, `tones.danger`, `text-red-700`). The team's color (`primary-*`) never carries that meaning, because a team can choose any color.
- **Icons.** Controls use Lucide icons, exported from `@g3/ui` so every app draws the same close, back, delete and edit marks. Emoji stay only where they are a team's own content (Skill Tree's tree icons).
- **Sign in, Sign out.** Not "Log in" or "Log Out".

### From the survey

- **Width.** `Page width`: `narrow` (672px) for forms and settings, the default (1024px), `wide` (1280px) for a table or tree, `full` only for a sheet-like table (Orders' Requests and Wishlist today).
- **Shell.** The app's shell is `<div className="flex min-h-screen flex-col bg-page">` around the top bar and the routes, and `Page` fills what the bar leaves. Don't give a page `min-h-screen` under the bar: it makes every page scroll by the bar's height.
- **Buttons.** `Button`: `primary` for the page's main action, `secondary` for the rest, `danger` for one that deletes. Hover goes darker. No "+" before a label. Sentence case for button labels ("New list", "Add an entry"); Title Case is for page names.
- **Forms.** `Field` with `inputClass`. A setting that takes effect at once is a `Toggle`; a checkbox is for a form with a Save button. A save is confirmed with `SuccessBanner`.
- **Messages.** Errors in `ErrorBanner`, never the browser's `alert`. Loading is the word "Loading…" with the one-character ellipsis (`Loading`, `PageLoading`). An empty list is a muted sentence saying what belongs there and how to add the first one. A page the member can't use shows its title and one sentence on who can ("Only mentors can edit the skill trees.").
- **Asking first.** `ConfirmButton`, in the page, never `window.confirm`. Its second button names what stays ("Keep it"). Where a reason must be typed, use a `Dialog`, not `window.prompt`.
- **Pop-ups.** `Dialog`. It closes by its ✕, Escape and its own buttons, and not by a click outside, since most hold a form.
- **Lists.** A table when rows have columns to compare; stacked cards for a short list of things you open. Search first, filters under it, both kept in the page's address.
- **Status.** `Badge`, with a label and, where it helps, an icon, so it never reads by color alone. Its colors are one of `tones` (`neutral`, `info`, `success`, `warning`, `danger`): emerald for done, amber for waiting, sky for information, red for a problem.
- **The way back.** A link that names where it goes: "← All requests".
- **The bar** lists only pages the member can use.
- **Delete or Remove.** Delete when it is gone for good. Remove when it only leaves a list and still exists.
- **Dates.** A named month ("Oct 7, 2026"), in the viewer's own language. Orders, Inventory and Edge each have their own helper for it; one shared helper should replace them.

The repo's standing rules still apply to every page: the color rules, short page text and US English in `CLAUDE.md`.

## The shared parts

They are in `packages/ui/src/components/` and exported from `@g3/ui`.

| Part | Use |
| --- | --- |
| `Page` | Every page: `title`, optional `description`, `actions` (buttons at the right of the title), `width` |
| `PageLoading` | The whole screen while the app finds out who is signed in |
| `Card`, `Stat` | A panel, with a small heading when it has a `title`; one figure with its label |
| `Button`, `buttonClass` | `variant`: `primary`, `secondary`, `danger`. `size="sm"` inside a row, `"lg"` on a touch screen. Takes every `<button>` prop; an icon before its label sits in line. `buttonClass(variant, size)` is the same look for an `<a>` or a router `Link` |
| `ConfirmButton`, `ConfirmQuestion` | A danger button that asks its `question` in the page before it acts. Its question takes a line of its own, so the row it sits in has to wrap (`flex flex-wrap`). `ConfirmQuestion` is the question alone, for a switch or anything else that needs a yes; its `keepLabel` names what stays ("Keep it on") |
| `Field`, `inputClass` | A label, a control and a hint; the class for an `<input>`, `<select>` or `<textarea>` |
| `ErrorBanner`, `SuccessBanner`, `Loading` | Messages |
| `Dialog` | A pop-up. `size` is how wide it may grow: `md` (a question; the default), `xl`, `2xl` (`wide` means this) or `3xl` (a form with columns) |
| `Toggle`, `Switch` | An on/off switch with a label and description; the switch alone, for a row that already says what it switches |
| `Chip` | One choice in a row of filters; the chosen one is near-black |
| `Badge`, `tones` | A status label and the colors that mean something |
| `ProgressBar` | A thin bar filled to a percent; `done` turns it green. A thicker one overrides the height (`className="!h-2"`) |
| `focusRing` | The focus outline, for a control an app has to write by hand |

Rules for the parts:

- **Add to them; don't copy them.** A part two apps need goes in `@g3/ui`. A part only one app needs stays in that app, built from the shared ones (Orders' `StatusBadge` wraps `Badge`).
- **Tailwind finds their classes through `@source "./components"`** in `packages/ui/src/index.css`. Write class names as whole literal strings, as everywhere else; a name built from pieces is never generated.
- **Dark mode comes for free** if a part is written with light-mode classes: `secondary-*`, `bg-surface`, `bg-inset`, `primary-*` with `text-on-primary` on a solid fill, and for text in a color that means something the 600 to 950 shades (`text-red-700`, `text-emerald-800`), which `theme-palette.css` lightens in dark mode.
- **Changesets ignore `@g3/ui`.** A change to a part is recorded against each app whose pages it changes.
- **Not there yet:** an empty state, a back link, a date helper, the Lucide icons. Add each with the first step that needs it. Orders' `ConfirmDialog` and `AnswerDialog` (step 7) belong here too once a second app wants one. Orders' and Skill Tree's filter pills and Edge's date-range chips are the same shape as `Chip` and can become it when those pages are next opened.

## Moving an app onto the parts

What step 1 did for four apps, as a recipe for the rest:

1. Wrap the shell: the top bar and the routes inside `<div className="flex min-h-screen flex-col bg-page">`.
2. Replace each page's hand-written `<main>`, width wrapper and `<h1>` with `Page`. Pick its `width`; put header buttons in `actions`.
3. Replace cards, buttons, inputs and banners with the parts. Keep the behavior; change only how it is drawn.
4. Replace the app's own color names with the shared ones (Shop's `ink`, `paper`, `steel`, `crimson`; Pit's `gray-*`).
5. Sweep for the team's color used to mean a problem (`text-primary-700`, `bg-primary-50` with `border-primary-200` around an error) and make it red. Leave it where it means "selected" or is a link.
6. Delete what the app no longer uses.

Then check: `pnpm biome check --write`, `pnpm --filter @g3/<app> typecheck`, `pnpm --filter @g3/<app> build`, and look at the pages in both themes through the dev gateway (`pnpm dev`, then `http://1648-<app>.gearbox.localhost:8796`). Step 1 was checked by type-check, lint and build only; nobody looked at it in a browser before it was opened for review. Step 5's pages were looked at in a local browser with made-up answers standing in for the worker (so without signing in), in both themes and at a phone's width.

## Steps

One step, or one app of a step, per pull request. Sizes are rough, from line counts on 11 October.

### 1. Shared parts in `@g3/ui` (done)

See "What landed".

### 2. Fixes that need no decision (done)

See "What landed" for what it did. It is listed here for what it decided and what it passed on.

- **Admin.** Orders and Inventory call the page Admin, at `/admin`. Their old `/settings` address sends people on, keeping whatever followed it (Share-A-Cart's sign-in returns to Orders' page with a result in the address). The plugin folders are still named `settings`, and the workers' `/settings` routes didn't change: only the page moved.
- **Names chosen where the rule left a choice.** ID's Dash is Account. ID's admin page for Attendance is "Attendance" in the bar and as its title (it was "Settings" opening "Attendance Settings"). Portal's "Manage apps" and its page are both "Manage Apps".
- **Passed on:**
  - Shop's Admin page turned out to be for every member: the Actions Log, Shop Settings and Kiosk Mode sections work for anyone signed in. Only its Onshape, Slack and Data Management sections, and the Slack buttons in its header, need an admin. So the page stays in the bar for everyone, and step 6 hides those sections from members who can't use them.
  - ID's Users list still asks before deleting a user with a browser box (step 7).
  - Scouting's Admin isn't last in its bar yet (step 8).
  - There is still no shared date helper: Orders' and Inventory's own helpers now use the viewer's language, and that was all the bug needed.

### 3. Edge onto the full set (done)

See "What landed". What it settled, for the steps after it:

- A button beside a field is the default size, so the two are the same height. A button in a list row or a card's corner is `size="sm"`.
- A field narrower than its row overrides the shared class's full width with `!`: `${inputClass} !w-48`, or `!w-auto` for a `<select>`.
- Edge's quiet text buttons ("Check again", "Revoke") became `secondary`, which has an outline. Its link-style actions inside a sentence ("Rename", "Edit") and its filter chips stayed as they were.

### 4. ID and Portal onto the shared frame (done)

See "What landed". What it settled, and what it left:

- **Widths.** Settings-like pages are `narrow`: ID's Account, Users, a user, Kiosk Devices and Attendance, and Portal's Manage Apps, Sign-in and Integrations. Portal's Appearance is the default width and ID's Leaderboard is `wide`.
- **A card's heading is the shared small one.** Both apps had larger section headings (`text-xl`, `text-lg font-bold`); they are `Card title` now.
- **The sign-in and kiosk screens keep their shape**: a narrow column centered on the screen, with no `Page`. They take the shared title size, buttons, fields and red errors. Kiosk screens use `size="lg"`.
- **Approve is the primary button and Reject is `danger`.** Approve was green.
- **Left as they are:** Portal's home grid and its two large front-door buttons; the kiosk's PIN keypad; the spinner that replaces an icon inside ID's small Attendance buttons while they work; the attendance reports' own grid and charts; Portal's joined buttons for the button text color, which show the team's color on purpose.

### 5. Pit, with its Overview (done)

See "What landed". What it settled, and what it left:

- **Overview is first in the bar**, at Pit's own address (`/`). The survey said both "take Home out of the bar" and drew Overview in it; the rule (an app opens on the first page in its bar) and the sketch won, and Erik confirmed it on 12 October.
- **The Overview's tiles** (`apps/pit/src/plugins/overview/`):
  - Checklists: items checked, with a bar.
  - Open issues: how many, and how many are new since the last archive. It opens Checklists at its issues.
  - Batteries: the Next Up battery is the main value, with its voltage; the In Robot one is under it, with how long it has been in. Both are labeled. Erik chose this on 12 October: the next battery is what the crew needs at a glance.
  - Next match, with the last archive under it. Away from an event, or when nobody can say the next match, this tile is the last archive and opens Logs.
- **No connection.** Each tile's figure is asked for on its own and keeps what it last had; one nobody has answered shows "—", never an error. `prefetchAll` asks for the issues and archives as the app opens, so their saved copies are there whichever page was opened first. A visitor is asked to sign in only once the worker has said nobody is signed in (`signedOut` in `shared/use-auth.ts`), not when it couldn't be reached.
- **Widths.** Every page is `narrow`. The Monitor keeps the full width and its own header.
- **Sizes.** `size="lg"` only for "Archive and reset" and the pop-up's Archive button, which were large before. The rest are the default size, which is no smaller than they were.
- **A battery's state colors are the shared tones** (`STATE_TONES` in `apps/pit/src/shared/battery-display.tsx`), which Erik chose on 12 October: Next Up green (ready), Charging amber (waiting), In Robot blue (in use), Idle gray, Broken red (a problem). They were In Robot red, Charging blue and Broken amber, which read as a problem where there was none.
- **A chosen option is near-black**: a battery's state (`Chip`) and the Match, Practice, Other choice in the Archive pop-up. The team's color is the main action.
- **Behavior that changed to fit the rules:**
  - Resetting one checklist asks first (`ConfirmButton`). It unchecked every item on one tap.
  - An open issue's Resolve button is always shown. It only appeared on hover, which a tablet doesn't have.
  - The checklist editor has a Checklist card (Name, Description, Save) and one Edit button per row, which opens the row's name, description and Delete. It had a rename mark, a delete mark and a click on the description.
  - Button labels are sentence case, so "Archive and Reset" is "Archive and reset".
- **Left as they are:**
  - The Monitor's layout, and its red, amber and green for On Deck, Now Queuing and Queuing Soon: a wall display read from across the pit.
  - The reorder arrows (▲ ▼) and the → on a row. They wait for the Lucide icons, which no step has added yet.
  - The installed app's splash colors (the `manifest` in `apps/pit/vite.config.ts`), which are still the dark ones.

### 6. Shop (done)

See "What landed". What it settled, and what it left:

- **Colors.** Shop has no color names of its own: `apps/shop/src/styles.css` is the two imports every app has. Each `crimson` was read and became the team's color (`primary-*`) or red. Red: error messages, Delete and Make obsolete, a failed print, a required field's mark, an overloaded machine on the Shop Floor. A part number that already exists is amber, since it is something to check and not an error.
- **Overview** (`apps/shop/src/plugins/overview/`) is Shop's first page, at its own address. Four tiles, each a figure that opens its page: In progress and Ready to start (Shop Floor; the second opens the busiest machine), Complete (Parts), and To ingest (Ingest). The greeting, the date and the three links to other pages are gone: no page exists only to list pages. A kiosk never showed Home (it opens its machine's queue), so the machine section it had was never drawn and went too.
- **Widths.** Default for most pages. `narrow` for Leaderboard, Add Part, one part on Ingest and uploading a drawing. `wide` for Files and Onshape. `full` for Ingest's table and a drawing.
- **Titles.** Ingest's page was titled "Ingest Parts"; it is "Ingest", like its bar label. The Shop Floor's title was a menu of machines; the title is now the machine's name (or "Shop Floor") and the menu is beside it.
- **Admin.** A member who isn't an admin doesn't see Data Management, Onshape Configuration, Slack Configuration or the two Slack buttons. Deleting obsolete instances says so in a green banner. The Slack channels' "saved" message stays until the next change (it vanished after three seconds).
- **Pop-ups are `Dialog`:** the file picker, Scan, the two Send back choices, "Parts come from Onshape", the kiosk's "Still there?" and leaving kiosk mode. They close by ✕, Escape and their buttons, not by a click outside (the file picker used to).
- **Browser pop-ups, all ten:**
  - Seven confirms. Deleting obsolete instances, making a part obsolete and removing a batch's file are `ConfirmButton`. So is the one question three Delete buttons shared (a drawing, and a file in two places). Posting a Slack summary asks under its buttons. Ingest's two asked before leaving with changes that aren't ingested: a link now asks in a `Dialog`, and the browser's Back button no longer asks, since the question couldn't stop the page leaving (see the bugs table).
  - Two prompts: "Stage some" and leaving kiosk mode are a `Dialog` with a field.
  - One alert: a bad count is an error in that dialog.
- **Also asks now:** deleting a part that is waiting on Ingest, which took one click.
- **Button labels are sentence case** ("Add a part", "Mark as complete", "Ingest all"), with no "+" or arrow before them.
- **Left as they are:**
  - The shop view (a part over the whole screen at its machine) keeps its own large buttons (`shopButton` in `plugins/board/shop-view.tsx`): they grow with the screen, which `size="lg"` doesn't. It and the part card are full-screen sheets, and Ingest's process picker is a side panel: their own shapes.
  - The green "Mark as complete" buttons. `Button` has no variant for "done"; add one to `@g3/ui` if another app needs it.
  - Small controls inside table rows (Ingest's quantity and process menus, the files' count box) keep their compact size, with the shared colors.
  - Admin's sections open and close; `Card` doesn't. The Leaderboard's medal colors.
  - The bar's wordmark still comes from the site's team (`wordmark("Shop")` in `shared/nav-bar.tsx`), not the page's team.

### 7. Browser pop-ups (done)

See "What landed". Edge's went with step 3, ID's with step 4 and Shop's with step 6; this is how the rest were done, as the pattern for Scouting's:

- **A delete with room to ask in its own row is `ConfirmButton`:** Orders' catalog part, list and Share-A-Cart connection, removing a wishlist item from its page, and Skill Tree's tree, category and skill. The row has to wrap (`flex flex-wrap`).
- **Canceling a request** asks in the row with `ConfirmQuestion`, since Cancel request sits among other buttons.
- **A button in a table row, or a yes that isn't a delete, asks in a pop-up:** `ConfirmDialog` in `apps/orders/src/shared/ask.tsx` (promoting a wishlist item, removing one from the Wishlist table, removing a vendor credit, placing an order).
- **An answer that has to be typed is a pop-up with one field:** `AnswerDialog` in the same file (why a request is denied, why a line is taken off an order, a credit's new balance). A bad answer is an error in the pop-up.
- Both are Orders' own, built from `Dialog`. Move them to `@g3/ui` when a second app needs one.
- **Platform's console** has its own shell and no shared parts, so removing an operator asks in the row with the shell's own buttons.
- **Pit's** label maker called `alert` when nothing was chosen. Its button is disabled then, so nobody saw it; it now raises an error, which the page shows.
- **What changed besides where the question is:** Share-A-Cart's Disconnect and the wishlist page's "Remove from wishlist" are red buttons, since both now ask as deletes do. Denying from the Approvals queue and taking a line off an order show what is about to happen above the box.

### 8. Scouting (largest)

Do it with Scouting's Phase 3 step in `roadmap.md`, so its pages are opened once.

- Its own stylesheet of 8,149 lines, with four sets of base colors stacked on one another, and about 6,000 lines of pages in eight files.
- Its pages have no addresses: the page is a state variable in `App.tsx`. Give each page an address with the router the other apps use, so links, reload and Back work.
- 24 browser pop-ups.
- "Other Tools" is a page that only lists three other pages. Under the first-page rule it goes: put Auto Library, Tier Lists and Field Maps in the bar, grouped.
- Its Admin moves to the end of the bar.

## Bugs found

From reading the code on 11 October. None was confirmed in a running app, and one (Shop's Admin) turned out not to be a bug as written, so check each before fixing it.

| Where | What | Status |
| --- | --- | --- |
| Orders, Inventory, Skill Tree, Edge | Errors and Delete took the team's color | Fixed in step 1 |
| Scouting | Called Strategy in its bar and Scouting on Portal and in the All Apps menu | Fixed in step 1 |
| Shop | Errors (`ErrorBanner` in `shared/ui.tsx`) and danger buttons took the team's color (`crimson`) | Fixed in step 6 |
| Pit | Card headings in `text-gray-200` on the card couldn't be read in either theme: "Event" and "Pit Monitor Display" on its Admin page, "New Checklist" and "Items" in Edit Checklists | Fixed in step 2 |
| Pit, Shop, Portal | Every page was `min-h-screen` under the 56px bar, so even an empty page scrolled | Fixed in step 2, and in step 6 for Shop's pages while they load |
| Pit | Errors were a dark red block in light mode (`bg-red-950`, five places); checklist bars were red until complete | Fixed in step 2 |
| Shop | Admin is in the bar and on Home for every member | Not a bug as first written: most of the page is for every member. Four parts of it need an admin, and step 6 hides them from everyone else |
| ID | Revoking a kiosk took one click on a trash icon, with no question | Fixed in step 2 |
| ID | Deleting a user asked with a browser box on the Users list and in the page on the user's own page | Fixed in step 4: both ask in the page |
| Pit | Two pages were titled "Checklists": the one you run and the one you edit | Fixed in step 2: the second is Edit Checklists |
| Orders, Inventory | Dates were always in US English | Fixed in step 2. Prices are still formatted the US way (`Intl.NumberFormat("en-US", …)`), which wasn't part of this |
| Pit, Shop | `lucide-react` and `react-icons` were installed and never imported | Fixed in step 2 |
| Inventory | The table's search and filters reset on a reload or Back | Fixed in step 2: they are in the address (`q`, `status`, `location`, `robot`). An entry's "← All entries" link still opens the table without them |
| Shop | Its Admin page shows "Obsolete instances deleted successfully" in the error banner | Fixed in step 6 |
| Shop | Six error and warning messages used classes that don't exist (`bg-crimson-50`, `border-crimson-200`), so they had no background or border: Admin's Onshape, Slack and summary messages, and three on Ingest | Fixed in step 6 |
| Shop | The drawing viewer (`/part/:partNumber/view`) was a screen tall under the bar, so it always scrolled | Fixed in step 6 |
| Shop | Ingest asked "leave without saving?" on the browser's Back button, but the page had already left, and answering no put the address of the page before in the bar | The question is gone in step 6. Open: Back still loses what was filled in. Not part of a restyle |
| Pit | An open issue's Resolve mark only showed on hover, so a tablet never showed it | Fixed in step 5 |
| Pit | The offline notice had no background (`bg-gray-1000` isn't a class) | Fixed in step 5 |
| Pit | An item checked with no connection looks checked but is never saved, and is unchecked again on a reload: `toggle` in `checklist-runner-page.tsx` doesn't handle a request that never reaches the worker | Open. Not part of a restyle |

## How to work on this

- Branch off `main`; never change files on `main`. A merge to `main` goes live.
- One step, or one app of a step, per pull request, with a changeset naming each app whose pages change: **patch** for a restyle or a rename, **minor** for a new page such as Pit's Overview, **major** only if an address stops working without a redirect.
- Don't change what an app does while restyling it. If a page needs a behavior change to fit the rules (an address for a filter, a question before a delete), say so in the pull request.
- The rules in `CLAUDE.md` apply: no fixed colors except for meaning, `text-on-primary` on a fill in the team's color, short page text, US English, sign-in only through `@g3/auth`.
- Update the Progress table and "What landed" here in the same pull request. If a step turns out wrong, fix this file and say so in the pull request.

## Out of scope

- **Attendance.** A wall kiosk and a one-tap phone screen, with no top bar. It takes the shared wording and nothing else.
- **The Platform site.** Its public pages belong to no team and keep the built-in colors. The operators' console takes in-page questions (step 7) and the date helper, and otherwise stays as it is.
