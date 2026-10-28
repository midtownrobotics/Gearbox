# @g3/scouting

## 3.1.0

### Minor Changes

- 51914ee: Add match summaries with team report drilldown, newest-first Stats without highlights, explicit no/minimal Auto movement and Yes/No radio choices. Form managers can name, create and activate multiple forms; scouts retain drafts when switching. List teams needing pit scouting and let service tickets select and filter multiple issue categories.
- 72a2f11: Show missing match reports by robot and active form in the admin Competition overview. Distinguish local draft saves, partial or failed storage, submitting and server-confirmed reports, including pit drafts and warnings that survive reloads. Balance new robot assignments using current participation and submitted work, interleave alliances and rotate ties each match while preserving existing valid assignments.
- 7665b2b: Let form managers hide or show each form directly from its card. Scouts only receive visible forms, with their list refreshing automatically; hidden forms and historical reports remain available to managers. Visibility changes preserve the form definition and enforce management permissions and team isolation.

### Patch Changes

- 51914ee: Analysis Auto path now groups drawings by team and then match in match order. Compact expandable rows replace the image wall; opening a match loads its paths, which still open full size. Reports for the same team and match are grouped together, with competitions kept distinct.
- 51914ee: Analysis Compare labels each value with its actual team instead of Team A/B aliases, so values stay identifiable on mobile and while scrolling. Comparison values appear only after both teams have been selected and searched.
- Updated dependencies [754ede0]
- Updated dependencies [dcb9da4]
- Updated dependencies [aa5cd00]
- Updated dependencies [ab9aa57]
- Updated dependencies [72a2f11]
- Updated dependencies [7665b2b]
- Updated dependencies [9667d17]
- Updated dependencies [46b26b4]
- Updated dependencies [a1832e8]
  - @g3/worker-scouting@3.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [05068af]
- Updated dependencies [05068af]
- Updated dependencies [73d2f28]
- Updated dependencies [9006f60]
- Updated dependencies [24cbdaf]
- Updated dependencies [24cbdaf]
  - @g3/worker-scouting@3.0.0

## 2.1.0

### Patch Changes

- f29e1e4: Allow signed-in team members to open Analysis and view their team's reports and drawings. Keep report management restricted to Strategy leads and admins.
- c08efe7: Restore Android touch scrolling across Scouting pages by clipping horizontal overflow without creating nested vertical scroll containers.
- da8964e: Save tier list edits automatically, serialize pending changes, and retry failed saves. Use stable list IDs so retrying a new list does not create duplicates.
- 92ffcea: Allow tier list entries to be dragged left or right within a tier and inserted before or after entries in other tiers.
- 5dd1e13: Reorder whole tiers by dragging their handles with the repository's dnd-kit sorting library, or using Space and arrow keys. Preserve tier contents and autosave the new order.
- 5dd1e13: Add touch-friendly tier entry movement buttons and a tier selector alongside drag-and-drop.

## 2.0.0

### Minor Changes

- 14d9fbd: Make scouting points and match predictions optional in admin settings, off by default. Teams can name their points, choose combined picks and standings separately, and use points without predictions. Replace sportsbook and betting language with match picks and points. Keep existing balances and picks when activities are disabled.
