import { offlineService, workerTestConfig } from "@g3/testing/config";
import { userFromCookie } from "@g3/testing/users";

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Line = { sourceKey?: unknown; quantity?: unknown; listing?: { vendor?: unknown } };

/** Every delivery the stand-in Inventory has been sent, for tests to look at. */
const sent: Line[] = [];

/**
 * The Inventory worker as Orders uses it: /options lists where parts can go, and /intake takes
 * what was received. Location 404 is one that's gone (Inventory refuses it); 500 is Inventory
 * failing. /options also gives back what /intake has been sent (`sent`), which Orders passes
 * through to GET /inventory, so a test can check what Orders told Inventory.
 */
const inventory = async (request: Request) => {
  const path = new URL(request.url).pathname;
  if (!userFromCookie(request.headers.get("Cookie") ?? "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  if (path === "/api/options") {
    return json({
      locations: [
        { id: 1, parentId: null, name: "Shop" },
        { id: 2, parentId: 1, name: "Bin 2" },
      ],
      robots: [{ id: 1, name: "Comp bot" }],
      subsystems: [{ id: 1, name: "Drivetrain" }],
      sent,
    });
  }
  if (path === "/api/intake" && request.method === "POST") {
    const body = (await request.json()) as {
      destination: { locationId: number };
      lines: Line[];
    };
    if (body.destination.locationId === 404) return json({ error: "Pick a location." }, 400);
    if (body.destination.locationId === 500) return json({ error: "Internal server error." }, 500);
    const bad = body.lines.some(
      (line) =>
        typeof line.sourceKey !== "string" ||
        !/^orders:request:\d+$/.test(line.sourceKey) ||
        !(typeof line.quantity === "number" && line.quantity >= 1) ||
        typeof line.listing?.vendor !== "string",
    );
    if (bad || body.lines.length > 50) return json({ error: "Not what Inventory takes." }, 422);
    const added = body.lines.map((line) => ({
      sourceKey: line.sourceKey,
      itemId: 1,
      created: false,
      duplicate: sent.some((before) => before.sourceKey === line.sourceKey),
    }));
    sent.push(...body.lines);
    return json({ added });
  }
  return json({ error: `Inventory stub has no ${path}` }, 404);
};

export default workerTestConfig({
  d1: "ORDERS_DB",
  services: { EDGE: offlineService, INVENTORY: inventory },
});
