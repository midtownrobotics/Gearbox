import { describe, expect, it } from "vitest";
import { toSlack } from "../src/index";

describe("toSlack", () => {
  it("turns links and bold into Slack's mrkdwn", () => {
    expect(toSlack("**Approved:** [Side Plate](https://x.test/r/1?a=1&b=2) ✅")).toBe(
      "*Approved:* <https://x.test/r/1?a=1&b=2|Side Plate> ✅",
    );
  });

  it("escapes what Slack would read as markup", () => {
    expect(toSlack("1 < 2 & 3 > 2 <!channel>")).toBe("1 &lt; 2 &amp; 3 &gt; 2 &lt;!channel&gt;");
  });

  it("keeps a pipe in a label from ending it", () => {
    expect(toSlack("[a|b](https://x.test)")).toBe("<https://x.test|a/b>");
  });

  it("shows a time in each reader's own zone", () => {
    expect(toSlack("Time: <t:1700000000:f>")).toBe(
      "Time: <!date^1700000000^{date_num} {time_secs}|2023-11-14T22:13:20Z>",
    );
  });

  it("leaves plain text alone", () => {
    expect(toSlack("Plain text\nwith lines")).toBe("Plain text\nwith lines");
  });
});
