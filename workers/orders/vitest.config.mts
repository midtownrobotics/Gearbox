import { offlineService, workerTestConfig } from "@g3/testing/config";

export default workerTestConfig({ d1: "ORDERS_DB", services: { EDGE: offlineService } });
