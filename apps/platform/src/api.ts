import type { PlatformApp } from "@g3/worker-platform";
import { hc } from "hono/client";

export const api = hc<PlatformApp>("/api");
