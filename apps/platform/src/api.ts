// SPDX-License-Identifier: AGPL-3.0-only
import type { PlatformApp } from "@g3/worker-platform";
import { hc } from "hono/client";

export const api = hc<PlatformApp>("/api");
