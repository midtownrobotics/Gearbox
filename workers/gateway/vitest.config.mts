import { workerTestConfig } from "@g3/testing/config";

// Each app's worker is a stub that says which app got the request and at what path.
const echo = (app: string) => (request: Request) => {
  const url = new URL(request.url);
  return Response.json({ app, host: url.hostname, path: `${url.pathname}${url.search}` });
};

export default workerTestConfig({
  // Anything the gateway passes on reaches "the internet": here, an echo, except one dead host.
  outbound: (request) => {
    const url = new URL(request.url);
    // Cloudflare's answer when a hostname has nothing behind it.
    if (url.hostname.startsWith("dead."))
      return new Response("Origin unreachable", { status: 530 });
    return Response.json({ app: "origin", host: url.hostname, path: url.pathname });
  },
  services: Object.fromEntries(
    ["G3ID", "PORTAL", "SHOP", "PIT", "ORDERS", "EDGE", "SCOUTING", "SKILL_TREE", "ATTENDANCE"].map(
      (binding) => [binding, echo(binding)],
    ),
  ),
});
