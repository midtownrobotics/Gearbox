import { teamKey } from "@g3/site-config";
import type { createShopDb } from "../db";
import type { AppEnv } from "../types";
import { SETTING, getSettings, readSecret, setSecret, setSetting } from "./settings";

// Each team's Onshape connection: its own API key and secret (from Onshape's Developer Portal),
// company, webhook signing keys and the document Shop follows. Admins save them on the Admin page;
// the key, secret and signing keys are stored encrypted. Onshape's webhooks for a team call back on
// that team's own address, which is how an event finds its team (routes/onshape-webhooks.ts).
//
// The site team had its keys as worker secrets before teams. It keeps using those until an admin
// saves its own, as G3ID's Slack does for the site team.

type ShopDb = ReturnType<typeof createShopDb>;
type Env = AppEnv["Bindings"];

/** Enough to call Onshape's API as the team. */
export type OnshapeCredentials = { apiKey: string; apiSecret: string };

export type OnshapeConfig = {
  credentials: OnshapeCredentials | null;
  companyId: string | null;
  /** Signing keys for verifying the team's webhook events. */
  webhookKeys: { primary: string; secondary: string } | null;
  documentId: string | null;
  mainAssemblyId: string | null;
  /** Keys from the site team's worker secrets, not saved ones. */
  fromWorkerSecrets: boolean;
};

export const basicAuth = (c: OnshapeCredentials) => `Basic ${btoa(`${c.apiKey}:${c.apiSecret}`)}`;

export async function onshapeConfig(env: Env, db: ShopDb, teamId: string): Promise<OnshapeConfig> {
  const s = await getSettings(db, teamId, Object.values(SETTING));
  const [apiKey, apiSecret, primary, secondary] = await Promise.all(
    [
      SETTING.onshapeApiKey,
      SETTING.onshapeApiSecret,
      SETTING.onshapeWebhookPrimary,
      SETTING.onshapeWebhookSecondary,
    ].map((key) => readSecret(s.get(key), env.SECRETS_KEY)),
  );
  const site = teamId === teamKey;
  const savedCredentials = apiKey && apiSecret ? { apiKey, apiSecret } : null;
  const secretCredentials =
    site && env.ONSHAPE_API_KEY && env.ONSHAPE_API_SECRET
      ? { apiKey: env.ONSHAPE_API_KEY, apiSecret: env.ONSHAPE_API_SECRET }
      : null;
  const savedWebhook = primary ? { primary, secondary: secondary ?? primary } : null;
  const secretWebhook =
    site && env.ONSHAPE_WEBHOOK_KEY_PRIMARY
      ? {
          primary: env.ONSHAPE_WEBHOOK_KEY_PRIMARY,
          secondary: env.ONSHAPE_WEBHOOK_KEY_SECONDARY ?? env.ONSHAPE_WEBHOOK_KEY_PRIMARY,
        }
      : null;
  return {
    credentials: savedCredentials ?? secretCredentials,
    companyId: s.get(SETTING.onshapeCompany) ?? (site ? (env.ONSHAPE_COMPANY_ID ?? null) : null),
    webhookKeys: savedWebhook ?? secretWebhook,
    documentId: s.get(SETTING.onshapeDocument) ?? null,
    mainAssemblyId: s.get(SETTING.onshapeMainAssembly) ?? null,
    fromWorkerSecrets: !savedCredentials && secretCredentials !== null,
  };
}

export type OnshapeChanges = {
  documentId?: string;
  mainAssemblyId?: string;
  companyId?: string;
  apiKey?: string;
  apiSecret?: string;
  webhookKeyPrimary?: string;
  webhookKeySecondary?: string;
};

/** Saves what's given; secrets left out (or empty) stay as they are. */
export async function saveOnshapeConfig(
  env: Env,
  db: ShopDb,
  teamId: string,
  changes: OnshapeChanges,
) {
  const plain = [
    [SETTING.onshapeDocument, changes.documentId],
    [SETTING.onshapeMainAssembly, changes.mainAssemblyId],
    [SETTING.onshapeCompany, changes.companyId],
  ] as const;
  for (const [key, value] of plain) {
    if (value) await setSetting(db, teamId, key, value);
  }
  const secret = [
    [SETTING.onshapeApiKey, changes.apiKey],
    [SETTING.onshapeApiSecret, changes.apiSecret],
    [SETTING.onshapeWebhookPrimary, changes.webhookKeyPrimary],
    [SETTING.onshapeWebhookSecondary, changes.webhookKeySecondary],
  ] as const;
  for (const [key, value] of secret) {
    if (value) await setSecret(db, teamId, key, value, env.SECRETS_KEY);
  }
}
