import { workerTestConfig } from "@g3/testing/config";

export default workerTestConfig({
  d1: "SCOUTING_DB",
  vars: { LOCAL_AUTH_BYPASS: "false" },
});
