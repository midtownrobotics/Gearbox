// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../api";
import type { ChecklistItem } from "./types";

export async function fetchItems(listId: number | string): Promise<ChecklistItem[]> {
  const res = await api.lists[":id"].items.$get({ param: { id: String(listId) } });
  if (!res.ok) throw new Error(`Failed to fetch items (${res.status})`);
  return res.json() as Promise<ChecklistItem[]>;
}
