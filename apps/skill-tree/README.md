# Skill Tree

Tracks the skills each student has learned. Skills are grouped into trees (Safety, Manufacturing,
Design, ...) and categories. A skill opens when the skills it comes after are complete, a category
when the categories before it are, and a tree can wait on another tree.

Built like the other apps: React, React Router and Tailwind v4 with the shared top bar, colors,
fonts and light/dark mode from `@g3/ui`, plugins under `src/plugins/`, and a typed Hono client
for [`workers/skill-tree`](../../workers/skill-tree).

## Who can do what

- **Anyone signed in** sees the trees, the team overview and every student's progress.
- **Mentors and admins** (the G3ID roles, never a kiosk PIN session) sign skills off, one at a
  time on a student's tree or for several people at once on Sign Off, and edit the trees.
- **Students** are G3ID's active accounts that aren't mentors. Nobody is added by hand, and a
  student shows up without opening the app. G3ID's list of accounts doesn't say who is a mentor,
  so a mentor is left out once they have opened Skill Tree, and all mentors once a G3ID admin has.

## Pages

| Page | Plugin | What it does |
| --- | --- | --- |
| Overview | `overview` | Team average per tree, and each student's progress in every tree |
| Skill Trees | `trees` | One tree for one student. A category opens a panel with its skills; a skill shows what it takes and who signed it off |
| Sign Off (mentors) | `sign-off` | One status for several people on several skills. People are added by kiosk PIN or by name |
| Edit Trees (mentors) | `editor` | The team's tree set: save it to a file or load one, and edit trees, categories and skills |

`src/plugins/trees/layout.ts` places the boxes and routes the lines between them.
`src/shared/progress.ts` decides what is locked, available, in progress or complete.

## The trees are the team's, not the app's

The app holds no trees of its own. A team's trees are one **tree set**, and nothing in the code
knows what is in it. A team starts on the default set
([`workers/skill-tree/content/default-trees.json`](../../workers/skill-tree/content/default-trees.json),
loaded the first time anyone opens the app), then makes it its own in either of two ways:

- **In the app:** Edit Trees adds, renames, reorders and deletes trees, categories and skills.
- **With a file:** Edit Trees → *Save to a file* downloads the whole set as JSON. Edit it, or
  write one from scratch, and *Load a file…* makes the team's trees match it. The app checks the
  file and shows what will be added and removed before anything changes.

### The file

```json
{
  "format": "gearbox-skill-trees",
  "version": 1,
  "name": "Team 9999's trees",
  "trees": [
    {
      "key": "safety",
      "name": "Safety",
      "icon": "🦺",
      "subtitle": "Do this first",
      "categories": [
        {
          "key": "shop",
          "name": "Shop Safety",
          "skills": [
            { "key": "S1", "name": "General Shop Awareness", "summary": "exits, first aid, PPE" },
            {
              "key": "S2",
              "name": "Eye & Hearing Protection",
              "description": "Know which tasks need safety glasses and which a face shield.",
              "requires": ["S1"]
            }
          ]
        }
      ]
    },
    { "key": "welding", "name": "Welding", "icon": "🔥", "requires": "safety", "categories": [] }
  ]
}
```

| Field | On | What it is |
| --- | --- | --- |
| `key` | tree, category, skill | The item's name in the file: 1–40 letters, digits, `-` or `_`. Unique among the file's trees, among a tree's categories, and among **all** the file's skills |
| `name` | all | What people see. Required |
| `icon`, `subtitle` | tree | An emoji, and a line under the name |
| `summary`, `description` | skill | A few words on the skill's box, and what a student must show to have it signed off |
| `requires` | tree | The key of one tree that must be finished before this one opens |
| `requires` | category | Keys of categories in the same tree that must be finished first |
| `requires` | skill | Keys of skills in the same category that must be complete first |

Everything but `key` and `name` can be left out. Order in the file is the order on screen.

**Keys are how a load matches what's already there.** A skill whose key is still in the file
keeps everyone's progress, even if it was renamed or moved to another category. A skill whose key
is gone is deleted, along with the sign-offs on it, so change a key only when you mean a different
skill.

## Data

Rows in the worker's D1 database (`SKILL_DB`), all of them the team's:

| Table | Holds |
| --- | --- |
| `tree_sets` | The team's set: its name and who last loaded it. Everything below hangs off it |
| `trees`, `tree_categories`, `skills` | The trees |
| `category_prereqs`, `skill_prereqs` | What comes after what |
| `skill_progress` | One row per student (G3ID user id) per started skill, with who set it and when |
| `mentors` | G3ID accounts known to be mentors, which are left out of the list of students |

## Running

```
pnpm --filter @g3/worker-skill-tree run db:migrate:local   # once, and after new migrations
pnpm --filter @g3/worker-skill-tree dev                    # the API on :8790 (needs g3id on :8787)
pnpm --filter @g3/skill-tree dev                           # http://localhost:5180
pnpm --filter @g3/worker-skill-tree test
```
