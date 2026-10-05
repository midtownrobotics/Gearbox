import { workerTestConfig } from "@g3/testing/config";

// G3ID's internal routes, as the platform uses them: it accepts teams and workspaces (one
// workspace, TTAKEN, is already another team's), and hands out codes. A code is pending the first
// time it's checked, and sent by its founder ("u-founder") after that.
const checks = new Map<string, number>();
const g3id = async (request: Request) => {
  const path = new URL(request.url).pathname.replace(/^\/api\/internal/, "");
  if (path === "/teams") return Response.json({ ok: true });
  if (path === "/slack-installations") {
    const body = (await request.json()) as { workspaceId: string };
    return body.workspaceId === "TTAKEN"
      ? Response.json({ result: "taken" }, { status: 409 })
      : Response.json({ result: "saved" });
  }
  if (path === "/signup-codes") {
    const token = crypto.randomUUID();
    checks.set(token, 0);
    return Response.json({ code: "1234", token });
  }
  const token = path.match(/^\/signup-codes\/(.+)$/)?.[1];
  if (token && checks.has(token)) {
    const seen = checks.get(token) ?? 0;
    checks.set(token, seen + 1);
    return Response.json(
      seen === 0 ? { status: "pending" } : { status: "success", userId: "u-founder" },
    );
  }
  if (token) return Response.json({ status: "expired" });
  return Response.json({ error: "Not stubbed" }, { status: 500 });
};

// Slack's install: answers for the workspace named in the code ("ws:T123").
const slack = async (request: Request) => {
  const url = new URL(request.url);
  if (url.hostname === "slack.com" && url.pathname === "/api/oauth.v2.access") {
    const code = String((await request.formData()).get("code") ?? "");
    if (!code.startsWith("ws:")) return Response.json({ ok: false });
    const id = code.slice(3);
    return Response.json({
      ok: true,
      access_token: `xoxb-${id}`,
      bot_user_id: "UBOT",
      team: { id, name: `Workspace ${id}` },
    });
  }
  return new Response("Not stubbed", { status: 502 });
};

export default workerTestConfig({
  d1: "PLATFORM_DB",
  vars: { SLACK_CLIENT_ID: "test-client", SLACK_CLIENT_SECRET: "test-secret" },
  services: { G3ID: g3id },
  outbound: slack,
});
