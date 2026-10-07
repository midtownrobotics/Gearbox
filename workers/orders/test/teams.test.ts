import { env } from "cloudflare:test";
import { newTeamId, student, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { fiscalLabel, fiscalRange, fiscalYearOf } from "../src/lib/fiscal";

// What each team has of its own in Orders (roadmap Phase 3): its settings (fiscal year, money), its
// copy of the starter catalog, and approval messages on its own Slack. Dates are the viewer's local
// time, which the app sends with every call.

const database = (env as unknown as { ORDERS_DB: D1Database }).ORDERS_DB;
const g3id = (env as unknown as { G3ID: Fetcher }).G3ID;

type Me = { currency: string; fiscalYearStart: number };
type Catalog = {
  categories: string[];
  items: { id: number; name: string; priceCents: number | null; requestCount: number }[];
};

const starterCount = async () =>
  (
    await database
      .prepare("SELECT count(*) AS n FROM catalog_items WHERE team_id = 'starter'")
      .first<{ n: number }>()
  )?.n ?? 0;

describe("fiscal years", () => {
  const eastern = { startMonth: 7, timeZone: "America/New_York" };
  const auckland = { startMonth: 1, timeZone: "Pacific/Auckland" };

  it("start at midnight on the 1st of the team's month, in the viewer's time zone", () => {
    // As they always were for G3: July 1, midnight Eastern (EDT).
    expect(fiscalRange(2026, eastern)).toEqual([Date.UTC(2026, 6, 1, 4), Date.UTC(2027, 6, 1, 4)]);
    // January 1 in Auckland is still December 31 in UTC (NZDT, UTC+13).
    expect(fiscalRange(2026, auckland)).toEqual([
      Date.UTC(2025, 11, 31, 11),
      Date.UTC(2026, 11, 31, 11),
    ]);
  });

  it("are named by the year they start", () => {
    expect(fiscalYearOf(Date.UTC(2027, 5, 30, 12), eastern)).toBe(2026);
    expect(fiscalYearOf(Date.UTC(2027, 6, 1, 12), eastern)).toBe(2027);
    expect(fiscalYearOf(Date.UTC(2025, 11, 31, 12), auckland)).toBe(2026);
    expect(fiscalLabel(2026, 7)).toBe("2026–27");
    expect(fiscalLabel(2026, 1)).toBe("2026");
  });
});

describe("a team's settings", () => {
  it("are G3's as they were in code, and a new team's defaults", async () => {
    expect(await jsonAs<Me>(student, "/me")).toMatchObject({
      currency: "USD",
      fiscalYearStart: 7,
    });
    const team = teamUsers(newTeamId());
    expect(await jsonAs<Me>(team.student, "/me")).toMatchObject({
      currency: "USD",
      fiscalYearStart: 7,
    });
  });

  it("are a mentor's to change, for their own team only", async () => {
    const team = teamUsers(newTeamId());
    const other = teamUsers(newTeamId());
    const put = (user: typeof student, body: unknown) =>
      callAs(user, "/settings", { method: "PUT", body });
    const change = { currency: "cad", fiscalYearStart: 9 };
    expect((await put(team.student, change)).status).toBe(403);
    expect((await put(team.kioskAdmin, change)).status).toBe(403);
    expect((await put(team.mentor, { currency: "dollars" })).status).toBe(400);
    expect((await put(team.mentor, { fiscalYearStart: 13 })).status).toBe(400);

    expect(await jsonAs(team.mentor, "/settings", { method: "PUT", body: change })).toMatchObject({
      currency: "CAD",
      fiscalYearStart: 9,
    });
    expect(await jsonAs<Me>(team.student, "/me")).toMatchObject({ currency: "CAD" });
    expect(await jsonAs<Me>(other.student, "/me")).toMatchObject({ currency: "USD" });
  });

  it("give new requests the team's currency", async () => {
    const team = teamUsers(newTeamId());
    await jsonAs(team.mentor, "/settings", { method: "PUT", body: { currency: "EUR" } });
    const category = await jsonAs<{ id: number }>(
      team.mentor,
      "/categories",
      { method: "POST", body: { name: "Parts" } },
      201,
    );
    const [catalogCategory] = (await jsonAs<Catalog>(team.student, "/catalog")).categories;
    const request = await jsonAs<{ currency: string }>(
      team.student,
      "/requests",
      {
        method: "POST",
        body: {
          url: `https://example.com/products/${crypto.randomUUID()}`,
          title: "Bearing",
          quantity: 2,
          categoryId: category.id,
          reason: "Spares",
          catalogCategory,
        },
      },
      201,
    );
    expect(request.currency).toBe("EUR");
  });
});

describe("dates", () => {
  it("are in the local time of whoever asks", async () => {
    const team = teamUsers(newTeamId());
    const category = await jsonAs<{ id: number }>(
      team.mentor,
      "/categories",
      { method: "POST", body: { name: "Parts" } },
      201,
    );
    const [catalogCategory] = (await jsonAs<Catalog>(team.student, "/catalog")).categories;
    const request = await jsonAs<{ id: number }>(
      team.student,
      "/requests",
      {
        method: "POST",
        body: {
          url: `https://example.com/products/${crypto.randomUUID()}`,
          title: "Bearing",
          quantity: 1,
          categoryId: category.id,
          reason: "Spares",
          catalogCategory,
        },
      },
      201,
    );
    await jsonAs(team.mentor, `/requests/${request.id}/approve`, { method: "POST", body: {} });
    await jsonAs(team.mentor, "/orders", {
      method: "POST",
      body: { vendor: "WCP", lines: [{ requestId: request.id, quantity: 1, unitPriceCents: 100 }] },
    });
    // UTC+14 and UTC−11 are always on different dates.
    const exported = async (zone: string) => {
      const res = await callAs(team.mentor, "/orders/export.csv", {
        headers: { "X-Time-Zone": zone },
      });
      return (await res.text()).split("\r\n")[1];
    };
    const ahead = await exported("Pacific/Kiritimati");
    const behind = await exported("Pacific/Pago_Pago");
    const placed = (row: string) => row.split(",")[9];
    expect(placed(ahead)).toBe(
      new Date().toLocaleDateString("en-US", { timeZone: "Pacific/Kiritimati" }),
    );
    expect(placed(behind)).toBe(
      new Date().toLocaleDateString("en-US", { timeZone: "Pacific/Pago_Pago" }),
    );
    // No zone, or one that isn't: UTC.
    expect(placed(await exported("Not/AZone"))).toBe(
      new Date().toLocaleDateString("en-US", { timeZone: "UTC" }),
    );
  });
});

describe("the starter catalog", () => {
  it("is copied to a team the first time it opens Orders, without anyone's prices", async () => {
    const team = teamUsers(newTeamId());
    const catalog = await jsonAs<Catalog>(team.student, "/catalog");
    expect(catalog.items.length).toBe(await starterCount());
    expect(catalog.items.length).toBeGreaterThan(1000);
    expect(catalog.categories.length).toBeGreaterThan(10);
    expect(catalog.items.every((i) => i.priceCents === null && i.requestCount === 0)).toBe(true);
    // Families come along, pointing at the team's own.
    const families = await database
      .prepare(
        `SELECT count(*) AS n FROM catalog_items i JOIN catalog_families f ON f.id = i.family_id
         WHERE i.team_id = ? AND f.team_id <> i.team_id`,
      )
      .bind(team.teamId)
      .first<{ n: number }>();
    expect(families?.n).toBe(0);
  });

  it("is copied once, even when the team's first requests arrive together", async () => {
    const team = teamUsers(newTeamId());
    await Promise.all([
      jsonAs(team.student, "/catalog"),
      jsonAs(team.mentor, "/catalog/categories"),
      jsonAs(team.admin, "/me"),
    ]);
    const copied = await database
      .prepare("SELECT count(*) AS n FROM catalog_items WHERE team_id = ?")
      .bind(team.teamId)
      .first<{ n: number }>();
    expect(copied?.n).toBe(await starterCount());
  });

  it("is the team's own: its edits stay with it", async () => {
    const team = teamUsers(newTeamId());
    const other = teamUsers(newTeamId());
    const [part] = (await jsonAs<Catalog>(team.mentor, "/catalog")).items;
    await jsonAs(team.mentor, `/catalog/items/${part.id}`, {
      method: "PATCH",
      body: { name: "Our name for it" },
    });
    const theirs = (await jsonAs<Catalog>(other.student, "/catalog")).items;
    expect(theirs.some((i) => i.name === "Our name for it")).toBe(false);
    expect(theirs.some((i) => i.id === part.id)).toBe(false);
    // Another team's part id isn't one this team can edit.
    expect(
      (
        await callAs(other.mentor, `/catalog/items/${part.id}`, {
          method: "PATCH",
          body: { name: "Theirs now" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("approval messages", () => {
  it("go out on the requester's team's Slack", async () => {
    const team = teamUsers(newTeamId());
    const requester = {
      ...team.student,
      identities: [{ provider: "slack", providerId: "U0TEST" }],
    };
    const category = await jsonAs<{ id: number }>(
      team.mentor,
      "/categories",
      { method: "POST", body: { name: "Parts" } },
      201,
    );
    const [catalogCategory] = (await jsonAs<Catalog>(team.student, "/catalog")).categories;
    const request = await jsonAs<{ id: number }>(
      requester,
      "/requests",
      {
        method: "POST",
        body: {
          url: `https://example.com/products/${crypto.randomUUID()}`,
          title: "Hex bearing",
          quantity: 1,
          categoryId: category.id,
          reason: "Drivetrain",
          catalogCategory,
        },
      },
      201,
    );
    await jsonAs(team.mentor, `/requests/${request.id}/approve`, { method: "POST", body: {} });
    const sent = async () =>
      (await (
        await g3id.fetch(`http://g3id/api/internal/teams/${team.teamId}/slack/dms`)
      ).json()) as { slackUserId: string; text: string }[];
    // Sent after the answer (waitUntil).
    for (let i = 0; i < 20 && (await sent()).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const [dm] = await sent();
    expect(dm.slackUserId).toBe("U0TEST");
    expect(dm.text).toContain("Hex bearing");
    expect(dm.text).toContain(`${team.teamId.replace("frc", "")}-orders.`);
  });
});

describe("Share-A-Cart", () => {
  it("keeps the team's tokens encrypted, and encrypts ones saved before that", async () => {
    const team = teamUsers(newTeamId());
    const auth = {
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      expiresAt: Date.now() + 3_600_000,
      connectedBy: "Mentor",
      connectedAt: 1,
    };
    // As a connection saved before encryption: plain JSON.
    await database
      .prepare("INSERT INTO app_settings (team_id, key, value) VALUES (?, 'sac_auth', ?)")
      .bind(team.teamId, JSON.stringify(auth))
      .run();
    expect(await jsonAs(team.student, "/share-a-cart/status")).toMatchObject({
      connected: true,
      connectedBy: "Mentor",
    });
    const stored = await database
      .prepare("SELECT value FROM app_settings WHERE team_id = ? AND key = 'sac_auth'")
      .bind(team.teamId)
      .first<{ value: string }>();
    expect(stored?.value).not.toContain("secret-");
    // Still reads as the same connection.
    expect(await jsonAs(team.student, "/share-a-cart/status")).toMatchObject({
      connected: true,
      connectedBy: "Mentor",
    });
    // Another team doesn't see it.
    expect(await jsonAs(teamUsers(newTeamId()).student, "/share-a-cart/status")).toMatchObject({
      connected: false,
    });
  });
});
