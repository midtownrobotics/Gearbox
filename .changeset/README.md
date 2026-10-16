# Changesets

Each change to an app gets a changeset: a small file saying which app changed and how, written by

```bash
pnpm changeset
```

Pick the app (its page or its worker; they share one version), then the bump:

- **patch**: fixes, small tweaks (1.4.0 → 1.4.1)
- **minor**: new features that don't break anything (1.4.0 → 1.5.0)
- **major**: changes that need action from users or deployers, e.g. a migration that must run first, a removed page, a changed API (1.4.0 → 2.0.0)

Write the summary for the people who use the app. It becomes that app's CHANGELOG.md entry.

Changes to shared packages (`packages/*`) are recorded against the apps they affect. A release happens when `main` is merged into `public` (see RELEASES.md).
