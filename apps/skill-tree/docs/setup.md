---
title: Set up Skill Tree
summary: Start from the default trees, then make them your team's, in the editor or with a file.
order: 0
pages: /edit /edit/:treeId
access: mentor
---

Switching Skill Tree on gives your team a default set of trees to start from. Make them your own on [Edit Trees](team:skill-tree/edit).

## Checklist

- [ ] Look through the default trees with your mentors
- [ ] Rename, remove or add trees, categories and skills to match what your shop teaches
- [ ] Set what each skill and category **opens after**, and which tree each tree waits on
- [ ] **Save to a file** once you're happy, to keep a copy
- [ ] Tell students where to see their progress: [Skill Trees](team:skill-tree/trees)

## In the editor

Each tree has categories, and each category has skills. A skill has a name, a summary of what it takes, and the skills it comes after (in the same category). A category opens after other categories in the same tree. Leave "opens after" empty for something open from the start.

Deleting a skill, category or tree deletes everyone's progress on it.

## With a file

Under **Tree set**:

- **Save to a file** downloads every tree as one JSON file.
- **Load a file** makes your trees match a file: yours, edited, or one another team shared. Before anything changes, you see what it would add, change and remove, and whose progress would be lost.

Things are matched by their key, so a skill keeps everyone's progress even if the file renames it or moves it to another category. The file format is described in the [Skill Tree README](https://github.com/midtownrobotics/Gearbox/blob/main/apps/skill-tree/README.md).
