import { teamSettingsRoutes } from "@g3/auth";
import { createShopDb } from "../db";
import { onshapeConfig } from "../lib/onshape-config";
import { SETTING, getSetting, isChannelId, setSetting } from "../lib/settings";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";

// The team's Shop settings for the team's dashboard (roadmap 4.5), by manifest key: the channels
// (Slack or Discord) for releases and daily summaries (empty: no posts). The Onshape connection is saved on
// Shop's Admin page, which also registers the webhook; this only reports whether it's set up.
const CHANNELS = {
  releaseChannelId: SETTING.releaseChannel,
  summaryChannelId: SETTING.summaryChannel,
} as const;

export const teamSettingsRouter = teamSettingsRoutes<AppEnv>(manifest, "Shop settings", {
  async read(c) {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [release, summary, onshape] = await Promise.all([
      getSetting(db, teamId, CHANNELS.releaseChannelId),
      getSetting(db, teamId, CHANNELS.summaryChannelId),
      onshapeConfig(c.env, db, teamId).catch(() => null),
    ]);
    const connected = Boolean(onshape?.credentials && onshape.companyId && onshape.documentId);
    return {
      values: { releaseChannelId: release, summaryChannelId: summary },
      secretsSet: {
        apiKey: Boolean(onshape?.credentials),
        secretKey: Boolean(onshape?.credentials),
        webhookKeys: Boolean(onshape?.webhookKeys),
      },
      integrations: {
        onshape: {
          connected,
          detail:
            connected && onshape?.fromWorkerSecrets
              ? "Uses keys set up on the server. Save your own in Shop to replace them."
              : undefined,
          facts: [
            { label: "Document", value: onshape?.documentId ?? "Not set" },
            { label: "Company", value: onshape?.companyId ?? "Not set" },
            { label: "API keys", value: onshape?.credentials ? "Set" : "Not set" },
            {
              label: "Webhook signing keys",
              value: onshape?.webhookKeys ? "Set" : "Not set (releases won't arrive)",
            },
          ],
        },
      },
    };
  },
  async save(c, changes) {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    for (const [key, value] of Object.entries(changes)) {
      const row = CHANNELS[key as keyof typeof CHANNELS];
      if (typeof value === "string" && !isChannelId(value)) {
        return "Choose a Slack or Discord channel.";
      }
      await setSetting(db, teamId, row, typeof value === "string" ? value : "");
    }
  },
});
