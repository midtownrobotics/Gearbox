# Scouting UI validation

Reviewed 13 October 2026 on gearbox-scouting-changes. Browser checks used Chrome against the local frontend, with controlled API fixtures for populated, empty, unavailable and signed-out states. No production data was changed.

## Coverage

| Page | Views checked |
| --- | --- |
| Scouting Forms | Match and pit entry, counters, sliders, single and multiple choices, notes, field drawing, form editor and slider settings, full workspace and fullscreen map |
| Analysis | Summary metrics, expanded reports, long notes and labels, team comments, match history, autonomous paths and image viewer, comparison |
| Service Tickets | Active and closed layouts, helper management, claim confirmation and closure comment dialog |
| Auto Library | Populated and empty library, long routine names and steps, import form, drawn-route form and image viewer |
| Tier Lists | Populated and empty lists, long entries including unbroken names, tier names, colors and remove controls |
| Field Maps | Drawing workspace, saved maps with long names and notes, sharing controls and empty state |
| Match Predictions / Scouting Points | Match choices, single and combined picks, points entry, history badges, standings with long names, loading and error title consistency |
| Admin | Engagement settings, event configuration, manual schedule editing and CSV fields, strategy leads, presence and announcements |

- 160 populated page/view combinations: light and dark at 320, 390, 768 and 1440 pixels wide. No detected page overflow, clipped visible text or browser errors after fixes. Screen-reader-only text is excluded from the clipping check.
- 36 additional fullscreen, dialog, image-viewer and combined-pick views: both themes at 390 x 900, 844 x 390 and 1440 x 1000.
- 52 empty, API error, signed-out and initial loading views: both themes at phone and desktop widths.
- 16 closed-ticket, team-comment, points-only and points-error views, plus 8 long-announcement layouts.
- Workflow regression: delete cancellation and confirmation; closure comments; fullscreen and Escape; routed navigation, reload and Back; member access restrictions; counters, notes and a drawn field map in the report submission payload.

## Fixes from the review

- Predictions now use the team theme for cards and readable text. Responsive columns and the sidebar no longer inherit the old mobile navigation drawer's positioning. Standings show each person's balances and labels in a compact mobile row; history uses shared semantic status badges.
- Tier rows stack on phones and long entries wrap. Slider settings keep each label above its input. Long analysis metric labels and card titles no longer truncate.
- Form field canvases stay inside their column at tablet widths, and field markings retain a dark backdrop. Fullscreen workspaces cover the navbar. Prompts focus the input and prevent background scrolling while open. Long announcements wrap and stay below the navbar.
- Helper text, placeholders, metadata and form labels use consistent body type. Scouting Forms explicitly shows loading, failure and empty states. Predictions keep their page name during loading and failures.

Validation also includes the Scouting TypeScript check, production build, Biome check and git diff whitespace check. This is a visual and interaction audit of the listed states; the separate team-isolation and backend workflow tests are documented in scouting-tenancy.md.

Service Tickets follow-up: rebuilt ticket and helper forms with labeled responsive grids, multiline descriptions, wrapping ticket cards and semantic status badges. Explicitly check every form control stays at least 120 pixels wide at 320, 390, 768, 1024 and 1440 pixels in both themes; earlier overflow checks alone missed compressed controls.

Service Tickets visual alignment: ticket and empty-state panels use the same shared Card as Inventory and Pit. Its standalone Page now uses shared padding and spacing directly, without the legacy `.page` rules.

Predictions polish: 24 populated match, combined-pick and standings views passed in both themes at 320, 390, 768 and 1440 pixels. Combined pick submission preserves its two-leg payload and stake. Shared summary stats and chips replace the old balance pill and tabs; alliance labels use readable text with colored markers.

Copy cleanup: removed redundant helper text and missing-description placeholders across Scouting. User-authored notes and descriptions, input-format instructions, empty states, errors and consequences remain. Prediction rules are available under How picks work rather than a permanent paragraph.

After team migration: 32 real local page views passed across all eight routes in light/dark at phone and desktop widths. A fresh local team receives two empty forms, no other team's library or tickets, and disabled engagement; the temporary QA team was removed.
