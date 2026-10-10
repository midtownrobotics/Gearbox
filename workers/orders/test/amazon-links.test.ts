import { mentor, student } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { amazonAsin } from "@g3/worker-orders/product-key";
import { describe, expect, it } from "vitest";

// Amazon's share links (a.co, what the app's Share button copies) hide the ASIN Amazon's carts
// need, so Orders follows them to the product page. The redirects are stubbed in vitest.config.mts.

type Saved = { id: number; url: string; vendor: string };

async function request(url: string, sku: string | null = null) {
  const category = await jsonAs<{ id: number }>(
    mentor,
    "/categories",
    { method: "POST", body: { name: `Amazon ${crypto.randomUUID()}` } },
    201,
  );
  return jsonAs<Saved>(
    student,
    "/requests",
    {
      method: "POST",
      body: {
        url,
        sku,
        title: "WORKPRO LED Pen Light",
        quantity: 1,
        unitPriceCents: 999,
        categoryId: category.id,
        catalogCategory: "Bearings & Bushings",
      },
    },
    201,
  );
}

describe("an Amazon share link", () => {
  it("is saved as the product page it leads to", async () => {
    const saved = await request("https://a.co/d/ok");
    expect(saved.url).toBe("https://www.amazon.com/dp/B0B9MMC59Q");
    expect(saved.vendor).toBe("Amazon");
  });

  it("is saved as it is when it leads nowhere", async () => {
    const saved = await request("https://a.co/d/dead");
    expect(saved.url).toBe("https://a.co/d/dead");
  });
});

describe("an Amazon line's ASIN", () => {
  it("comes from the product link, never a maker's part number", () => {
    expect(amazonAsin({ url: "https://www.amazon.com/x/dp/b0b9mmc59q?th=1", sku: "WP-123" })).toBe(
      "B0B9MMC59Q",
    );
    expect(amazonAsin({ url: "https://a.co/d/ok", sku: "WP-LED-4PK" })).toBeNull();
    expect(amazonAsin({ url: "https://a.co/d/ok", sku: "B0B9MMC59Q" })).toBe("B0B9MMC59Q");
  });
});
