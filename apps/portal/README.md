# @g3/portal

G3 Gearbox (gearbox.g3robotics.com), the members portal: Vite + React + React Router + Tailwind.

## Dev

```bash
pnpm dev
```

## Adding a plugin

1. Create `src/plugins/{name}/` with `index.tsx`, `README.md`, and your page components.
2. Export a `Plugin` object from `index.tsx` (see `src/shared/plugin-types.ts`).
3. Add one import + one array entry to `src/plugins.config.ts`.

That's it. No changes to `app.tsx`.

## Structure

```
src/
├── app.tsx              # plugin loader — do not edit for feature work
├── plugins.config.ts    # register plugins here
├── shared/              # cross-plugin components and types
└── plugins/
    └── home/            # one folder per plugin
```
