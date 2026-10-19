# @g3/edge-agent

## 0.6.0

### Minor Changes

- 74955c0: Door Sounds now has an ordered multi-selection with touch and keyboard drag handles, clearly separated clip cards, and compact sliders beneath each clip for pause and volume. Each clip has a single Pause before this clip slider that also applies on repeats. Each opening starts at the first selection and its volume; closing cancels any delay or cuts off playback immediately. Preferences persist on the Edge box. Volume control supports uncompressed PCM and floating-point WAVs.
  
  Rename clips inline while keeping their volume, pause, and playlist position.

## 0.5.0

### Minor Changes

- 5dfc5b0: Door sounds repeat while the door is open and stop when it closes. Door Sounds plays one sound at a time: a new test or door opening replaces the one playing instead of queuing behind it, and a Stop sound button silences it.
- d699aad: The edge box now keeps its own connection open to the edge worker, so printing, part lookups, door sounds and the live Network pages reach it without a Cloudflare Tunnel. The Edge Box page's Tunnel card is now a Connection card. Deployers: deploy the edge worker and install the new agent together (an older agent can't be reached by the new worker), then remove the old tunnel as described in `infra/edge/README.md`.
- 774fae8: Door sounds play through the Orange Pi 5's headphone jack by default (no Bluetooth speaker needed), and the edge README has PowerShell steps for upgrading the agent from Windows.
- d699aad: Network → Clients shows which devices are on the shop network right now, checked live on the edge box each time the page loads, including devices that never use the internet like printers. Filter the list with "Online now". The Edge Box page shows the box's LAN, WAN and public addresses. Deployers: apply migration `0004_public_ip.sql` (`pnpm --filter @g3/worker-edge run db:migrate:remote`) before deploying the edge worker.
- 883e23d: Edge works for any team with its own box: each box signs in with its team's own key, made by an admin on the Edge Box page, and each team's network data, blocking and settings are its own. Days, billing cycles and "until midnight" exceptions use the box's own time zone, which the agent now reports. Part lookups in Orders and printing in Shop use your own team's box. Deployers: follow "Edge for every team" in docs/deploy.md before merging: apply migration `0005_teams.sql`, then store G3's current box key with `box-key:set`; afterward upgrade the agent and delete the `EDGE_AGENT_KEY` secret.

### Patch Changes

- c9827c9: Amazon links look up from a phone too: the box now always asks Amazon as a desktop browser, finds the product's name in more places, and only says "bot check" when Amazon really showed a CAPTCHA. Amazon share links (a.co) are saved as the product's page, so their items go into Share-A-Cart carts, and the Carts page marks Amazon items that can't.
- 5dfc5b0: Devices with a fixed IP (or no DHCP lease) are now matched by their MAC address, so their usage, sites and online status show on one client instead of a separate "ip:" entry that never shows as online.
