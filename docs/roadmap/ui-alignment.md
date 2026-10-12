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
| 2. Fixes that need no decision | Not started | Pit, Shop, ID, Portal, Orders, Inventory | All of it, except Scouting's name (done) |
| 3. Edge onto the full set | Not started | Edge | Its hand-written buttons and inputs |
| 4. ID and Portal onto the shared frame | Not started | ID, Portal | All of it |
| 5. Pit, with its Overview | Not started | Pit | All of it |
| 6. Shop | Not started | Shop | All of it |
| 7. Browser pop-ups | Not started | Orders, Shop, ID, Edge, Skill Tree, Platform | 35 calls |
| 8. Scouting | Not started | Scouting | All of it, with its Phase 3 step in `roadmap.md` |

### What landed

| Change | Step | Pull request |
| --- | --- | --- |
| The page parts moved from each app's `shared/ui.tsx` into `@g3/ui`: `Page`, `PageLoading`, `Card`, `Stat`, `Button`, `ConfirmButton`, `Field`, `inputClass`, `ErrorBanner`, `SuccessBanner`, `Loading`, `Dialog`, `Toggle`, `Badge` with `tones`, `ProgressBar`, `focusRing`. Orders, Inventory, Skill Tree and Edge import them and have no `shared/ui.tsx`. Errors, danger buttons and every other mark of a problem in those four apps are red where they were the team's color. Buttons and inputs show a focus ring. Scouting is called Scouting in its own bar and tab, where it said Strategy | 1, and the name from 2 | This PR |

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
- **Title.** The shared `Page` draws it. A page's title is its bar label, word for word.
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
- **Dates.** A named month ("Oct 7, 2026"), in the viewer's own language. Orders' and Inventory's helpers are fixed to US English today; one shared helper should replace them.

The repo's standing rules still apply to every page: the color rules, short page text and US English in `CLAUDE.md`.

## The shared parts

They are in `packages/ui/src/components/` and exported from `@g3/ui`.

| Part | Use |
| --- | --- |
| `Page` | Every page: `title`, optional `description`, `actions` (buttons at the right of the title), `width` |
| `PageLoading` | The whole screen while the app finds out who is signed in |
| `Card`, `Stat` | A panel, with a small heading when it has a `title`; one figure with its label |
| `Button` | `variant`: `primary`, `secondary`, `danger`. Takes every `<button>` prop |
| `ConfirmButton` | A danger button that asks its `question` in the page before it acts |
| `Field`, `inputClass` | A label, a control and a hint; the class for an `<input>`, `<select>` or `<textarea>` |
| `ErrorBanner`, `SuccessBanner`, `Loading` | Messages |
| `Dialog` | A pop-up; `wide` for a larger one |
| `Toggle` | An on/off switch with a label and description |
| `Badge`, `tones` | A status label and the colors that mean something |
| `ProgressBar` | A thin bar filled to a percent |
| `focusRing` | The focus outline, for a control an app has to write by hand |

Rules for the parts:

- **Add to them; don't copy them.** A part two apps need goes in `@g3/ui`. A part only one app needs stays in that app, built from the shared ones (Orders' `StatusBadge` wraps `Badge`).
- **Tailwind finds their classes through `@source "./components"`** in `packages/ui/src/index.css`. Write class names as whole literal strings, as everywhere else; a name built from pieces is never generated.
- **Dark mode comes for free** if a part is written with light-mode classes: `secondary-*`, `bg-surface`, `bg-inset`, `primary-*` with `text-on-primary` on a solid fill, and for text in a color that means something the 600 to 950 shades (`text-red-700`, `text-emerald-800`), which `theme-palette.css` lightens in dark mode.
- **Changesets ignore `@g3/ui`.** A change to a part is recorded against each app whose pages it changes.
- **Not there yet:** button sizes (small for a row, large for touch), a bare switch without a label (Portal has two copies), filter chips, an empty state, a back link, a date helper, the Lucide icons. Add each with the first step that needs it.

## Moving an app onto the parts

What step 1 did for four apps, as a recipe for the rest:

1. Wrap the shell: the top bar and the routes inside `<div className="flex min-h-screen flex-col bg-page">`.
2. Replace each page's hand-written `<main>`, width wrapper and `<h1>` with `Page`. Pick its `width`; put header buttons in `actions`.
3. Replace cards, buttons, inputs and banners with the parts. Keep the behavior; change only how it is drawn.
4. Replace the app's own color names with the shared ones (Shop's `ink`, `paper`, `steel`, `crimson`; Pit's `gray-*`).
5. Sweep for the team's color used to mean a problem (`text-primary-700`, `bg-primary-50` with `border-primary-200` around an error) and make it red. Leave it where it means "selected" or is a link.
6. Delete what the app no longer uses.

