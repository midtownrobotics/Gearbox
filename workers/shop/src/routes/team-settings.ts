import { teamSettingsRoutes } from "@g3/auth";
import { createShopDb } from "../db";
import { onshapeConfig } from "../lib/onshape-config";
import { qualityCheck, saveQualityCheck } from "../lib/quality";
import { SETTING, getSetting, setSetting } from "../lib/settings";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";

// The team's Shop settings for the team's dashboard (roadmap 4.5), by manifest key: the Slack
// channels for releases and daily summaries (empty: no posts). The Onshape connection is saved on
// Shop's Admin page, which also registers the webhook; this only reports whether it's set up.
const CHANNELS = {
  slackReleaseChannelId: SETTING.slackReleaseChannel,
  slackSummaryChannelId: SETTING.slackSummaryChannel,
} as const;

export const teamSettingsRouter = teamSettingsRoutes<AppEnv>(manifest, "Shop settings", {
  async read(c) {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [release, summary, onshape, quality] = await Promise.all([
      getSetting(db, teamId, CHANNELS.slackReleaseChannelId),
      getSetting(db, teamId, CHANNELS.slackSummaryChannelId),
      onshapeConfig(c.env, db, teamId).catch(() => null),
      qualityCheck(db, teamId),
    ]);
    const connected = Boolean(onshape?.credentials && onshape.companyId && onshape.documentId);
    return {
      values: {
        slackReleaseChannelId: release,
        slackSummaryChannelId: summary,
        requireQualityCheck: quality.required,
        qualityProcessId: quality.processId === null ? null : String(quality.processId),
      },
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

    // The quality check is two settings that only make sense together.
    if ("requireQualityCheck" in changes || "qualityProcessId" in changes) {
      const before = await qualityCheck(db, teamId);
      const processId = changes.qualityProcessId;
      const refused = await saveQualityCheck(db, teamId, {
        required:
          typeof changes.requireQualityCheck === "boolean"
            ? changes.requireQualityCheck
            : before.required,
        processId:
          processId === undefined
            ? before.processId
            : processId === null || processId === ""
              ? null
              : Number(processId),
      });
      if (refused) return refused;
    }

    for (const [key, value] of Object.entries(changes)) {
      const row = CHANNELS[key as keyof typeof CHANNELS];
      if (!row) continue;
      if (typeof value === "string" && !/^[A-Z0-9]{8,12}$/.test(value)) {
        return "A Slack channel ID looks like C0123456789 (in the channel's details in Slack).";
      }
      await setSetting(db, teamId, row, typeof value === "string" ? value : "");
    }
  },
});
