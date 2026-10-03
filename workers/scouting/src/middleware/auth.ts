import { type G3AuthEnv, requireAuth as requireG3IdAuth } from "@g3/auth";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

/**
 * Signed in through G3ID (@g3/auth), or, in local dev with LOCAL_AUTH_BYPASS=true, as a fake
 * admin so the app runs without G3ID.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  // AppEnv has everything G3AuthEnv needs; Hono's Context type just can't narrow to it.
  if (c.env.LOCAL_AUTH_BYPASS !== "true") {
    return requireG3IdAuth(c as unknown as Context<G3AuthEnv>, next);
  }
  c.set("userId", "local-scout");
  c.set("userDisplayName", "Local Scout");
  c.set("userEmail", "scout@localhost");
  c.set("userIsAdmin", true);
  c.set("userIsMentor", false);
  c.set("sessionType", "oauth");
  c.set("kioskDeviceId", null);
  c.set("kioskDeviceName", null);
  c.set("userSlackId", null);
  await next();
});
