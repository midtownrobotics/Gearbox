# @g3/scouting

Shared scouting and strategy workspace for G3 Robotics.

- Customizable, drag-and-drop tier lists
- Uploadable field maps with browser drawing tools and R2 storage
- Searchable autonomous routine library

The app runs on port 5182 and its worker runs on port 8792. Apply the worker's
local D1 migration before first use.

## Service-ticket alerts

Service-ticket alerts go to the service crew on the team's chat, Slack or
Discord, through G3ID (which holds the bot's token). Helpers get them once
they've linked the team's chat to their account. The worker's only secret is
The Blue Alliance's key:

```bash
cd workers/scouting
wrangler secret put TBA_AUTH_KEY --env production
```
