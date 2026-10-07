import { offlineService, workerTestConfig } from "@g3/testing/config";

export default workerTestConfig({
  d1: "SHOP_DB",
  services: { EDGE: offlineService },
  vars: {
    // A key for the Onshape secrets kept in D1 (32 zero bytes).
    SECRETS_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    // The site team's Onshape webhook key from before teams (lib/onshape-config.ts).
    ONSHAPE_WEBHOOK_KEY_PRIMARY: "site-webhook-key",
    // Production addresses for teams, not the dev gateway's.
    LOCAL_GATEWAY_URL: "",
  },
});
