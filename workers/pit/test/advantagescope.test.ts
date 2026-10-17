import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// AdvantageScope Lite at /scope/: the team's settings, its match logs as AdvantageScope's log
// folder, and the assets a mentor uploads.

const bucket = (env as unknown as { LOGS: R2Bucket }).LOGS;

/**
 * A zip of `files`, each stored or deflated (no CRCs: the reader doesn't check them). `claims` is
 * the unzipped size the zip states, when it should lie.
 */
async function makeZip(
  files: { path: string; text: string | Uint8Array; deflate?: boolean; claims?: number }[],
) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = typeof file.text === "string" ? encoder.encode(file.text) : file.text;
    const data = file.deflate
      ? new Uint8Array(
          await new Response(
            new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw")),
          ).arrayBuffer(),
        )
      : raw;
    const name = encoder.encode(file.path);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, file.deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, file.claims ?? raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, file.deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, file.claims ?? raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...locals, ...centrals, end]).arrayBuffer());
}

function uploadForm(name: string, zip: Uint8Array) {
  const form = new FormData();
  form.append("file", new File([zip], name, { type: "application/zip" }));
  return form;
}

/** A body that may still be gzipped (Content-Encoding: gzip), as text. */
async function text(res: Response) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
}

/** A match log uploaded by a paired downloader, as Pit's own tests do. */
async function uploadLog(team: ReturnType<typeof teamUsers>, event: string, contents: string) {
  const { code } = await jsonAs<{ code: string }>(
    team.mentor,
    "/downloaders/codes",
    { method: "POST" },
    201,
  );
  const paired = (await (
    await call("/downloaders/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Team-Id": team.teamId },
      body: JSON.stringify({ code, name: "Pit laptop" }),
    })
  ).json()) as { key: string };
  const auth = { Authorization: `Bearer ${paired.key}`, "X-Team-Id": team.teamId };
  const gzipped = new Uint8Array(
    await new Response(
      new Blob([contents]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const log = (await (
    await call("/downloader/logs", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        name: "Qual-7",
        matchType: "q",
        matchNumber: 7,
        size: gzipped.length,
        rawSize: contents.length,
      }),
    })
  ).json()) as { id: number };
  const part = await (
    await call(`/downloader/logs/${log.id}/parts/1`, {
      method: "PUT",
      headers: auth,
      body: gzipped,
    })
  ).json();
  await call(`/downloader/logs/${log.id}/complete`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [part] }),
  });
}

