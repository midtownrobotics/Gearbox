// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../api";
import type { ChecklistIssue, ChecklistIssueSummary } from "./types";

export async function fetchIssues(listId: number | string): Promise<ChecklistIssue[]> {
  const res = await api.lists[":id"].issues.$get({ param: { id: String(listId) } });
  if (!res.ok) throw new Error(`Failed to fetch issues (${res.status})`);
  return res.json() as Promise<ChecklistIssue[]>;
}

export async function fetchAllIssues(): Promise<ChecklistIssueSummary[]> {
  const res = await api.issues.$get();
  if (!res.ok) throw new Error(`Failed to fetch issues (${res.status})`);
  return res.json() as Promise<ChecklistIssueSummary[]>;
}
