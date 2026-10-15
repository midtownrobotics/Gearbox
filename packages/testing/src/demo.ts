import { demoTeamId } from "@g3/site-config";
import { expect } from "vitest";
import { type TeamUsers, newTeamId, teamUsers } from "./users";
import { call } from "./worker";

/**
 * The public demo's hooks (roadmap 5.3), the same for every app: its sample data loads for the
 * demo team, loads again after the nightly reset's delete without doubling, is refused for any
 * other team, and the app says the words in it (`GET /internal/demo/words`).
 *
 * `count` reads, as the demo team's users, how many of the app's main things the demo shows.
 */
export async function checkDemoHook(count: (users: TeamUsers) => Promise<number>) {
  const users = teamUsers(demoTeamId);
  const load = () => call(`/internal/teams/${demoTeamId}/demo`, { method: "POST" });
  const wipe = () => call(`/internal/teams/${demoTeamId}`, { method: "DELETE" });

  await wipe();
  const first = await load();
  expect(first.status, await first.clone().text()).toBe(200);
  const shown = await count(users);
  expect(shown).toBeGreaterThan(0);

  await wipe();
  expect((await load()).status).toBe(200);
  expect(await count(users)).toBe(shown);

  const other = await call(`/internal/teams/${newTeamId()}/demo`, { method: "POST" });
  expect(other.status).toBe(403);

  const words = (await (await call("/internal/demo/words")).json()) as { words: string[] };
  expect(Array.isArray(words.words)).toBe(true);
}
