import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every call to Onshape is counted for the team (lib/onshape-api.ts): the Admin page's usage, and
// the banner under the bar while Onshape refuses the team's calls.

type Status = {
  hasApiKey: boolean;
  problem: { kind: string; status: number; message: string | null; label: string } | null;
};
type Usage = {
  today: string;
  keys: { onlyCurrent: boolean; currentSince: string | null; others: number };
  days: { day: string; kind: string; calls: number; errors: number }[];
  errors: { kind: string; status: number; message: string | null }[];
};

/** Answers Onshape's API by path: a status and a JSON body. */
function onshapeAnswers(answer: (url: string, method: string) => [number, unknown]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const [status, body] = answer(url, init?.method ?? "GET");
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

const saveKeys = (team: ReturnType<typeof teamUsers>, apiKey = "key") =>
  callAs(team.admin, "/admin/onshape/config", {
    method: "POST",
    body: { documentId: "doc1", companyId: "co1", apiKey, apiSecret: "secret" },
  });

const callCount = (usage: Usage) => usage.days.reduce((n, d) => n + d.calls, 0);

afterEach(() => vi.unstubAllGlobals());

describe("Onshape API usage", () => {
  it("says when the team has no API key", async () => {
    const team = teamUsers(newTeamId());
    expect(await jsonAs<Status>(team.student, "/onshape/status")).toEqual({
      hasApiKey: false,
      problem: null,
    });
  });

  it("counts each call by kind, and shows the limit until a call works again", async () => {
    const team = teamUsers(newTeamId());
    onshapeAnswers((url, method) =>
      url.includes("/webhooks") && method === "POST"
        ? [429, { message: "API limit reached", status: 429 }]
        : [200, { items: [] }],
    );
    expect((await saveKeys(team)).status).toBe(200);

    const usage = await jsonAs<Usage>(team.admin, "/admin/onshape/usage");
    const today = usage.days.filter((d) => d.day === usage.today);
    expect(today).toEqual(
      expect.arrayContaining([
        { day: usage.today, kind: "webhook_list", calls: 1, errors: 0 },
        { day: usage.today, kind: "webhook_create", calls: 1, errors: 1 },
      ]),
    );
    expect(usage.errors).toEqual([
      expect.objectContaining({
        kind: "webhook_create",
        status: 429,
        message: "API limit reached",
      }),
    ]);

    // Every member sees it, so they know why drawings and releases stop.
    const status = await jsonAs<Status>(team.student, "/onshape/status");
    expect(status).toMatchObject({
      hasApiKey: true,
      problem: { kind: "webhook_create", status: 429, label: "Register the webhook" },
    });

    // A call that works clears it.
    onshapeAnswers(() => [200, {}]);
    expect(await jsonAs(team.admin, "/admin/onshape/check", { method: "POST", body: {} })).toEqual({
      ok: true,
      status: 200,
    });
    expect((await jsonAs<Status>(team.student, "/onshape/status")).problem).toBeNull();
  });

  it("leaves a failure about one item out of the banner", async () => {
    const team = teamUsers(newTeamId());
    onshapeAnswers(() => [200, { items: [] }]);
    await saveKeys(team);
    onshapeAnswers(() => [404, { message: "Not found" }]);
    await jsonAs(team.admin, "/admin/onshape/check", { method: "POST", body: {} });
    expect((await jsonAs<Status>(team.student, "/onshape/status")).problem).toBeNull();
    const usage = await jsonAs<Usage>(team.admin, "/admin/onshape/usage");
    expect(usage.errors[0]).toMatchObject({ kind: "connection_check", status: 404 });
  });

  it("is the team's own, and only admins see the details", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    onshapeAnswers(() => [401, { message: "Unauthenticated" }]);
    await saveKeys(a);
    expect((await jsonAs<Status>(a.student, "/onshape/status")).problem?.status).toBe(401);
    expect((await jsonAs<Status>(b.student, "/onshape/status")).problem).toBeNull();
    expect((await jsonAs<Usage>(b.admin, "/admin/onshape/usage")).days).toEqual([]);
    expect((await callAs(a.mentor, "/admin/onshape/usage")).status).toBe(403);
    expect((await callAs(a.student, "/admin/onshape/check", { method: "POST" })).status).toBe(403);
  });

  it("counts new keys on their own, with the old keys' calls still under all keys", async () => {
    const team = teamUsers(newTeamId());
    onshapeAnswers(() => [429, { message: "API limit reached" }]);
    await saveKeys(team, "old-key");
    expect((await jsonAs<Status>(team.student, "/onshape/status")).problem?.status).toBe(429);
    const old = await jsonAs<Usage>(team.admin, "/admin/onshape/usage");

    // New keys start with no calls of their own, and the old keys' failure isn't theirs.
    onshapeAnswers(() => [200, { items: [] }]);
    await saveKeys(team, "new-key");
    expect((await jsonAs<Status>(team.student, "/onshape/status")).problem).toBeNull();
    const mine = await jsonAs<Usage>(team.admin, "/admin/onshape/usage");
    expect(mine.keys).toEqual({ onlyCurrent: true, currentSince: mine.today, others: 1 });
    expect(mine.errors).toEqual([]);

    const all = await jsonAs<Usage>(team.admin, "/admin/onshape/usage?keys=all");
    expect(all.keys.onlyCurrent).toBe(false);
    expect(callCount(all)).toBe(callCount(old) + callCount(mine));
    expect(all.errors.length).toBe(old.errors.length);
  });
});
