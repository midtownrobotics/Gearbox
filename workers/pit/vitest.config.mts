import { workerTestConfig } from "@g3/testing/config";

/** Each team's event days, as the stand-in Schedule gives them (tests set them). */
const eventDays = new Map<string, unknown>();

/**
 * Schedule as Pit uses it: when the team's events open and close. A test sets a team's with
 * `PUT /test/teams/:teamId/event-days` (test/battery-timers.test.ts); a team without any has none.
 */
const schedule = async (request: Request) => {
  const path = new URL(request.url).pathname;
  const set = path.match(/^\/test\/teams\/([^/]+)\/event-days$/);
  if (set && request.method === "PUT") {
    eventDays.set(decodeURIComponent(set[1]), await request.json());
    return Response.json({ ok: true });
  }
  const get = path.match(/^\/api\/internal\/teams\/([^/]+)\/event-days$/);
  if (get) return Response.json({ events: eventDays.get(decodeURIComponent(get[1])) ?? [] });
  return Response.json({ error: `Schedule stub has no ${path}` }, { status: 404 });
};

export default workerTestConfig({ d1: "PIT_DB", services: { SCHEDULE: schedule } });
