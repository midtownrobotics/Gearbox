// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { type StorageCleanupMode, notifyStorageUsage, withStorageLimit } from "@g3/auth";
import { newTeamId } from "@g3/testing/users";
import { describe, expect, it, vi } from "vitest";
import { shopStorageEviction } from "../src/lib/storage-limit";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"];
const budget = { bytes: 100, objects: 100, label: "test allowance" };
async function policy(team: string, automaticDeletion: boolean) {
  await bindings.G3ID.fetch(`http://g3id/api/internal/teams/${team}/storage-policy`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ automaticDeletion }),
  });
}
describe("storage policy enforcement", () => {
  it("warns once at 90/95/100 in keep-files mode and does not restart warnings on mode changes", async () => {
    const team = newTeamId();
    const messages: string[] = [];
    const G3ID = {
      fetch: async (request: Request) => {
        if (request.url.endsWith("/members"))
          return Response.json([{ id: "admin", status: "active", isAdmin: true }]);
        if (request.url.endsWith("/chat/dm-members"))
          messages.push(((await request.json()) as { text: string }).text);
        return Response.json({ ok: true, sent: 1 });
      },
    } as Fetcher;
    const warn = (count: number, mode: StorageCleanupMode = "block-uploads") =>
      notifyStorageUsage(
        { G3ID },
        team,
        "shop",
        "files",
        bindings.SHOP_DB,
        { bytes: 0, count },
        { count: 100 },
        false,
        mode,
      );
    for (const count of [90, 95, 100, 100, 95]) await warn(count);
    expect(messages).toHaveLength(3);
    expect(
      messages.every(
        (text) =>
          text.includes("Automatic deletion is off") &&
          text.includes("uploads that exceed this allowance are blocked"),
      ),
    ).toBe(true);
    await warn(100, "delete-oldest");
    await warn(100);
    expect(messages).toHaveLength(3);
    await warn(84);
    await warn(90);
    expect(messages).toHaveLength(4);
  });
  it("keeps all old files at capacity with cleanup off and observes later changes without cached permission", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    const eviction = shopStorageEviction(bindings, team);
    await bindings.DRAWINGS.put(`${prefix}existing`, "x".repeat(100));
    await policy(team, false);
    const write = vi.fn(() => bindings.DRAWINGS.put(`${prefix}new`, "x".repeat(10)));
    await expect(
      withStorageLimit(
        bindings.SHOP_DB,
        bindings.DRAWINGS,
        team,
        prefix,
        [{ key: `${prefix}new`, bytes: 10 }],
        budget,
        write,
        eviction,
      ),
    ).rejects.toMatchObject({ code: "storage_full" });
    expect(write).not.toHaveBeenCalled();
    expect((await bindings.DRAWINGS.head(`${prefix}existing`))?.size).toBe(100);
    await policy(team, true);
    await withStorageLimit(
      bindings.SHOP_DB,
      bindings.DRAWINGS,
      team,
      prefix,
      [{ key: `${prefix}new`, bytes: 10 }],
      budget,
      write,
      eviction,
    );
    expect(await bindings.DRAWINGS.head(`${prefix}existing`)).toBeNull();
    expect((await bindings.DRAWINGS.head(`${prefix}new`))?.size).toBe(10);
  });
  it("fails closed for deletion when the central policy cannot be checked", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    await bindings.DRAWINGS.put(`${prefix}existing`, "x".repeat(100));
    const G3ID = {
      fetch: async (input: Request | string) =>
        String(typeof input === "string" ? input : input.url).endsWith("/storage-policy")
          ? new Response("Unavailable", { status: 503 })
          : bindings.G3ID.fetch(input),
    } as Fetcher;
    await expect(
      withStorageLimit(
        bindings.SHOP_DB,
        bindings.DRAWINGS,
        team,
        prefix,
        [{ key: `${prefix}new`, bytes: 1 }],
        budget,
        () => bindings.DRAWINGS.put(`${prefix}new`, "x"),
        shopStorageEviction({ ...bindings, G3ID }, team),
      ),
    ).rejects.toMatchObject({ code: "storage_full" });
    expect((await bindings.DRAWINGS.head(`${prefix}existing`))?.size).toBe(100);
    expect(await bindings.DRAWINGS.head(`${prefix}new`)).toBeNull();
  });
  it("does not rearm the full warning on repeated rejected uploads below 85%", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    const messages: string[] = [];
    const G3ID = {
      fetch: async (input: Request) => {
        if (input.url.endsWith("/members"))
          return Response.json([{ id: "admin", status: "active", isAdmin: true }]);
        if (input.url.endsWith("/chat/dm-members"))
          messages.push(((await input.json()) as { text: string }).text);
        return Response.json({ ok: true, sent: 1 });
      },
    } as Fetcher;
    const eviction = {
      policy: async (): Promise<StorageCleanupMode> => "block-uploads",
      removeReferences: async () => {},
      usage: (
        usage: { bytes: number; count: number },
        attempted?: boolean,
        mode?: StorageCleanupMode,
        rearm?: boolean,
      ) =>
        notifyStorageUsage(
          { G3ID },
          team,
          "shop",
          "files",
          bindings.SHOP_DB,
          usage,
          { bytes: 100, count: 100 },
          attempted,
          mode,
          rearm,
        ),
    };
    await bindings.DRAWINGS.put(`${prefix}old`, "x".repeat(80));
    const put = (name: string, bytes: number) =>
      withStorageLimit(
        bindings.SHOP_DB,
        bindings.DRAWINGS,
        team,
        prefix,
        [{ key: `${prefix}${name}`, bytes }],
        budget,
        () => bindings.DRAWINGS.put(`${prefix}${name}`, "x".repeat(bytes)),
        eviction,
      );
    for (let attempt = 0; attempt < 4; attempt++)
      await expect(put("too-large", 30)).rejects.toMatchObject({ code: "storage_full" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Automatic deletion is off");
    expect(messages[0]).toContain("would reach 100%");
    await put("small", 1);
    await expect(put("too-large", 30)).rejects.toMatchObject({ code: "storage_full" });
    expect(messages).toHaveLength(2);
  });
});
