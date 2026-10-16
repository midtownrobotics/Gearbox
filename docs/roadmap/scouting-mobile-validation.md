# Scouting mobile validation

Validated locally on 16 October 2026 against the Scouting Vite frontend in Chrome, driven by Playwright. Browser fixtures supplied populated API responses; drawing used the real canvas editors and field asset, and personal maps used real IndexedDB storage. These checks exercise the frontend and outgoing uploads, not a deployed backend or physical iOS/Android devices.

## Coverage

- All eight pages: Scouting Forms, Analysis, Service Tickets, Auto Library, Tier Lists, Field Maps, Match Predictions and Admin.
- 160 page and editor captures across light/dark themes at widths 320, 390, 768 and 1440: populated and long content, form designer, pit form, manual schedule editor, reports, match history, comparison, auto path views, auto creation and preview, prediction slip and standings. No page overflow, clipped text or browser exceptions.
- The three canvas editors (form field map, personal field map and auto route), in both themes, with mouse-only and actual browser touch events at 320×740, 390×844, 768×1024 and 844×390: 48 editor workflows.
- An additional six editor workflows at 956×440 verify the same controls on wider landscape phones with both mouse and touch input.
- Drawing changes pixels; Undo restores the previous image; Clear restores the field; Undo after Clear restores the drawing; canceled input preserves the prior image. Pixel hashes compare canvas contents rather than PNG encodings.
- Inline/fullscreen transitions preserve both field map drawings and their undo history. Fullscreen covers the viewport, keeps controls reachable, and retains the canvas aspect ratio in portrait and landscape.
- Each mobile drawing button and color target measures at least 44×44 CSS pixels. Undo and Clear remain visible without horizontal scrolling or requiring fullscreen.
- Personal maps save to IndexedDB; report submissions include the drawn field attachment; auto routine uploads include the restored PNG after Clear/Undo. Uploads are intercepted and inspected, with fixture success responses.
- In all three editors, a second finger moving and lifting does not end or overwrite the first stroke; one Undo removes that stroke. Right-click does not draw. All eight links in the mobile menu navigate and close the drawer.

## Reproduce the main regression

1. Open Scouting at a phone width, without fullscreen. In a scouting form's field map, draw a route and select Undo, then draw again and select Clear. Both actions should be labeled and visible, and the field itself should remain intact.
2. Draw again, select Clear, then Undo. The route should return. Repeat in Field Maps and Auto Library → Build an auto entry → Draw an auto.
3. Scroll the scouting form until the map is near the top of the viewport. Its toolbar should stay above the canvas, allowing drawing across the entire field.
4. Enter and exit fullscreen on a field map, then rotate to landscape. The map should retain its proportions and drawing; Undo, Clear and the fullscreen exit should remain reachable.
5. While drawing with one finger, move and lift a second finger. Continue the first stroke and lift it, then select Undo. The whole first stroke should disappear together. Canceling a gesture should restore the drawing that preceded it.
6. Save a personal map and reload; submit a report with a map; save an auto route after Clear/Undo. The saved or uploaded drawing should match the editor.

## Code checks

- `pnpm --filter @g3/scouting typecheck`
- `pnpm --filter @g3/scouting build`
- `pnpm lint:text-fields`
- Biome on the changed TSX files and `git diff --check`.
