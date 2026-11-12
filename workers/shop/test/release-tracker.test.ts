import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopDb } from "../src/db";
import { openTrackerWindow, parseTrackingUrl, runTrackerSync } from "../src/lib/release-tracker";
import { FEATURE_NAMESPACE } from "../src/lib/release-tracker-feature";
import { statusOfSteps } from "../src/lib/release-tracker-status";
import type { AppEnv } from "../src/types";

// The release tracker (lib/release-tracker.ts): copies of the team's part studios in a tracking
// document, colored by release and shop status, written to Onshape only when something changed.

const workerEnv = env as unknown as AppEnv["Bindings"];
const database = workerEnv.SHOP_DB;

type Call = { method: string; path: string; body: unknown };

/** Answers Onshape's API (path after /api) and records every call. */
function onshapeAnswers(
  answer: (method: string, path: string, body: unknown) => [number, unknown],
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const path = url.replace("https://cad.onshape.com/api", "");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const [status, reply] = answer(method, path, body);
      return new Response(JSON.stringify(reply), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const hex = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);

/** A team with Onshape keys and a tracker on a tracking document, before its first sync. */
async function trackedTeam() {
  const team = teamUsers(newTeamId());
  const source = hex();
  const tracking = hex();
  const workspace = hex();
  onshapeAnswers(() => [200, { items: [] }]);
  const saved = await callAs(team.admin, "/admin/onshape/config", {
    method: "POST",
    body: { documentId: source, companyId: "co1", apiKey: "key", apiSecret: "secret" },
  });
  expect(saved.status).toBe(200);
  await database
    .prepare(
      `INSERT INTO release_trackers (team_id, source_document_id, document_id, workspace_id, created_by, created_at)
       VALUES (?, ?, ?, ?, 'admin', 0)`,
    )
    .bind(team.teamId, source, tracking, workspace)
    .run();
  return { team, source, tracking, workspace, doc: `d/${tracking}/w/${workspace}` };
}

/** The team's document: part studio "Arm" with a released part (A) and a never-released one (B). */
function sourceAnswers(source: string, studios = [{ id: "e1", name: "Arm" }]) {
  let features = 0;
  return (method: string, path: string): [number, unknown] => {
    if (path === `/v10/documents/${source}`) return [200, { defaultWorkspace: { parent: "v2" } }];
    if (path.startsWith(`/v10/parts/d/${source}/v/v2`)) {
      return [
        200,
        [
          { partId: "A", elementId: "e1", name: "Plate", partNumber: "PN-1", bodyType: "solid" },
          { partId: "B", elementId: "e1", name: "Spacer", partNumber: null, bodyType: "solid" },
          { partId: "F", elementId: "e1", name: "Flat", bodyType: "solid", isFlattenedBody: true },
        ],
      ];
    }
    if (path === `/v10/revisions/d/${source}`) {
      return [
        200,
        [
          {
            partNumber: "PN-1",
            revision: "A",
            partId: "A",
            elementId: "e1",
            elementType: 0,
            versionId: "v1",
            releaseName: "First release",
            releaseCreatedDate: "2026-11-01T00:00:00Z",
          },
        ],
      ];
    }
    const elements = path.match(/^\/v10\/documents\/d\/[0-9a-f]+\/v\/(v\d)\/elements/);
    if (elements) {
      return [200, studios.map((s) => ({ ...s, microversionId: `m-${elements[1]}-${s.id}` }))];
    }
    if (method === "POST" && /^\/v10\/partstudios\/d\/\w+\/w\/\w+$/.test(path)) {
      return [200, { id: "copy1" }];
    }
    if (method === "POST" && path.includes("/features")) {
      const id = path.match(/featureid\/(\w+)/)?.[1] ?? `f${++features}`;
      return [200, { feature: { featureId: id }, featureState: { featureStatus: "OK" } }];
    }
    if (method === "DELETE") return [200, {}];
    return [404, { message: `No stub for ${method} ${path}` }];
  };
}

type Feature = { name: string; parameters: Record<string, unknown>[] };
const sourceOf = (call: Call) =>
  (call.body as { feature: Feature }).feature.parameters[0] as {
    namespace: string;
    partQuery: { queries: { deterministicIds: string[] }[] };
  };
const statusOf = (call: Call) =>
  ((call.body as { feature: Feature }).feature.parameters[1] as { value: string }).value;

describe("release tracker", () => {
  it("decides a part's status from its steps", () => {
    expect(statusOfSteps([])).toBe("NOT_STARTED");
    expect(statusOfSteps(["waiting", "todo"])).toBe("NOT_STARTED");
    expect(statusOfSteps(["doing", "waiting"])).toBe("IN_PROGRESS");
    expect(statusOfSteps(["done", "todo"])).toBe("IN_PROGRESS");
    expect(statusOfSteps(["done", "done"])).toBe("COMPLETE");
  });

  it("reads a tracking document's address", () => {
    const d = hex();
    const w = hex();
    expect(
      parseTrackingUrl(`https://cad.onshape.com/documents/${d}/w/${w}/e/${hex()}?x=1`),
    ).toEqual({
      documentId: d,
      workspaceId: w,
    });
    expect(parseTrackingUrl(`https://cad.onshape.com/documents/${d}/v/${w}`)).toBeNull();
  });

  it("is for admins, and needs Onshape connected", async () => {
    const team = teamUsers(newTeamId());
    expect((await callAs(team.student, "/admin/release-tracker")).status).toBe(403);
    expect(await jsonAs(team.admin, "/admin/release-tracker")).toEqual({
      ready: false,
      tracker: null,
    });
    const put = await callAs(team.admin, "/admin/release-tracker", {
      method: "PUT",
      body: { url: `https://cad.onshape.com/documents/${hex()}/w/${hex()}` },
    });
    expect(put.status).toBe(400);
  });

  it("refuses the team's own document and one the keys can't open", async () => {
    const { team, source } = await trackedTeam();
    onshapeAnswers(() => [403, { message: "Forbidden" }]);
    const own = await callAs(team.admin, "/admin/release-tracker", {
      method: "PUT",
      body: { url: `https://cad.onshape.com/documents/${source}/w/${hex()}` },
    });
    expect(own.status).toBe(400);
    const closed = await callAs(team.admin, "/admin/release-tracker", {
      method: "PUT",
      body: { url: `https://cad.onshape.com/documents/${hex()}/w/${hex()}` },
    });
    expect(closed.status).toBe(400);
  });

  it("copies each part studio, then writes only what changed", async () => {
    const { team, source, doc } = await trackedTeam();

    // First sync: reads the document, makes the copy, and adds one feature per group.
    let calls = onshapeAnswers(sourceAnswers(source));
    expect(await runTrackerSync(workerEnv, team.teamId)).toBe("done");
    expect(calls.filter((c) => c.method === "GET").map((c) => c.path.split("?")[0])).toEqual(
      expect.arrayContaining([
        `/v10/documents/${source}`,
        `/v10/parts/d/${source}/v/v2`,
        `/v10/revisions/d/${source}`,
      ]),
    );
    expect(calls.filter((c) => c.path === `/v10/partstudios/${doc}`)).toEqual([
      expect.objectContaining({ method: "POST", body: { name: "Arm" } }),
    ]);
    const added = calls.filter((c) => c.path === `/v10/partstudios/${doc}/e/copy1/features`);
    expect(added).toHaveLength(2);
    const released = added.find((c) => statusOf(c) === "NOT_STARTED") as Call;
    expect(sourceOf(released).namespace).toBe(`d${source}::vv1::ee1::mm-v1-e1`);
    expect(sourceOf(released).partQuery.queries[0].deterministicIds).toEqual(["A"]);
    expect((released.body as { feature: Feature & { namespace: string } }).feature.namespace).toBe(
      FEATURE_NAMESPACE,
    );
    const unreleased = added.find((c) => statusOf(c) === "UNRELEASED") as Call;
    expect(sourceOf(unreleased).namespace).toBe(`d${source}::vv2::ee1::mm-v2-e1`);
    expect(sourceOf(unreleased).partQuery.queries[0].deterministicIds).toEqual(["B"]);

    // Nothing changed: no calls at all.
    calls = onshapeAnswers(sourceAnswers(source));
    expect(await runTrackerSync(workerEnv, team.teamId)).toBe("done");
    expect(calls).toEqual([]);

    // The released part is started in the shop: its feature is rewritten in place, one call.
    const db = workerEnv.SHOP_DB;
    const t = team.teamId;
    const now = Date.now();
    const subsystem = await db
      .prepare(
        "INSERT INTO subsystems (team_id, name, created_at) VALUES (?, 'Arm', ?) RETURNING id",
      )
      .bind(t, now)
      .first<{ id: number }>();
    const process = await db
      .prepare(
        "INSERT INTO processes (team_id, name, created_at) VALUES (?, 'Mill', ?) RETURNING id",
      )
      .bind(t, now)
      .first<{ id: number }>();
    const definition = await db
      .prepare(
        "INSERT INTO part_definitions (team_id, onshape_part_number, revision, name, subsystem_id, creator, created_at) VALUES (?, 'PN-1', 'A', 'Plate', ?, 'admin', ?) RETURNING id",
      )
      .bind(t, subsystem?.id, now)
      .first<{ id: number }>();
    const instance = await db
      .prepare(
        "INSERT INTO part_instances (team_id, part_definition_id, instance_number, created_at) VALUES (?, ?, 1, ?) RETURNING id",
      )
      .bind(t, definition?.id, now)
      .first<{ id: number }>();
    await db
      .prepare(
        "INSERT INTO part_instance_processes (team_id, part_instance_id, process_id, \"index\", status, created_at) VALUES (?, ?, ?, 0, 'doing', ?)",
      )
      .bind(t, instance?.id, process?.id, now)
      .run();

    calls = onshapeAnswers(sourceAnswers(source));
    expect(await runTrackerSync(workerEnv, team.teamId)).toBe("done");
    expect(calls).toHaveLength(1);
    // The stub numbers features in the order they were added.
    const releasedId = `f${added.indexOf(released) + 1}`;
    expect(calls[0].path).toBe(`/v10/partstudios/${doc}/e/copy1/features/featureid/${releasedId}`);
    expect(statusOf(calls[0])).toBe("IN_PROGRESS");

    const report = await jsonAs<{
      tracker: {
        error: string | null;
        studios: { name: string; released: number; unreleased: number }[];
      };
    }>(team.admin, "/admin/release-tracker");
    expect(report.tracker.error).toBeNull();
    expect(report.tracker.studios).toEqual([
      expect.objectContaining({ name: "Arm", released: 1, unreleased: 1 }),
    ]);
  });

  it("deletes the copy of a part studio that's gone", async () => {
    const { team, source, doc } = await trackedTeam();
    onshapeAnswers(sourceAnswers(source));
    await runTrackerSync(workerEnv, team.teamId);

    // Now the document has no part studios; the next sync reads it again (a new version).
    await database
      .prepare("UPDATE release_trackers SET refresh = 1 WHERE team_id = ?")
      .bind(team.teamId)
      .run();
    const calls = onshapeAnswers(sourceAnswers(source, []));
    await runTrackerSync(workerEnv, team.teamId);
    expect(calls).toContainEqual(
      expect.objectContaining({ method: "DELETE", path: `/v10/elements/${doc}/e/copy1` }),
    );
    const report = await jsonAs<{ tracker: { studios: unknown[] } }>(
      team.admin,
      "/admin/release-tracker",
    );
    expect(report.tracker.studios).toEqual([]);
  });

  it("opens one window for many changes", async () => {
    const { team } = await trackedTeam();
    const db = createShopDb(workerEnv.SHOP_DB);
    const due = () =>
      database
        .prepare("SELECT sync_due_at AS due, refresh FROM release_trackers WHERE team_id = ?")
        .bind(team.teamId)
        .first<{ due: number | null; refresh: number }>();
    await database
      .prepare("UPDATE release_trackers SET refresh = 0 WHERE team_id = ?")
      .bind(team.teamId)
      .run();

    await openTrackerWindow(workerEnv, db, team.teamId, { refresh: false });
    const first = await due();
    expect(first?.due).toBeGreaterThan(Date.now() + 19 * 60 * 1000);
    expect(first?.refresh).toBe(0);

    // A release inside the window joins it, and makes its sync read Onshape.
    await openTrackerWindow(workerEnv, db, team.teamId, { refresh: true });
    expect(await due()).toEqual({ due: first?.due, refresh: 1 });
  });

  it("stops, keeping nothing", async () => {
    const { team } = await trackedTeam();
    expect((await callAs(team.admin, "/admin/release-tracker", { method: "DELETE" })).status).toBe(
      200,
    );
    expect(await jsonAs(team.admin, "/admin/release-tracker")).toMatchObject({ tracker: null });
  });
});