Then check: `pnpm biome check --write`, `pnpm --filter @g3/<app> typecheck`, `pnpm --filter @g3/<app> build`, and look at the pages in both themes through the dev gateway (`pnpm dev`, then `http://1648-<app>.gearbox.localhost:8796`). Step 1 was checked by type-check, lint and build only; nobody looked at it in a browser before it was opened for review.

## Steps

One step, or one app of a step, per pull request. Sizes are rough, from line counts on 11 October.

### 1. Shared parts in `@g3/ui` (done)

See "What landed".

### 2. Fixes that need no decision (small)

The list under "Bugs found" below, and the names:

- **Admin.** Orders and Inventory rename Settings to Admin: the bar label, the page title and the address (`/settings` sends people on to `/admin`, as Shop's does). Update what points there: `page: "/settings"` in `workers/orders/src/manifest.ts`, the Orders entry in Portal's `integrations-page.tsx`, the link in Orders' `ordering-page.tsx`, and `CLAUDE.md`. Mentors who aren't admins use Orders' page too, so they will see a page called Admin; that was accepted. Pit's page title says Settings and becomes Admin. Shop's Admin moves after Leaderboard, to the end of the bar.
- **Sign in.** ID's bar says "Log in", Portal's bar button says "Log in" and Shop's kiosk says "Log Out".
- **Title is the bar label.** Pit: Editor opens "Checklists" (rename both to Edit Checklists), Monitor opens "G3 Pit Monitor". ID: Dash opens "Dashboard", Kiosk Devices opens "Kiosk Management", Settings opens "Attendance Settings". Portal: Manage apps opens "Apps". Edge: Overview opens "Network", Drive opens "Shop Drive".

### 3. Edge onto the full set (small)

Edge had the oldest copy of the parts, with no `Button` or `Field`, so it has about 40 hand-written buttons and its own input classes (`const input = "border border-secondary-300 rounded-lg px-2 py-1 text-sm"` in `controls-page.tsx` is one). Replace them with `Button` and `inputClass`. Its three `window.confirm` calls (the box key, a blocklist, a printer) become `ConfirmButton` here.

### 4. ID and Portal onto the shared frame (medium)

Both already use the shared colors, written out on each page, about 6,300 lines between them.

- Titles are 24px to 48px bold today; `Page` makes them one size. Both use a line under the title: that is `Page`'s `description`.
- Portal's two switch copies (`plugins/admin/switch.tsx` and one inline in `apps-page.tsx`) become one bare switch in `@g3/ui`, which `Toggle` should then be built on.
- ID uses a spinner for loading and `alert` for five errors; both go.
- ID's filter buttons on Users are the team's color when chosen and become near-black chips. Keep their counts.
- ID's Dash becomes Account.
- The sign-in, kiosk and pending pages are narrow, centered cards. Keep that shape (`width="narrow"`); they are not ordinary pages.
- Portal's home grid is the team's front door and keeps its own layout.

### 5. Pit, with its Overview (medium, or large with the overview)

Pit was written for a screen that was always dark, and about 4,400 lines still carry it.

- `text-gray-*` and `border-gray-*` throughout (236 and 55 uses): use `secondary-*`.
- `bg-gray-700 text-gray-200` buttons are `Button variant="secondary"`. `bg-red-950 text-red-400 border-red-800` blocks are `ErrorBanner`. `text-green-400` and `bg-green-900` are the `success` tone. `yellow-*` is `amber-*`.
- Checklist progress bars are `bg-red-500` until complete: use `ProgressBar` (the team's color) and green only when done.
- Its pages are 672px wide (`width="narrow"`), and its targets are large for a pit tablet. Add the large button size to `Button` here.
- **Home becomes Overview.** Take Home out of the bar (the wordmark already opens the first page). Replace the six tiles that repeat the bar with tiles that each carry a figure the app already has and open its page: checklist items checked since the last archive, open issues, batteries, the next match (`GET /archives/next-match`) and the last archive. Use the shared page title in place of the 60px centered heading and uppercase tagline. Admin stays in the bar only.
- Pit works offline at events (`OfflineBanner`, `prefetchAll`). The Overview has to show what it last knew when offline, not an error.

### 6. Shop (large)

About 10,000 lines of pages, the largest Tailwind app. It looks close to the majority already; the work is in the code.

- Its color names in `apps/shop/src/styles.css` map onto the shared ones: `crimson` is `primary-500` (`crimson-dark` `primary-600`, `crimson-tint` `primary-50`), `ink` is `secondary-900`, `paper` is `surface`, `steel-dark` is `secondary-500`, `steel` is a lighter muted gray near `secondary-400`, `steel-tint` is `inset`, `mist` is `page`. Check each in both themes; the mixes aren't exact.
- Its titles already match (`font-display text-4xl`), so `Page` changes nothing visible there. Widths vary by page from 672px to full; pick `Page`'s nearest.
- Nine overlays with four backdrop shades become `Dialog`, except the two full-screen sheets and the Ingest side panel, which are their own shapes.
- Home becomes Overview.
- Its bar has no way to hide a page by role (`PluginNavItem` has only `requiresAuth`): add one, and hide Admin from members who can't use it.
- Kiosk mode makes controls larger (`touch ? "px-5 py-3" : "px-4 py-2"`): that is `Button`'s large size.
- Drop `VersionFooter`: every app shows its version on the wordmark's tooltip and in the menu.

### 7. Browser pop-ups (spread across the steps)

Outside Scouting there were 35: Orders 8 confirm and 3 prompt, Shop 7 confirm, 2 prompt and 1 alert, ID 2 confirm and 5 alert, Edge 3 confirm, Skill Tree 3 confirm, Platform 1 confirm. Replace each app's when the app is open for its own step. Orders and Skill Tree have no restyle step, so their pop-ups get a pull request of their own.

- A confirm becomes `ConfirmButton`.
- A prompt (the reason a request is denied, a vendor credit's amount, a quantity on Shop's floor) becomes a small `Dialog` with a field.
- An alert becomes `ErrorBanner`.
- Orders has two hand copies of `Dialog` (`replace-item.tsx`, `receive-dialog.tsx`) at their own widths. Give `Dialog` the widths they need and use it.

### 8. Scouting (largest)

Do it with Scouting's Phase 3 step in `roadmap.md`, so its pages are opened once.

- Its own stylesheet of 8,149 lines, with four sets of base colors stacked on one another, and about 6,000 lines of pages in eight files.
- Its pages have no addresses: the page is a state variable in `App.tsx`. Give each page an address with the router the other apps use, so links, reload and Back work.
- 24 browser pop-ups.
- "Other Tools" is a page that only lists three other pages. Under the first-page rule it goes: put Auto Library, Tier Lists and Field Maps in the bar, grouped.
- Its Admin moves to the end of the bar.

## Bugs found

From reading the code on 11 October. None was confirmed in a running app; check each before fixing it.

| Where | What | Status |
| --- | --- | --- |
| Orders, Inventory, Skill Tree, Edge | Errors and Delete took the team's color | Fixed in step 1 |
| Scouting | Called Strategy in its bar and Scouting on Portal and in the All Apps menu | Fixed in step 1 |
| Shop | Errors (`ErrorBanner` in `shared/ui.tsx`) and danger buttons take the team's color (`crimson`) | Open, step 6 |
| Pit | Card headings in `text-gray-200` on the card can't be read in either theme: "Event" and "Pit Monitor Display" on its Admin page, "New Checklist" in the Editor | Open |
| Pit, Shop, Portal | Every page is `min-h-screen` under the 56px bar, so even an empty page scrolls | Open |
| Pit | Errors are a dark red block in light mode (`bg-red-950`, five places); checklist bars are red until complete | Open |
| Shop | Admin is in the bar and on Home for every member | Open |
| ID | Revoking a kiosk takes one click on a trash icon, with no question (`admin-kiosk-page.tsx`). Deleting a user asks with a browser box on the Users list and in the page on the user's own page | Open |
| Pit | Two pages are titled "Checklists": the one you run and the one you edit | Open |
| Orders, Inventory | Dates are always in US English (`toLocaleDateString("en-US", …)` in `shared/format.ts`) | Open |
| Pit, Shop | `lucide-react` and `react-icons` are installed and never imported | Open |
| Inventory | The table's search and filters are component state, so a reload or Back resets them. Orders keeps the same ones in the address | Open |

## How to work on this

- Branch off `main`; never change files on `main`. A merge to `main` goes live.
- One step, or one app of a step, per pull request, with a changeset naming each app whose pages change: **patch** for a restyle or a rename, **minor** for a new page such as Pit's Overview, **major** only if an address stops working without a redirect.
- Don't change what an app does while restyling it. If a page needs a behavior change to fit the rules (an address for a filter, a question before a delete), say so in the pull request.
- The rules in `CLAUDE.md` apply: no fixed colors except for meaning, `text-on-primary` on a fill in the team's color, short page text, US English, sign-in only through `@g3/auth`.
- Update the Progress table and "What landed" here in the same pull request. If a step turns out wrong, fix this file and say so in the pull request.

## Out of scope

- **Attendance.** A wall kiosk and a one-tap phone screen, with no top bar. It takes the shared wording and nothing else.
- **The Platform site.** Its public pages belong to no team and keep the built-in colors. The operators' console takes in-page questions (step 7) and the date helper, and otherwise stays as it is.
