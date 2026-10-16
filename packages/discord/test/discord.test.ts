import { describe, expect, it } from "vitest";
import { authorizeUrl, isDiscordId, splitMessage } from "../src/index";

describe("splitMessage", () => {
  it("keeps a short message whole", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("splits a long message at line breaks", () => {
    const line = "x".repeat(900);
    const pieces = splitMessage([line, line, line].join("\n"));
    expect(pieces).toEqual([`${line}\n${line}`, line]);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(2000);
  });

  it("splits a message with no breaks at the limit", () => {
    const pieces = splitMessage("y".repeat(4500));
    expect(pieces.map((p) => p.length)).toEqual([2000, 2000, 500]);
  });
});

describe("isDiscordId", () => {
  it("takes Discord's numeric ids and not Slack's", () => {
    expect(isDiscordId("123456789012345678")).toBe(true);
    expect(isDiscordId("C0123ABCD")).toBe(false);
    expect(isDiscordId("123")).toBe(false);
  });
});

describe("authorizeUrl", () => {
  it("asks for the bot and its permissions only when installing", () => {
    const signIn = new URL(
      authorizeUrl({ DISCORD_CLIENT_ID: "1" }, { redirectUri: "https://x.test/cb", state: "s" }),
    );
    expect(signIn.searchParams.get("scope")).toBe("identify email");
    expect(signIn.searchParams.get("permissions")).toBeNull();
    const install = new URL(
      authorizeUrl(
        { DISCORD_CLIENT_ID: "1" },
        { redirectUri: "https://x.test/cb", state: "s", install: true },
      ),
    );
    expect(install.searchParams.get("scope")).toBe("bot applications.commands identify email");
    expect(install.searchParams.get("permissions")).toBe("3072");
  });
});
