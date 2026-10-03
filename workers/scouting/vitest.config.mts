import { workerTestConfig } from "@g3/testing/config";

export default workerTestConfig({
  wranglerConfig: "./wrangler.local.toml",
  d1: "SCOUTING_DB",
  vars: { LOCAL_AUTH_BYPASS: "false" },
});
