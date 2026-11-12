// SPDX-License-Identifier: AGPL-3.0-only
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createEdgeDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type EdgeDb = ReturnType<typeof createEdgeDb>;
