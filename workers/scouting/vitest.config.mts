import { workerTestConfig } from "@g3/testing/config";

const statboticsCalls = new Map<string, number>();

export default workerTestConfig({
  d1: "SCOUTING_DB",
  vars: {
    LOCAL_AUTH_BYPASS: "false",
    TBA_AUTH_KEY: "legacy-tba-test-key",
    NEXUS_API_KEY: "legacy-nexus-test-key",
  },
  outbound: async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "www.thebluealliance.com") {
      const events: Record<string, { name: string; short_name: string | null }> = {
        "/api/v3/event/2099qagrits": {
          name: "Georgia Robotics Invitational Tournament",
          short_name: "GRITS",
        },
        "/api/v3/event/2099qashort": {
          name: "Test STING Offseason Event",
          short_name: "Test STING",
        },
        "/api/v3/event/2099qafull": { name: "Test Championship", short_name: null },
        "/api/v3/event/2099qacache": { name: "Cached Test Event", short_name: "Cached Test" },
      };
      if (events[url.pathname]) return Response.json(events[url.pathname]);
      if (url.pathname === "/api/v3/event/2099qaplayoffs/alliances")
        return Response.json([
          { name: "Alliance 1", picks: ["frc1261", "frc1771", "frc4509"], backup: null },
          { name: "Alliance 2", picks: ["frc2974", "frc4188", "frc6925"], backup: null },
        ]);
      return new Response("Unavailable", { status: 503 });
    }
    if (url.hostname !== "api.statbotics.io") return new Response("Not mocked", { status: 503 });
    const event = url.searchParams.get("event") || "";
    const calls = (statboticsCalls.get(event) || 0) + 1;
    statboticsCalls.set(event, calls);
    if (event.startsWith("qa-missing-")) return new Response("Not found", { status: 404 });
    if (event.startsWith("qa-timeout-")) await new Promise((resolve) => setTimeout(resolve, 5000));
    if (
      event.startsWith("qa-down-") ||
      event === "2099qagrits" ||
      (event.startsWith("qa-recover-") && calls === 1) ||
      (event.startsWith("qa-fail-after-") && calls > 1)
    )
      return new Response("Unavailable", { status: 500 });
    if (event.startsWith("qa-invalid-")) return Response.json({ error: "invalid" });
    const finished = event === "finished-event";
    return Response.json(
      [1, 2].map((number) => ({
        key: `shared-qm${number}`,
        match_number: number,
        status: finished ? "Completed" : "Scheduled",
        time: Math.floor(Date.now() / 1000) + 3600,
        pred: {
          red_score: 120 + (event.startsWith("qa-cache-") ? calls : 0),
          blue_score: 110,
          red_win_prob: 0.6,
        },
        result: finished ? { red_score: 140, blue_score: 100 } : {},
        alliances: {
          red: { teams: [number * 100 + 1, number * 100 + 2, number * 100 + 3] },
          blue: { teams: [number * 100 + 4, number * 100 + 5, number * 100 + 6] },
        },
      })),
    );
  },
});
