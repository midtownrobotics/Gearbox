import { offlineService, workerTestConfig } from "@g3/testing/config";
import { userFromCookie } from "@g3/testing/users";

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Line = {
  sourceKey?: unknown;
  quantity?: unknown;
  locationId?: unknown;
  listing?: { vendor?: unknown; catalogItemId?: unknown };
};

/** Every delivery the stand-in Inventory has been sent, for tests to look at. */
const sent: Line[] = [];

/**
 * The Inventory worker as Orders uses it: /options lists where parts can go, /intake takes what
 * was received, and /intake/places says where a part is already kept (catalog part 901 is, in
 * location 2). Location 404 is one that's gone (Inventory refuses it); 500 is Inventory failing.
 * /options also gives back what /intake has been sent (`sent`), which Orders passes through to
 * GET /inventory, so a test can check what Orders told Inventory.
 */
const inventory = async (request: Request) => {
  const path = new URL(request.url).pathname;
  if (!userFromCookie(request.headers.get("Cookie") ?? "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  if (path === "/api/options") {
    return json({
      locations: [
        { id: 1, parentId: null, name: "Shop", title: "" },
        { id: 2, parentId: 1, name: "Bin 2", title: "Bearings" },
        { id: 3, parentId: 1, name: "Bin 3", title: "" },
      ],
      robots: [{ id: 1, name: "Comp bot" }],
      subsystems: [{ id: 1, name: "Drivetrain" }],
      sent,
    });
  }
  if (path === "/api/intake" && request.method === "POST") {
    const body = (await request.json()) as {
      destination: { locationId?: number };
      lines: Line[];
    };
    const places = body.lines.map((line) => line.locationId ?? body.destination.locationId);
    if (places.some((id) => typeof id !== "number") || places.includes(404)) {
      return json({ error: "Pick a location." }, 400);
    }
    if (places.includes(500)) return json({ error: "Internal server error." }, 500);
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
  if (path === "/api/intake/places" && request.method === "POST") {
    const body = (await request.json()) as { lines: Line[] };
    return json({
      places: body.lines.map((line) =>
        line.listing?.catalogItemId === 901
          ? { sourceKey: line.sourceKey, itemId: 7, itemName: "Known bearing", locationId: 2 }
          : { sourceKey: line.sourceKey, itemId: null, itemName: null, locationId: null },
      ),
    });
  }
  return json({ error: `Inventory stub has no ${path}` }, 404);
};

export default workerTestConfig({
  d1: "ORDERS_DB",
  services: { EDGE: offlineService, INVENTORY: inventory },
});
