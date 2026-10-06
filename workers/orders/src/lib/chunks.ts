/**
 * D1 binds at most 100 values in one statement, so a query over a list of ids (or an insert of
 * many rows) runs in chunks that stay under it. A team's real order history easily passes 100.
 */
export const MAX_BOUND = 90;

/** Runs `run` on each chunk of `items` (at most `size`), in order, and joins the results. */
export async function inChunks<T, R>(
  items: T[],
  run: (chunk: T[]) => Promise<R[]>,
  size = MAX_BOUND,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await run(items.slice(i, i + size))));
  return out;
}
