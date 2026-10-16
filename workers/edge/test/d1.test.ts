import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { netBlocklistDomains, netClients, netSiteUsage, netUsage } from "../src/db/schema";
import { D1_MAX_PARAMS, chunk, rowsPerInsert } from "../src/lib/d1";

// D1 refuses a statement with more than 100 bound parameters ("too many SQL variables"), and a
// Drizzle insert binds one per column per row. Adding a column must shrink the chunks with it.
describe("rowsPerInsert", () => {
  it("keeps every chunked insert within D1's limit", () => {
    for (const table of [netClients, netUsage, netSiteUsage, netBlocklistDomains]) {
      const columns = Object.keys(getTableColumns(table)).length;
      const rows = rowsPerInsert(table);
      expect(rows).toBeGreaterThan(0);
      expect(rows * columns).toBeLessThanOrEqual(D1_MAX_PARAMS);
    }
  });

  it("splits a list into pieces of at most the size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
