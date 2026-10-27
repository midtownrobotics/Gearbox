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
 * location 2, counted each; 904 is too, counted in ft). Location 404 is one that's gone (Inventory refuses it); 500 is Inventory failing.
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
          ? {
              sourceKey: line.sourceKey,
              itemId: 7,
              itemName: "Known bearing",
              unit: "",
              locationId: 2,
            }
          : line.listing?.catalogItemId === 904
            ? {
                sourceKey: line.sourceKey,
                itemId: 8,
                itemName: "Red wire",
                unit: "ft",
                locationId: 2,
              }
            : {
                sourceKey: line.sourceKey,
                itemId: null,
                itemName: null,
                unit: null,
                locationId: null,
              },
      ),
    });
  }
  return json({ error: `Inventory stub has no ${path}` }, 404);
};

/** Shopify's Storefront API at WCP and AndyMark: one product each, by handle. */
const shopifyProducts: Record<string, Record<string, unknown>> = {
  "wcproducts.com": {
    "wcp-2073": {
      id: "gid://shopify/Product/1",
      title: '0.625" OD Cam Follower (#10-32) (2-Pack)',
      description: "A cam follower.",
      featuredImage: { url: "https://cdn.shopify.com/cam.jpg" },
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/47177230319828",
            title: "Default Title",
            sku: "WCP-2073",
            price: { amount: "7.99", currencyCode: "USD" },
            availableForSale: true,
          },
        ],
      },
    },
  },
  "andymark.com": {
    "fr6zz-bearing": {
      id: "gid://shopify/Product/2",
      title: "3/8 in. Round ID Flanged Shielded Bearing",
      description: "",
      featuredImage: null,
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/11",
            title: "Single",
            sku: "am-0028",
            price: { amount: "2.50", currencyCode: "USD" },
            availableForSale: true,
          },
          {
            id: "gid://shopify/ProductVariant/12",
            title: "Pack of 10",
            sku: "am-0028-10",
            price: { amount: "20.00", currencyCode: "USD" },
            availableForSale: false,
          },
        ],
      },
    },
  },
};

/** REV's product feed: one page with one product, one with two options. */
const revFeed = [
  {
    sku: "REV-11-1107",
    name: "Analog Pressure Sensor",
    availability_status: "Available",
    price: 39.42,
    url: "https://www.revrobotics.com/rev-11-1107/",
    image_url: "https://cdn11.bigcommerce.com/sensor.jpg",
  },
  {
    sku: "REV-31-1407-PK4",
    name: "JST PH 4-pin Sensor Cables ((REV-31-1407-PK4) JST PH 4-pin Sensor Cable - 30cm - 4 Pack)",
    availability_status: "Available",
    price: 7,
    url: "https://www.revrobotics.com/JST-PH-4-pin-Sensor-Cables/",
    image_url: null,
  },
  {
    sku: "REV-31-1408-PK4",
    name: "JST PH 4-pin Sensor Cables ((REV-31-1408-PK4) JST PH 4-pin Sensor Cable - 50cm - 4 Pack)",
    availability_status: "Out of Stock",
    price: 8,
    url: "https://www.revrobotics.com/JST-PH-4-pin-Sensor-Cables/",
    image_url: null,
  },
];

/**
 * The internet, as far as Orders goes: Amazon's share links redirect to a product page (a.co/d/ok
 * to B0B9MMC59Q, through amzn.to once), and a.co/d/dead goes nowhere. WCP's and AndyMark's
 * Storefront APIs know the products above (andymark.com/am-0028 redirects to its page), and REV's
 * feed is `revFeed`. Anything else fails.
 */
const outbound = async (request: Request) => {
  const url = new URL(request.url);
  const store = shopifyProducts[url.hostname.replace(/^www\./, "")];
  if (store && url.pathname.endsWith("/graphql.json") && request.method === "POST") {
    const { variables } = (await request.json()) as { variables: { handle: string } };
    return Response.json({ data: { product: store[variables.handle] ?? null } });
  }
  if (url.hostname === "andymark.com" && url.pathname === "/am-0028") {
    return new Response("", {
      status: 301,
      headers: { location: "https://andymark.com/products/fr6zz-bearing" },
    });
  }
  if (url.href === "https://dashboard.revrobotics.com/feeds/usa/products.json") {
    return Response.json(revFeed);
  }
  const to = (location: string) => new Response("", { status: 301, headers: { location } });
  if (url.hostname === "a.co" && url.pathname === "/d/ok") return to("https://amzn.to/x");
  if (url.hostname === "amzn.to") {
    return to("https://www.amazon.com/WORKPRO-Light/dp/B0B9MMC59Q/ref=share?th=1");
  }
  if (url.hostname === "a.co") return new Response("Not found", { status: 404 });
  return new Response("No network in tests", { status: 502 });
};

export default workerTestConfig({
  outbound,
  d1: "ORDERS_DB",
  // A key for the Share-A-Cart secrets kept in D1 (32 zero bytes).
  vars: { SECRETS_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
  services: { EDGE: offlineService, INVENTORY: inventory },
});
