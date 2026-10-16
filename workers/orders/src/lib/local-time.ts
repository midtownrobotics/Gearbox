import type { Context } from "hono";
import { isTimeZone } from "./fiscal";

// Orders has no time zone of its own: dates are the local time of whoever is looking. The app
// sends the browser's time zone with every call (apps/orders/src/shared/api.ts), and the worker
// uses it where it has to turn a moment into a date: where a fiscal year starts, the dates in an
// export, the dates read from an imported sheet.

export const TIME_ZONE_HEADER = "X-Time-Zone";

/** The time zone of the browser making the request, or UTC when it didn't say (or said nonsense). */
export function localTimeZone(c: Context): string {
  const zone = c.req.header(TIME_ZONE_HEADER);
  return zone && isTimeZone(zone) ? zone : "UTC";
}
