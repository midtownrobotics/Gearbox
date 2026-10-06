import { workerTestConfig } from "@g3/testing/config";

// Each app's worker is a stub that says which app got the request, at what path, and with which
// cookie and identity headers.
const echo = (app: string) => (request: Request) => {
  const url = new URL(request.url);
  const h = request.headers;
  return Response.json({
    app,
    host: url.hostname,
    path: `${url.pathname}${url.search}`,
    cookie: h.get("Cookie"),
    team: h.get("X-Team-Id"),
    user: h.get("X-User-Id"),
    sessionType: h.get("X-Session-Type"),
    roles: h.get("X-User-Roles"),
  });
};

// Two teams, and G3ID knows a session for a member of each (an admin of 1648, a student of 254).
const teams = ["frc1648", "frc254"];
const sessions: Record<string, object> = {
  ours: { id: "u-ours", teamId: "frc1648", sessionType: "oauth", isAdmin: true, isMentor: false },
  theirs: { id: "u-theirs", teamId: "frc254", sessionType: "oauth", isAdmin: false },
  kiosk: { id: "u-kiosk", teamId: "frc254", sessionType: "pin", isAdmin: false },
};

const g3id = (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/me") {
    const session = (request.headers.get("Cookie") ?? "").match(/g3_session=([^;]*)/)?.[1] ?? "";
    const me = sessions[session];
    return me ? Response.json(me) : Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return echo("G3ID")(request);
};

// The platform knows which teams exist.
const platform = (request: Request) => {
  const team = new URL(request.url).pathname.match(/^\/api\/teams\/(.+)$/)?.[1];
  if (team !== undefined) {
    return teams.includes(team)
      ? Response.json({ id: team })
      : Response.json({ error: "No such team." }, { status: 404 });
  }
  return echo("PLATFORM")(request);
};

export default workerTestConfig({
  // Anything the gateway passes on reaches "the internet": here, an echo, except one dead host.
  outbound: (request) => {
    const url = new URL(request.url);
    // Cloudflare's answer when a hostname has nothing behind it.
    if (url.hostname.startsWith("dead."))
      return new Response("Origin unreachable", { status: 530 });
    return Response.json({ app: "origin", host: url.hostname, port: url.port, path: url.pathname });
  },
  services: {
    ...Object.fromEntries(
      ["PORTAL", "SHOP", "PIT", "ORDERS", "EDGE", "SCOUTING", "SKILL_TREE", "ATTENDANCE"].map(
        (binding) => [binding, echo(binding)],
      ),
    ),
    G3ID: g3id,
    PLATFORM: platform,
  },
});
