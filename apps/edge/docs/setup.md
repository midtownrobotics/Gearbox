---
title: Set up Edge
summary: Connect your team's box with its key. Building a box is still a hands-on job.
order: 0
pages: /box
---

> A setup kit any team can follow isn't ready yet. Today, building a box means following the hand-applied setup in [infra/edge](https://github.com/midtownrobotics/Gearbox/tree/main/infra/edge) and the [design notes](https://github.com/midtownrobotics/Gearbox/blob/main/docs/edge.md). If you'd like to try, ask on [GitHub](https://github.com/midtownrobotics/Gearbox/issues).

## What a box needs

- A small Linux computer with two network ports: one to the internet (a router, or a cellular hotspot), one to the shop's network.
- For printing, a printer it can reach. For door sounds, a door switch and a speaker.

## Connect it

1. Switch Edge on, on [Manage Apps](/portal/apps).
2. On Edge's **Edge Box** page, choose **Make a new key**. It's shown once: copy it.
3. Put the key on the box as `EDGE_AGENT_KEY`, with your team's number, and start the agent.
4. **Connection** on the Edge Box page shows the box once it's connected, with when it was last heard from.

Making a new key replaces the old one and disconnects the box until it has the new key.

## Then

- [ ] Set the monthly data cap on **Overview**, if your internet is metered
- [ ] Add the shop's printer on **Printers**
- [ ] Try a part lookup by pasting an Amazon, McMaster-Carr or DigiKey link into Orders' New Request
