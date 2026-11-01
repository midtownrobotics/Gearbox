// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../api";
import type { ChecklistList } from "./types";

export async function fetchLists(): Promise<ChecklistList[]> {
  const res = await api.lists.$get();
  if (!res.ok) throw new Error(`Failed to fetch lists (${res.status})`);
  return res.json() as Promise<ChecklistList[]>;
}

export async function fetchList(id: number | string): Promise<ChecklistList | null> {
  const res = await api.lists[":id"].$get({ param: { id: String(id) } });
  if ((res.status as number) === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch list (${res.status})`);
  return res.json() as Promise<ChecklistList>;
}
