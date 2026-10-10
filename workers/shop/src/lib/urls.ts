import { teamAppUrlVia } from "@g3/site-config";
import type { AppEnv } from "../types";

/** The team's Shop page (https://1648-shop.frcgearbox.com), or through the dev gateway. */
export const shopUrl = (env: AppEnv["Bindings"], teamId: string) =>
  teamAppUrlVia(env.LOCAL_GATEWAY_URL || undefined, teamId, "shop");
