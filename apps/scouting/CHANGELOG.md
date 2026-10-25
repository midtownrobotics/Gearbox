# @g3/scouting

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
