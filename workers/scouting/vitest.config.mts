import { workerTestConfig } from "@g3/testing/config";

export default workerTestConfig({
  d1: "SCOUTING_DB",
  vars: { LOCAL_AUTH_BYPASS: "false" },
  outbound: async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "api.statbotics.io") return new Response("Not mocked", { status: 503 });
    const finished = url.searchParams.get("event") === "finished-event";
    return Response.json(
      [1, 2].map((number) => ({
        key: `shared-qm${number}`,
        match_number: number,
        status: finished ? "Completed" : "Scheduled",
        time: Math.floor(Date.now() / 1000) + 3600,
        pred: { red_score: 120, blue_score: 110, red_win_prob: 0.6 },
        result: finished ? { red_score: 140, blue_score: 100 } : {},
        alliances: {
          red: { teams: [number * 100 + 1, number * 100 + 2, number * 100 + 3] },
          blue: { teams: [number * 100 + 4, number * 100 + 5, number * 100 + 6] },
        },
      })),
    );
  },
});
