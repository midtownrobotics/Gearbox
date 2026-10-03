# Releases

Each release of the whole platform, newest first, with the version of every app in it.

- **Platform version** (root `package.json`): CalVer, `YEAR.MONTH.N`, where N counts releases within the month. It says how current an install is.
- **App versions**: SemVer, one per app, shared by its page and its worker (Changesets "fixed" groups in `.changeset/config.json`). Shown in each app's navbar and its worker's `/health`.

**Branches:** work lands on `main`. `public` is what's released, and it's what gets deployed.

**Making a release:**

1. Every PR into `main` that changes an app adds a changeset (`pnpm changeset`, see `.changeset/README.md`).
2. A release PR from `main` into `public` stays open (`.github/workflows/release-pr.yml`). After every push to `main` it's retitled with what merging it would release, e.g. "Release 2026.10.4: Orders 1.2.0, Pit 1.0.1", and its description lists the versions and notes (`pnpm release:preview` shows the same locally). Nothing is applied yet.
3. When you're ready, merge that PR with **Create a merge commit** (not squash or rebase, which would break the merge back into `main`).
4. The release workflow (`.github/workflows/release.yml`) then runs on `public`. It applies the changesets (`pnpm release:version`: versions, changelogs, the next platform version, this file), commits that to `public` as "Release <platform>", tags `v<platform>` plus each app's new version (`pnpm release:tag`), and merges `public` back into `main` so `main` has the new versions too. It pushes with a deploy key (`RELEASE_DEPLOY_KEY`) that's on the bypass list of both branch rulesets.

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
