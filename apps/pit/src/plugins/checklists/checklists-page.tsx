import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchLists } from "../../shared/getters/lists";
import type { ChecklistList } from "../../shared/getters/types";

export function ChecklistsPage() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<ChecklistList[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [createError, setCreateError] = useState("");

  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  async function load() {
    try {
      setLists(await fetchLists());
    } catch {}
    setLoading(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is stable, no deps needed
  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!newName.trim()) {
      setCreateError("Name is required.");
      return;
    }
    const res = await api.lists.$post({
      json: { name: newName.trim(), description: newDesc.trim() || null },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setNewName("");
    setNewDesc("");
    setCreating(false);
    setCreateError("");
    setBanner(null);
    await load();
  }

  async function handleDelete(id: number) {
    const res = await api.lists[":id"].$delete({ param: { id: String(id) } });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      setConfirmDelete(null);
      return;
    }
    setConfirmDelete(null);
    await load();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Checklists</h1>
          {!creating && (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setBanner(null);
              }}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              + New List
            </button>
          )}
        </div>

        {banner && (
          <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-2">
            {banner}
          </p>
        )}

        {creating && (
          <div className="bg-surface rounded-xl border border-gray-300 p-5 space-y-3">
            <span className="font-semibold text-gray-200">New Checklist</span>
            <input
              type="text"
              placeholder="List name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setCreateError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              className="mt-4 w-full bg-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-primary-500"
              // biome-ignore lint/a11y/noAutofocus: intentional — user just opened the create form
              autoFocus
            />
            <textarea
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              className="w-full bg-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-primary-500 resize-none"
            />
            {createError && <p className="text-red-400 text-xs">{createError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreate}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                  setNewDesc("");
                  setCreateError("");
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {lists.length === 0 && !creating && (
          <p className="text-gray-600 text-center py-12">
            No checklists yet. Create one to get started.
          </p>
        )}

        <div className="space-y-3">
          {lists.map((list) => (
            <div
              key={list.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/editor/${list.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") navigate(`/editor/${list.id}`);
              }}
              className="bg-surface hover:bg-gray-100 rounded-xl border border-gray-300 p-5 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg font-semibold text-gray-900 truncate">{list.name}</span>
                  <span className="text-xs text-gray-600 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
                    {list.itemCount} {list.itemCount === 1 ? "item" : "items"}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    title="Open"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/editor/${list.id}`);
                    }}
                    className="p-1.5 text-gray-600 hover:text-gray-200 rounded transition-colors"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(list.id);
                    }}
                    className="p-1.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {list.description && <p className="text-sm text-gray-600 mt-1">{list.description}</p>}

              {confirmDelete === list.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="mt-3 pt-3 border-t border-gray-300 flex items-center gap-3"
                >
                  <span className="text-sm text-gray-600">Delete this list and all its items?</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(list.id)}
                    className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded-lg"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(null)}
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
