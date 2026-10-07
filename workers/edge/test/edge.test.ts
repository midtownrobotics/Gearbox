import { admin, kioskAdmin, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Edge: the dashboard uses G3ID (admins change things); the team's edge box uses its own key,
// made by an admin on the Edge Box page (POST /box/key).

let AGENT_KEY = "";
beforeAll(async () => {
  AGENT_KEY = (await jsonAs<{ key: string }>(admin, "/box/key", { method: "POST" }, 201)).key;
});
const agent = (path: string, init: RequestInit = {}) =>
  call(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${AGENT_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

describe("dashboard sign-in and roles", () => {
  it("needs a G3ID session", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/network/overview")).status).toBe(401);
    expect(await jsonAs(student, "/me")).toMatchObject({ userId: student.id, isAdmin: false });
  });

  it("keeps per-site browsing data and blocking controls to admins", async () => {
    for (const path of ["/network/sites", "/network/control"]) {
      expect((await callAs(student, path)).status).toBe(403);
      expect((await callAs(kioskAdmin, path)).status).toBe(403);
      expect((await callAs(admin, path)).status).toBe(200);
    }
  });
});

describe("agent key", () => {
  it("records the box's public address from its uploads, and when it changed", async () => {
    const checkIn = (ip: string) =>
      agent("/agent/network/state", {
        headers: {
          "X-G3-Agent-Version": "test",
          "X-G3-Agent-Started": "1000",
          "CF-Connecting-IP": ip,
        },
      });
    type Status = { agent: { publicIp: string | null; publicIpSince: number | null } | null };
    const publicIp = async (ip: string) =>
      vi.waitFor(async () => {
        const { agent } = await jsonAs<Status>(student, "/status");
        expect(agent?.publicIp).toBe(ip);
        return agent?.publicIpSince;
      });

    await checkIn("198.51.100.7");
    const since = await publicIp("198.51.100.7");
    expect(since).toBeTypeOf("number");
    // The same address again keeps its "since"; a new one starts over.
    await checkIn("198.51.100.7");
    expect(await publicIp("198.51.100.7")).toBe(since);
    await checkIn("203.0.113.9");
    expect(await publicIp("203.0.113.9")).toBeGreaterThanOrEqual(since as number);
  });

  it("rejects a missing or wrong key", async () => {
    expect((await call("/agent/network/state")).status).toBe(401);
    const wrong = await call("/agent/network/state", { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
    // A G3ID session isn't the agent either.
    expect((await callAs(admin, "/agent/network/state")).status).toBe(401);
  });

  it("gives the agent the blocking state an admin set", async () => {
    const before = (await (await agent("/agent/network/state")).json()) as { version: number };
    const created = await callAs(admin, "/network/control/blocklists", {
      method: "POST",
      body: { name: "Games", action: "block", enabled: true, domains: ["Example-Games.com"] },
    });
    expect(created.status).toBeLessThan(300);

    const res = await agent("/agent/network/state");
    expect(res.status).toBe(200);
    const state = (await res.json()) as {
      version: number;
      blocklists: { action: string; domains: string[] }[];
    };
    expect(state.version).toBeGreaterThan(before.version);
    expect(state.blocklists).toEqual([
      expect.objectContaining({ action: "block", domains: ["example-games.com"] }),
    ]);
    expect(res.headers.get("X-G3-State-Version")).toBe(String(state.version));
  });

  it("rejects bad blocklists", async () => {
    const res = await callAs(admin, "/network/control/blocklists", {
      method: "POST",
      body: { name: "Bad", action: "block", enabled: true, domains: ["not a domain"] },
    });
    expect(res.status).toBe(400);
  });

  it("stores usage the agent pushes, and replays don't double-count", async () => {
    const bucket = Math.floor(Date.now() / 1000 / 300) * 300;
    const batch = {
      samples: [[bucket, "aa:bb:cc:dd:ee:ff", 1000, 200]],
      clients: [{ mac: "aa:bb:cc:dd:ee:ff", hostname: "robot-laptop", ip: "192.168.50.20" }],
    };
    for (let i = 0; i < 2; i++) {
      const res = await agent("/agent/network/usage", {
        method: "POST",
        body: JSON.stringify(batch),
      });
      expect(res.status).toBe(200);
    }
    const clients = await jsonAs<{ mac: string }[] | { clients: { mac: string }[] }>(
      student,
      "/network/clients",
    );
    expect(JSON.stringify(clients)).toContain("aa:bb:cc:dd:ee:ff");
    // No edge box in tests: the list still loads, without online status.
    const list = await jsonAs<{
      presence: { available: boolean; error: string | null };
      clients: { mac: string; online: boolean | null }[];
    }>(student, "/network/clients");
    expect(list.presence.available).toBe(false);
    expect(list.presence.error).toBeTruthy();
    expect(list.clients.find((c) => c.mac === "aa:bb:cc:dd:ee:ff")?.online).toBeNull();
    expect(
      (
        await agent("/agent/network/usage", {
          method: "POST",
          body: JSON.stringify({ samples: "x" }),
        })
      ).status,
    ).toBe(400);
  });
});
