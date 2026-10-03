# G3 Gearbox
### All of the G3 Robotics internal tools created with React, Vite, and Hono then deployed to Cloudflare via Wrangler.

### The Apps:
- Main Dashboard
- G3ID SSO System: Google, Github, Slack, and even Steam logins all linking to your team account all in one place.
- Pit Software
- Shop Production Tracking Software
- Skill Tree Software: Tracking the skills that our members acquire in their subteams.
- Strategy and Scouting Software
- Edge: The connection between hardware in the shop and our Cloudflare setup.
- Order Software: A heavily [frctools.com](https://orders.frctools.com/) inspired team ordering system with our own twists.

## Q/A

**How do I access these tools?** Unfortunaly, there is not current public access version for all teams to use. Each deployment is setup to be used with a single team, internally. The long term idea is to change this.

**Are all these apps just created with AI?** Yes. They've been tried and tested by our team and are contiously developed and improved as we find things to add. This is able to be achived (in part) because of our AI usage. 

**Can I clone this repo and deploy it for my team and how?** Yes! Please! and ... it's difficult. Instructions are coming soon. For now, I would start by setting up cloudflare workers, pages, and the wrangler.toml files for each app you wish to use.

## License and policies

Gearbox is released under the [MIT License](LICENSE).

Drafts of the [Terms of Service](docs/legal/terms-of-service.md) and [Privacy Policy](docs/legal/privacy-policy.md) for the hosted, multi-team version are in `docs/legal/`. They are not in force yet and are still under review.
