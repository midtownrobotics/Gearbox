import { activeMembers, hasPermission, inTeam } from "@g3/auth";

import { sql } from "drizzle-orm";
import type { Context } from "hono";

import { dbOf, first } from "./db";

import { serviceHelpers, strategyAdmins } from "./db/schema";

import type { AppEnv } from "./types";

export async function isStrategyAdmin(c: Context<AppEnv>) {
  if (c.get("sessionType") === "pin") return false;
  if (hasPermission(c, "strategy")) return true;
  const row = await first<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT user_id FROM (SELECT * FROM ${strategyAdmins} WHERE ${inTeam(strategyAdmins, c.get("teamId"))}) AS scoped_strategy_admins WHERE user_id = ${c.get("userId")}`,
  );
  return Boolean(row);
}

export async function isServiceHelper(c: Context<AppEnv>) {
  if (c.get("sessionType") === "pin") return false;
  if (hasPermission(c, "service")) return true;
  const row = await first<Record<string, unknown>>(
    dbOf(c),
    sql`SELECT user_id FROM (SELECT * FROM ${serviceHelpers} WHERE ${inTeam(serviceHelpers, c.get("teamId"))}) AS scoped_service_helpers WHERE user_id = ${c.get("userId")}`,
  );
  return Boolean(row);
}

export async function getG3IdUsers(c: Context<AppEnv>) {
  if (c.env.LOCAL_AUTH_BYPASS === "true") {
    return [
      {
        id: c.get("userId"),
        email: c.get("userEmail"),
        displayName: c.get("userDisplayName"),
        status: "active" as const,
      },
    ];
  }
  return activeMembers(c.env, c.get("teamId"));
}
