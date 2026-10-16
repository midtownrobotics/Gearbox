---
"@g3/worker-skill-tree": major
---

Skill Tree is rebuilt to match the other apps, and starts fresh. It has the shared top bar, colors, fonts and light/dark mode. The trees are now your team's own: edit them in the app (Edit Trees), save them to a file, or load a file with a different set of trees. Every student account shows up without having to open the app first. There is a Sign Off page for marking several people at once, and each sign-off shows who made it. Mentors are G3ID's mentors and admins: Skill Tree's own "Admins" list is gone. **Everyone's earlier progress is cleared.** Deployers: apply the database migrations before deploying (`pnpm --filter @g3/worker-skill-tree run db:migrate:remote`); they delete the old progress, so export the database first if you want a copy.
