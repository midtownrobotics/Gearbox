import { describe, expect, it } from "vitest";
import { linkKindOf } from "../src/lib/catalog";

// Whether a link is a product page, a search or a homepage decides how the catalog keeps it.

describe("link kinds", () => {
  it("knows product pages, even with search tracking from where they were found", () => {
    for (const url of [
      "https://www.revrobotics.com/rev-21-1650/",
      "https://www.revrobotics.com/.5in-Hex-Shaft-Spacers/?searchid=5205485&search_query=Spacers",
      "https://www.amazon.com/GE-Extension/dp/B082JHB9PP/ref=sxin_15?keywords=10ft%2Bsurge&qid=1",
      "https://wcproducts.com/products/wcp-1018?_pos=1&_sid=a8de656&_ss=r",
      "https://a.co/d/fLhD0FK",
    ]) {
      expect(linkKindOf(url), url).toBe("product");
    }
  });

  it("knows search pages", () => {
    for (const url of [
      "https://www.revrobotics.com/search.php?search_query=spacer",
      "https://wcproducts.com/search?q=gear",
      "https://www.amazon.com/s?k=surge+protector",
      "https://www.mcmaster.com/?q=91251A352",
    ]) {
      expect(linkKindOf(url), url).toBe("search");
    }
  });

  it("knows home pages", () => {
    expect(linkKindOf("https://www.andymark.com/")).toBe("homepage");
  });
});
