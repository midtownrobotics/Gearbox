# Releases

Each release of the whole platform, newest first, with the version of every app in it.

- **Platform version** (root `package.json`): CalVer, `YEAR.MONTH.N`, where N counts releases within the month. It says how current an install is.
- **App versions**: SemVer, one per app, shared by its page and its worker (Changesets "fixed" groups in `.changeset/config.json`). Shown in each app's navbar and its worker's `/health`.

**Branches:** work lands on `main`. `public` is what's released, and it's what gets deployed.

**Making a release:**

1. Every PR into `main` that changes an app adds a changeset (`pnpm changeset`, see `.changeset/README.md`).
2. When you're ready to release, merge `main` into `public`.
3. The release workflow (`.github/workflows/release.yml`) runs on `public`. It applies the changesets (`pnpm release:version`: versions, changelogs, the next platform version, this file), commits that to `public` as "Release <platform>", tags `v<platform>` plus each app's new version (`pnpm release:tag`), and merges `public` back into `main` so `main` has the new versions too.

<!-- releases -->

## 2026.10.0 (2026-10-03)

Versioning starts here.

| App | Version |
| --- | --- |
| G3ID | 1.0.0 |
| Gearbox | 1.0.0 |
| Shop | 1.2.3 |
| Pit | 1.0.0 |
| Orders | 1.0.0 |
| Edge | 1.0.0 |
| Edge agent | 0.4.0 |
| Scouting | 1.0.0 |
| Skill Tree | 1.0.0 |
| Attendance | 1.0.0 |