describe("settings", () => {
  it("are the team's: anyone signed in saves them, and everyone on the team gets them", async () => {
    const [a, b] = [teamUsers(newTeamId()), teamUsers(newTeamId())];
    expect(await jsonAs(a.student, "/scope/settings")).toEqual({ settings: {} });
    await jsonAs(a.student, "/scope/settings", {
      method: "PUT",
      body: {
        settings: {
          "AdvantageScopeLite/state": '{"tabs":1}',
          "AdvantageScopeLite/prefs": '{"theme":"dark"}',
        },
      },
    });
    await jsonAs(a.mentor, "/scope/settings", {
      method: "PUT",
      body: { settings: { "AdvantageScopeLite/state": '{"tabs":2}' } },
    });
    expect(await jsonAs(a.mentor, "/scope/settings")).toEqual({
      settings: {
        "AdvantageScopeLite/state": '{"tabs":2}',
        "AdvantageScopeLite/prefs": '{"theme":"dark"}',
      },
    });
    expect(await jsonAs(b.student, "/scope/settings")).toEqual({ settings: {} });
  });

  it("takes only AdvantageScope's own keys, as text", async () => {
    const team = teamUsers(newTeamId());
    for (const settings of [{ other: "x" }, { "AdvantageScopeLite/state": 1 }, ["x"]]) {
      const res = await callAs(team.student, "/scope/settings", {
        method: "PUT",
        body: { settings },
      });
      expect(res.status).toBe(400);
    }
    expect((await call("/scope/settings")).status).toBe(401);
  });

  it("sends a signed-out visitor to the team's sign-in, back to AdvantageScope only", async () => {
    const res = await call(
      `/scope/sign-in?return=${encodeURIComponent("http://x.test/scope/?log=a_Qual-1.wpilog")}`,
      { headers: { "X-Team-Id": "frc4242" }, redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("Location") ?? "");
    expect(to.hostname).toContain("4242-id");
    expect(to.pathname).toBe("/login");
    const back = new URL(to.searchParams.get("redirect") ?? "");
    expect(back.hostname).toContain("4242-pit");
    expect(back.pathname + back.search).toBe("/scope/?log=a_Qual-1.wpilog");

    const elsewhere = await call(
      `/scope/sign-in?return=${encodeURIComponent("https://evil.test/steal")}`,
      { headers: { "X-Team-Id": "frc4242" }, redirect: "manual" },
    );
    const redirect = new URL(elsewhere.headers.get("Location") ?? "").searchParams.get("redirect");
    expect(new URL(redirect ?? "").pathname).toBe("/scope/");
  });
});

describe("logs", () => {
  it("lists the team's match logs as files and opens them", async () => {
    const [a, b] = [teamUsers(newTeamId()), teamUsers(newTeamId())];
    await uploadLog(a, "archimedes", "wpilog bytes");
    expect(await jsonAs(a.student, "/scope/logs?folder=%2FU%2Flogs")).toEqual([
      { name: "archimedes_Qual-7.wpilog", size: 12 },
    ]);
    expect(await jsonAs(b.student, "/scope/logs")).toEqual([]);

    const res = await callAs(a.student, "/scope/logs/archimedes_Qual-7.wpilog");
    expect(res.status).toBe(200);
    expect(await text(res)).toBe("wpilog bytes");
    expect((await callAs(b.student, "/scope/logs/archimedes_Qual-7.wpilog")).status).toBe(404);
    expect((await callAs(a.student, "/scope/logs/nonsense.wpilog")).status).toBe(404);
  });
});

describe("assets", () => {
  const config = JSON.stringify({ name: "Comet", rotations: [], position: [0, 0, 0] });

  it("takes a mentor's zip, lists it for AdvantageScope and serves its files", async () => {
    const [a, b] = [teamUsers(newTeamId()), teamUsers(newTeamId())];
    const zip = await makeZip([
      { path: "Robot_Comet/config.json", text: config },
      { path: "Robot_Comet/model.glb", text: "glb ".repeat(100), deflate: true },
      { path: "__MACOSX/Robot_Comet/._model.glb", text: "junk" },
    ]);
    const student = await callAs(a.student, "/scope/assets", {
      method: "POST",
      body: uploadForm("Robot_Comet.zip", zip),
    });
    expect(student.status).toBe(403);
    expect(
      await jsonAs(a.mentor, "/scope/assets", {
        method: "POST",
        body: uploadForm("Robot_Comet.zip", zip),
      }),
    ).toEqual({ ok: true, assets: ["Robot_Comet"] });

    expect(await jsonAs(a.student, "/scope/assets")).toEqual({
      "Robot_Comet/config.json": JSON.parse(config),
      "Robot_Comet/model.glb": null,
    });
    expect(await jsonAs(b.student, "/scope/assets")).toEqual({});

    const model = await callAs(a.student, "/scope/assets/Robot_Comet/model.glb");
    expect(model.headers.get("Content-Type")).toBe("model/gltf-binary");
    expect(await model.text()).toBe("glb ".repeat(100));
    const etag = model.headers.get("ETag") ?? "";
    const again = await callAs(a.student, "/scope/assets/Robot_Comet/model.glb", {
      headers: { "If-None-Match": etag },
    });
    expect(again.status).toBe(304);
    expect((await callAs(b.student, "/scope/assets/Robot_Comet/model.glb")).status).toBe(404);

    const list = await jsonAs<{ assets: { name: string; size: number }[]; canManage: boolean }>(
      a.student,
      "/scope/asset-list",
    );
    expect(list.assets.map((asset) => asset.name)).toEqual(["Robot_Comet"]);
    expect(list.canManage).toBe(false);
  });

  it("replaces an asset with the same name, and takes a zip of asset zips", async () => {
    const team = teamUsers(newTeamId());
    await jsonAs(team.mentor, "/scope/assets", {
      method: "POST",
      body: uploadForm(
        "Field2d_Mine.zip",
        await makeZip([
          { path: "config.json", text: config },
          { path: "image.png", text: "old" },
          { path: "extra.png", text: "gone soon" },
        ]),
      ),
    });
    const inner = await makeZip([
      { path: "Field2d_Mine/config.json", text: config },
      { path: "Field2d_Mine/image.png", text: "new" },
    ]);
    const collection = await makeZip([{ path: "Field2d_Mine.zip", text: inner }]);
    expect(
      await jsonAs(team.mentor, "/scope/assets", {
        method: "POST",
        body: uploadForm("Collection.zip", collection),
      }),
    ).toEqual({ ok: true, assets: ["Field2d_Mine"] });
    expect(Object.keys(await jsonAs(team.student, "/scope/assets")).sort()).toEqual([
      "Field2d_Mine/config.json",
      "Field2d_Mine/image.png",
    ]);
    expect(await (await callAs(team.student, "/scope/assets/Field2d_Mine/image.png")).text()).toBe(
      "new",
    );
    const listed = await bucket.list({ prefix: `pit/teams/${team.teamId}/scope-assets/` });
    expect(listed.objects.map((o) => o.key.split("/").pop()).sort()).toEqual([
      "config.json",
      "image.png",
    ]);
  });

  it("keeps a team's assets to 10 MB, 10 assets, and what the zip says it holds", async () => {
    const team = teamUsers(newTeamId());
    const post = (name: string, zip: Uint8Array) =>
      callAs(team.mentor, "/scope/assets", { method: "POST", body: uploadForm(name, zip) });
    const robot = async (name: string, bytes: number) =>
      makeZip([
        { path: `${name}/config.json`, text: config },
        { path: `${name}/model.glb`, text: "x".repeat(bytes), deflate: true },
      ]);
    const MB = 1024 * 1024;

    // Over 10 MB in one zip, stored.
    expect(
      (
        await post(
          "Big.zip",
          await makeZip([
            { path: "Robot_Big/config.json", text: config },
            { path: "Robot_Big/model.glb", text: new Uint8Array(10 * MB + 1) },
          ]),
        )
      ).status,
    ).toBe(413);
    // Small zipped but over 10 MB unzipped, and over the team's 10 MB with another.
    expect((await post("Huge.zip", await robot("Robot_Huge", 11 * MB))).status).toBe(413);
    expect((await post("One.zip", await robot("Robot_One", 6 * MB))).status).toBe(200);
    expect((await post("Two.zip", await robot("Robot_Two", 6 * MB))).status).toBe(413);
    // Replacing one counts its new size, not both.
    expect((await post("One.zip", await robot("Robot_One", 7 * MB))).status).toBe(200);

    // A zip that says its files are smaller than they unzip to.
    const lying = await makeZip([
      { path: "Robot_Liar/config.json", text: config },
      { path: "Robot_Liar/model.glb", text: "x".repeat(MB), deflate: true, claims: 10 },
    ]);
    expect((await post("Liar.zip", lying)).status).toBe(400);

    const list = await jsonAs<{ assets: { name: string; size: number }[] }>(
      team.student,
      "/scope/asset-list",
    );
    expect(list.assets.map((asset) => asset.name)).toEqual(["Robot_One"]);
    expect(list.assets[0].size).toBeGreaterThan(7 * MB);

    // At most 10 assets.
    await jsonAs(team.mentor, "/scope/assets/Robot_One", { method: "DELETE" });
    for (let i = 0; i < 10; i++) {
      expect((await post(`R${i}.zip`, await robot(`Robot_R${i}`, 10))).status).toBe(200);
    }
    expect((await post("R10.zip", await robot("Robot_R10", 10))).status).toBe(409);
  });

  it("refuses what isn't an asset zip, and a mentor removes one", async () => {
    const team = teamUsers(newTeamId());
    const post = (name: string, zip: Uint8Array) =>
      callAs(team.mentor, "/scope/assets", { method: "POST", body: uploadForm(name, zip) });
    expect((await post("notes.txt", new Uint8Array([1, 2]))).status).toBe(400);
    expect((await post("broken.zip", new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect((await post("empty.zip", await makeZip([{ path: "a.png", text: "x" }]))).status).toBe(
      400,
    );
    expect(
      (await post("bad.zip", await makeZip([{ path: "Robot_X/config.json", text: "{nope" }])))
        .status,
    ).toBe(400);
    expect(await jsonAs(team.student, "/scope/assets")).toEqual({});

    await post("Robot_Gone.zip", await makeZip([{ path: "config.json", text: config }]));
    expect(
      (await callAs(team.student, "/scope/assets/Robot_Gone", { method: "DELETE" })).status,
    ).toBe(403);
    await jsonAs(team.mentor, "/scope/assets/Robot_Gone", { method: "DELETE" });
    expect(await jsonAs(team.student, "/scope/assets")).toEqual({});
    const listed = await bucket.list({ prefix: `pit/teams/${team.teamId}/scope-assets/` });
    expect(listed.objects).toEqual([]);
  });
});
