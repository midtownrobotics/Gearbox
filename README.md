# Gearbox

**The open-source platform that runs an FRC team.** Free apps for parts ordering, shop and pit tracking, scouting, skills and attendance, all behind one sign-in with your team's Slack. Started by [G3 Robotics](https://www.g3robotics.com), FRC Team 1648, and open to every team that wants to use it or make it better.

## The apps

| App | What it does |
| --- | --- |
| **Sign-in** (G3ID) | One account for every app. Members sign in through the team's Slack, and can link Google, GitHub or Steam. Shared shop computers use 3-digit kiosk PINs. |
| **Portal** | The team's home: every app and the team's links in one place. |
| **Orders** | Part requests from any member, mentor approvals, budgets by category, carts grouped by vendor, a searchable catalog of FRC parts. Inspired by [frctools.com](https://orders.frctools.com/). |
| **Shop** | Every manufactured part from the CAD's bill of materials through each process, with drawings and printing. |
| **Pit** | Competition days: battery tracking, pit checklists and a pit monitor. |
| **Scouting** | Scouting forms, pick-list tier lists, field maps and an auto library. |
| **Skill Tree** | Each student's skills as a tree, with mentors signing off progress. |
| **Attendance** | Kiosk sign-in and sign-out, with season hours. |
| **Edge** | G3's own app for the shop's network box (printing, network usage, a shared drive). Not part of the platform other teams get. |

Each team has its own address for every app, its own sign-in through its own Slack workspace, and its own name, colours, logo and links, set by its admins.

## Using it

**Hosted (coming soon):** a free, volunteer-run version every team can sign up for. Signing up takes your team's details, adding Gearbot (the Gearbox Slack bot) to your Slack, and sending Gearbot a code; whoever signs up becomes the team's first admin.

**On your own servers:** everything runs on Cloudflare (Workers, D1, KV). Put your team and domains in [`packages/site-config/src/site.ts`](packages/site-config/src/site.ts), run `pnpm configure`, and follow [`docs/deploy.md`](docs/deploy.md).

## Developing

```bash
pnpm install
pnpm db:migrate:local   # local databases
pnpm dev                # every app and worker, plus the gateway
```

`pnpm dev` prints every address. Through the gateway, the platform is at `http://gearbox.localhost:8796` and a team's apps at `http://<number>-<app>.gearbox.localhost:8796`, for example `http://1648-id.gearbox.localhost:8796` to sign in.

```bash
pnpm lint               # Biome
pnpm typecheck
pnpm test               # each worker's tests, in the Workers runtime
```

How it fits together: each app is a React page plus a Hono worker serving it and its API at `/api`, and a gateway worker sends every hostname to the right app for the right team. [`CLAUDE.md`](CLAUDE.md) is the architecture reference.

## Contributing

We want your pull requests: bug fixes, new features, docs, even whole new apps, from students and mentors alike. Open an issue to talk an idea through first, or just send a PR.

- [`docs/roadmap/roadmap.md`](docs/roadmap/roadmap.md) is the plan: what's done, what's next, and why.
- Every PR that changes an app adds a changeset (`pnpm changeset`); see [`.changeset/README.md`](.changeset/README.md).
- Much of this code is written with AI assistants, then tried and tested by G3 through real seasons. AI-assisted PRs are welcome if you've checked they work.

## License and policies

Gearbox is released under the [MIT License](LICENSE).

Drafts of the [Terms of Service](docs/legal/terms-of-service.md) and [Privacy Policy](docs/legal/privacy-policy.md) for the hosted platform are in `docs/legal/`. They are not in force yet and are still under review.
