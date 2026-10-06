import { afterEach, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { lookupPart, meterLookups } from "./part-lookup";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  meterLookups(null);
});

/** Serves `html` for every request, like a single product page. */
function servePage(html: string) {
  globalThis.fetch = (async () =>
    new Response(html, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
}

const price = (cls: string, text: string) =>
  `<span class="a-price ${cls}"><span class="a-offscreen">${text}</span><span aria-hidden="true"><span class="a-price-whole">${text.replace(/^\$|\.\d+$/g, "")}<span class="a-price-decimal">.</span></span><span class="a-price-fraction">${text.split(".")[1] ?? ""}</span></span></span>`;

// Same order as the real page: the buy-box accordion comes before the desktop price block.
const amazonPage = (desktop: string, accordion: string) => `<html><body>
  <span id="productTitle"> Duck Brand Max Strength Duct Tape - 2 Rolls </span>
  <div id="corePrice_feature_div">${accordion}</div>
  <div id="corePriceDisplay_desktop_feature_div">${desktop}</div>
</body></html>`;

describe("amazon price", () => {
  test("takes the price to pay, not the per-unit or list price", async () => {
    // As on B09WJWTW6J: the desktop price-to-pay is empty, then "$0.05 / foot" and a $19.98 list price.
    servePage(
      amazonPage(
        `${price("priceToPay", " ")}${price("a-text-price apex-priceperunit-value", "$0.05")}${price("a-text-price apex-basisprice-value", "$19.98")}`,
        `${price("apex-pricetopay-value", "$13.58")}${price("a-text-price apex-priceperunit-value", "$0.05")}`,
      ),
    );
    const result = await lookupPart("https://www.amazon.com/dp/B09WJWTW6J?th=1");
    expect(result.price).toBe(13.58);
    expect(result.title).toBe("Duck Brand Max Strength Duct Tape - 2 Rolls");
  });

  test("ignores per-unit prices when they come first", async () => {
    servePage(
      amazonPage(
        `${price("a-text-price apex-priceperunit-value", "$0.09")}${price("priceToPay", "$48.97")}`,
        "",
      ),
    );
    expect((await lookupPart("https://www.amazon.com/dp/B000000000")).price).toBe(48.97);
  });
});

describe("data metering", () => {
  test("counts compressed bytes on the wire and still parses the page", async () => {
    const page = amazonPage("", price("apex-pricetopay-value", "$13.58")) + " ".repeat(50_000);
    const gz = gzipSync(page);
    let requested: RequestInit | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requested = init;
      return new Response(gz, {
        headers: { "content-type": "text/html", "content-encoding": "gzip" },
      });
    }) as unknown as typeof fetch;
    const usage = { dl: 0, ul: 0 };
    meterLookups((dl, ul) => {
      usage.dl += dl;
      usage.ul += ul;
    });

    const result = await lookupPart("https://www.amazon.com/dp/B09WJWTW6J");
    expect(result.price).toBe(13.58);
    expect((requested as { decompress?: boolean }).decompress).toBe(false);
    // Compressed body plus headers: far below the 50 KB+ the page is once decompressed.
    expect(usage.dl).toBeGreaterThan(gz.length);
    expect(usage.dl).toBeLessThan(gz.length + 500);
    expect(usage.ul).toBeGreaterThan(50);
  });
});

describe("shopify linked options (Itoris Dynamic Product Options)", () => {
  test("lists the linked products a placeholder product's dropdowns stand for", async () => {
    const item = (title: string, ids: string, sku: string, price: number, salable: number) =>
      `{"title":${JSON.stringify(title)},"sku":"${ids}","sku_is_product_id_linked":1,"product_sku":"${sku}","price":${price},"is_salable":${salable}}`;
    const options = `[{"title":"Aluminum Tube Plugs (New)","items":[${item('1"x1"x.062" Tube Plug', "11:111", "WCP-2066", 5.99, 1)},${item('2"x2"x.125" Tube Plug', "12:122", "WCP-2107", 7.99, 0)}]},{"title":"Bundles","items":[${item("Tube Plug Bundle", "13:133", "BND-0007", 499.99, 1)}]}]`;
    const requested: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      requested.push(url);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (url.includes("/products/tube-plugs.json")) {
        return json({
          product: {
            id: 6853378736288,
            title: "Tube Plugs",
            variants: [{ id: 1, title: "Default Title", price: "2.49" }],
          },
        });
      }
      if (url.endsWith("/meta.json"))
        return json({ myshopify_domain: "wcp-robotics.myshopify.com" });
      if (url.startsWith("https://node1.itoris.com/")) {
        return new Response(
          `<div></div><script>window.dpoOptions.initialize({"form_style":"table_sections","extra_js":""}, ${options}); </script>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await lookupPart(
      "https://wcproducts.com/collections/cnc-hardware/products/tube-plugs",
    );
    expect(result.source).toBe("shopify");
    expect(result.title).toBe("Tube Plugs");
    expect(result.price).toBeUndefined(); // The placeholder's own $2.49 isn't a real price.
    expect(result.variants).toEqual([
      {
        id: "111",
        title: 'Aluminum Tube Plugs (New): 1"x1"x.062" Tube Plug',
        sku: "WCP-2066",
        price: 5.99,
        available: true,
      },
      {
        id: "122",
        title: 'Aluminum Tube Plugs (New): 2"x2"x.125" Tube Plug',
        sku: "WCP-2107",
        price: 7.99,
        available: false,
      },
      {
        id: "133",
        title: "Bundles: Tube Plug Bundle",
        sku: "BND-0007",
        price: 499.99,
        available: true,
      },
    ]);
    expect(requested.some((u) => u.includes("shop=wcp-robotics.myshopify.com"))).toBe(true);
  });
});
