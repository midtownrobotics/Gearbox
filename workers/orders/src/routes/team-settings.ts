import { teamSettingsRoutes } from "@g3/auth";
import { createOrdersDb } from "../db";
import { saveTeamSettings, teamSettings } from "../lib/settings";
import { connection } from "../lib/share-a-cart";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";
import { checkSettings } from "./fast-entry";

// The team's Orders settings for the team's dashboard (roadmap 4.5), by manifest key, checked the
// same way as the Settings page's. Share-A-Cart's connection is reported, and made on Settings.
export const teamSettingsRouter = teamSettingsRoutes<AppEnv>(manifest, "Orders settings", {
  async read(c) {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const [settings, sac] = await Promise.all([
      teamSettings(db, teamId),
      connection({ db, teamId, secretsKey: c.env.SECRETS_KEY }).catch(() => null),
    ]);
    return {
      values: { ...settings },
      integrations: {
        "share-a-cart": sac
          ? {
              connected: true,
              facts: [
                // Share-A-Cart's connection keeps milliseconds.
                {
                  label: "Connected",
                  value: `by ${sac.connectedBy}`,
                  at: Math.floor(sac.connectedAt / 1000),
                },
              ],
            }
          : { connected: false },
      },
    };
  },
  async save(c, changes) {
    const checked = checkSettings(changes);
    if (typeof checked === "string") return checked;
    await saveTeamSettings(createOrdersDb(c.env.ORDERS_DB), c.get("teamId"), checked);
  },
});
