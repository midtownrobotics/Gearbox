import { fetchArchives } from "./getters/archives";
import { fetchAllIssues } from "./getters/issues";
import { fetchItems } from "./getters/items";
import { fetchLists } from "./getters/lists";

/**
 * Asks for what the Overview and the checklists show as the app opens, so there is a saved copy
 * of each to show with no connection, whichever page was opened first.
 */
export async function prefetchAll(): Promise<void> {
  const [lists] = await Promise.all([
    fetchLists(),
    fetchAllIssues().catch(() => {}),
    fetchArchives().catch(() => {}),
  ]);
  await Promise.all(lists.map((list) => fetchItems(list.id)));
}
