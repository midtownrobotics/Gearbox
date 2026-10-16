import { teamAppUrlVia } from "@g3/site-config";
import type { AppEnv } from "../types";

/** The team's Orders page (https://1648-orders.frcgearbox.com), or through the dev gateway. */
export const ordersUrl = (env: AppEnv["Bindings"], teamId: string) =>
  teamAppUrlVia(env.LOCAL_GATEWAY_URL || undefined, teamId, "orders");
