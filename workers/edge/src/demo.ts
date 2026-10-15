import { withTeam } from "@g3/auth";
import { vocabularyOf } from "@g3/demo";
import type { EdgeDb } from "./db";
import { netClients, netSettings, netUsageHourly } from "./db/schema";

// The public demo's Edge (roadmap 5.3), loaded after its nightly reset. The demo has no box, so
// its pages say it isn't connected; what it shows is a month of the shop network's use: the
// devices on it and their hourly traffic, busiest at meetings.

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const HOUR = 60 * 60;

/** Locally administered addresses, so none is a real device's. */
const CLIENTS = [
  { mac: "02:00:00:00:99:01", hostname: "driver-station", name: "Driver station", weight: 3 },
  { mac: "02:00:00:00:99:02", hostname: "practice-laptop", name: "Practice laptop", weight: 2 },
  { mac: "02:00:00:00:99:03", hostname: "cad-desktop", name: "CAD desktop", weight: 5 },
  {
    mac: "02:00:00:00:99:04",
    hostname: "programming-laptop",
    name: "Programming laptop",
    weight: 4,
  },
  { mac: "02:00:00:00:99:05", hostname: "scouting-tablet", name: "Scouting tablet", weight: 1 },
  {
    mac: "02:00:00:00:99:06",
    hostname: "shop-printer",
    name: "Shop printer",
    weight: 0,
    infrastructure: true,
  },
] as const;

/** Meeting days (Monday, Wednesday, Saturday) and their hours, in UTC. */
const MEETING_DAYS = new Set([1, 3, 6]);
const meetingHours = (weekday: number) => (weekday === 6 ? [17, 18, 19, 20, 21] : [22, 23, 0, 1]);

export async function loadDemo(db: EdgeDb, teamId: string) {
  const now = Math.floor(Date.now() / 1000);
  const today = now - (now % (24 * HOUR));
  await db
    .insert(netSettings)
    .values(withTeam(teamId, { capBytes: 50 * GB, cycleStartDay: 1, updatedAt: now }));
  for (const [i, client] of CLIENTS.entries()) {
    await db.insert(netClients).values(
      withTeam(teamId, {
        mac: client.mac,
        hostname: client.hostname,
        displayName: client.name,
        lastIp: `192.168.50.${20 + i}`,
        isInfrastructure: "infrastructure" in client ? 1 : 0,
        firstSeenAt: now - 60 * 24 * HOUR,
        lastSeenAt: now - 2 * HOUR,
      }),
    );
  }

  const rows: Omit<typeof netUsageHourly.$inferInsert, "teamId">[] = [];
  for (let daysAgo = 30; daysAgo >= 1; daysAgo--) {
    const day = today - daysAgo * 24 * HOUR;
    const weekday = new Date(day * 1000).getUTCDay();
    if (!MEETING_DAYS.has(weekday)) continue;
    for (const hour of meetingHours(weekday)) {
      // Hours after midnight UTC belong to the evening before.
      const ts = day + hour * HOUR + (hour < 12 ? 24 * HOUR : 0);
      for (const [i, client] of CLIENTS.entries()) {
        if (client.weight === 0) continue;
        const swing = 1 + ((daysAgo * 7 + hour * 3 + i * 5) % 10) / 10;
        rows.push({
          mac: client.mac,
          ts,
          dlBytes: Math.round(client.weight * 60 * MB * swing),
          ulBytes: Math.round(client.weight * 8 * MB * swing),
        });
      }
    }
  }
  // Fifteen rows a statement: D1 takes at most 100 values in one.
  for (let i = 0; i < rows.length; i += 15) {
    await db
      .insert(netUsageHourly)
      .values(rows.slice(i, i + 15).map((row) => withTeam(teamId, row)));
  }
  return { clients: CLIENTS.length, usage: rows.length };
}

/** The words in the demo's Edge data, for the gateway. */
export const demoWords = (): string[] => vocabularyOf(CLIENTS);
