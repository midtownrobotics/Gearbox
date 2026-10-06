import { workerTestConfig } from "@g3/testing/config";

export default workerTestConfig({
  d1: "EDGE_DB",
  vars: { EDGE_AGENT_URL: "", EDGE_AGENT_KEY: "test-agent-key" },
});
