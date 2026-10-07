import { decryptSecret, encryptSecret, inTeam, withTeam } from "@g3/auth";
import { eq, inArray } from "drizzle-orm";
import type { createShopDb } from "../db";
import { adminSettings } from "../db/schema";

// A team's settings: one row per key in admin_settings, kept to the team. Secrets (Onshape keys)
// are stored encrypted with the worker's SECRETS_KEY (encryptSecret in @g3/auth).

type ShopDb = ReturnType<typeof createShopDb>;

export const SETTING = {
  slackReleaseChannel: "slack_release_channel_id",
  slackSummaryChannel: "slack_summary_channel_id",
  onshapeDocument: "onshape_document_id",
  onshapeMainAssembly: "onshape_main_assembly_id",
  onshapeCompany: "onshape_company_id",
  /** Encrypted. */
  onshapeApiKey: "onshape_api_key",
  onshapeApiSecret: "onshape_api_secret",
  onshapeWebhookPrimary: "onshape_webhook_key_primary",
  onshapeWebhookSecondary: "onshape_webhook_key_secondary",
} as const;

export async function getSetting(db: ShopDb, teamId: string, key: string) {
  const row = await db
    .select({ value: adminSettings.value })
    .from(adminSettings)
    .where(inTeam(adminSettings, teamId, eq(adminSettings.key, key)))
    .get();
  return row?.value || null;
}

/** Several settings at once, by key (missing ones left out). */
export async function getSettings(db: ShopDb, teamId: string, keys: string[]) {
  const rows = await db
    .select({ key: adminSettings.key, value: adminSettings.value })
    .from(adminSettings)
    .where(inTeam(adminSettings, teamId, inArray(adminSettings.key, keys)))
    .all();
  return new Map(rows.filter((r) => r.value).map((r) => [r.key, r.value]));
}

export async function setSetting(db: ShopDb, teamId: string, key: string, value: string) {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db
    .insert(adminSettings)
    .values(withTeam(teamId, { key, value, updatedAt }))
    .onConflictDoUpdate({
      target: [adminSettings.teamId, adminSettings.key],
      set: { value, updatedAt },
    });
}

export async function setSecret(
  db: ShopDb,
  teamId: string,
  key: string,
  value: string,
  secretsKey: string | undefined,
) {
  await setSetting(db, teamId, key, await encryptSecret(value, secretsKey));
}

export async function readSecret(sealed: string | undefined, secretsKey: string | undefined) {
  return sealed ? decryptSecret(sealed, secretsKey) : null;
}
