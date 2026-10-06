import { offlineService, workerTestConfig } from "@g3/testing/config";

export default workerTestConfig({ d1: "SHOP_DB", services: { EDGE: offlineService } });
