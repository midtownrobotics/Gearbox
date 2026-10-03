import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchItems } from "../../shared/getters/items";
import { fetchList } from "../../shared/getters/lists";
import type { ChecklistItem, ChecklistList } from "../../shared/getters/types";

type ItemEditState = { id: number; field: "name" | "description"; value: string } | null;

export function ChecklistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [list, setList] = useState<ChecklistList | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const [editingListField, setEditingListField] = useState<"name" | "description" | null>(null);
  const [listDraft, setListDraft] = useState("");

  const [editingItem, setEditingItem] = useState<ItemEditState>(null);

  const [adding, setAdding] = useState(false);
  const [addingType, setAddingType] = useState<"item" | "topic">("item");
  const [newItemName, setNewItemName] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [addError, setAddError] = useState("");

  const [confirmDeleteItem, setConfirmDeleteItem] = useState<number | null>(null);

  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  async function load() {
    if (!id) return;
    try {
      const [listData, itemsData] = await Promise.all([fetchList(id), fetchItems(id)]);
      if (!listData) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setList(listData);
      setItems(itemsData);
    } catch {}
    setLoading(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load captures id via closure, re-runs when id changes
  useEffect(() => {
    load();
  }, [id]);
  useEffect(() => {
    if (editingListField || editingItem) editInputRef.current?.focus();
  }, [editingListField, editingItem]);

  async function saveListName() {
    if (!list || !listDraft.trim()) return;
    const res = await api.lists[":id"].name.$patch({
      param: { id: String(list.id) },
      json: { name: listDraft.trim() },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setEditingListField(null);
    setBanner(null);
    await load();
  }

  async function saveListDescription() {
    if (!list) return;
    const res = await api.lists[":id"].description.$patch({
      param: { id: String(list.id) },
      json: { description: listDraft.trim() || null },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setEditingListField(null);
    setBanner(null);
    await load();
  }

  async function handleAddItem() {
    if (!list) return;
    if (!newItemName.trim()) {
      setAddError("Name is required.");
      return;
    }
    const res = await api.lists[":id"].items.$post({
      param: { id: String(list.id) },
      json: {
        name: newItemName.trim(),
        description: addingType === "item" ? newItemDesc.trim() || null : null,
        type: addingType,
      },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setNewItemName("");
    setNewItemDesc("");
    setAdding(false);
    setAddError("");
    setBanner(null);
    await load();
  }

  async function handleDeleteItem(itemId: number) {
    if (!list) return;
    const res = await api.lists[":id"].items[":itemId"].$delete({
      param: { id: String(list.id), itemId: String(itemId) },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setConfirmDeleteItem(null);
    await load();
  }

  async function saveItemEdit() {
    if (!list || !editingItem) return;
    if (editingItem.field === "name") {
      if (!editingItem.value.trim()) return;
      const res = await api.lists[":id"].items[":itemId"].name.$patch({
        param: { id: String(list.id), itemId: String(editingItem.id) },
        json: { name: editingItem.value.trim() },
      });
      if (!res.ok) {
        setBanner(await getErrorMessage(res as unknown as Response));
        return;
      }
    } else {
      const res = await api.lists[":id"].items[":itemId"].description.$patch({
        param: { id: String(list.id), itemId: String(editingItem.id) },
        json: { description: editingItem.value.trim() || null },
      });
      if (!res.ok) {
        setBanner(await getErrorMessage(res as unknown as Response));
        return;
      }
    }
    setEditingItem(null);
    setBanner(null);
    await load();
  }

  async function moveItem(itemId: number, direction: "up" | "down") {
    if (!list) return;
    const sorted = [...items].sort((a, b) => a.index - b.index);
    const pos = sorted.findIndex((i) => i.id === itemId);
    if (direction === "up" && pos === 0) return;
    if (direction === "down" && pos === sorted.length - 1) return;

    const swapPos = direction === "up" ? pos - 1 : pos + 1;
    const newOrder = [...sorted];
    [newOrder[pos], newOrder[swapPos]] = [newOrder[swapPos], newOrder[pos]];

    // Optimistic update
    setItems(newOrder.map((item, i) => ({ ...item, index: i })));

    const res = await api.lists[":id"].items.reorder.$patch({
      param: { id: String(list.id) },
      json: { ids: newOrder.map((i) => i.id) },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      await load(); // revert
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </main>
    );
  }

  if (notFound || !list) {
    return (
      <main className="min-h-screen bg-page flex flex-col items-center justify-center gap-4">
        <p className="text-gray-600">Checklist not found.</p>
        <button
          type="button"
          onClick={() => navigate("/editor")}
          className="text-red-400 hover:text-red-300 text-sm underline"
        >
          Back to Checklists
        </button>
      </main>
    );
  }

  const sortedItems = [...items].sort((a, b) => a.index - b.index);

  return (
    <main className="min-h-screen bg-page text-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <button
          type="button"
          onClick={() => navigate("/editor")}
          className="text-sm text-gray-600 hover:text-gray-700 transition-colors"
        >
          ← Back to Checklists
        </button>

        {banner && (
          <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-2">
            {banner}
          </p>
        )}

        {/* List header */}
        <div className="space-y-2">
          {editingListField === "name" ? (
            <div className="flex gap-2">
              <input
                ref={editInputRef as React.RefObject<HTMLInputElement>}
                value={listDraft}
                onChange={(e) => setListDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveListName();
                  if (e.key === "Escape") setEditingListField(null);
                }}
                className="flex-1 bg-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-xl font-bold text-gray-900 focus:outline-none focus:border-red-500"
              />
              <button
                type="button"
                onClick={saveListName}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingListField(null)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{list.name}</h1>
              <button
                type="button"
                title="Rename"
                onClick={() => {
                  setEditingListField("name");
                  setListDraft(list.name);
                }}
                className="p-1.5 text-gray-600 hover:text-gray-700 rounded transition-colors"
              >
                ✎
              </button>
            </div>
          )}

          {editingListField === "description" ? (
            <div className="flex gap-2">
              <textarea
                ref={editInputRef as React.RefObject<HTMLTextAreaElement>}
                value={listDraft}
                onChange={(e) => setListDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditingListField(null);
                }}
                rows={2}
                className="flex-1 bg-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-red-500 resize-none"
              />
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={saveListDescription}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingListField(null)}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingListField("description");
                setListDraft(list.description ?? "");
              }}
              className="text-sm text-gray-600 hover:text-gray-700 transition-colors text-left"
            >
              {list.description ?? <span className="italic">Add description…</span>}
            </button>
          )}
        </div>

        {/* Items header */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
          <h2 className="text-lg font-semibold text-gray-200">
            Items <span className="text-gray-600 font-normal text-sm">({items.length})</span>
          </h2>
          {!adding && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setAddingType("topic");
                  setBanner(null);
                }}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold rounded-lg transition-colors"
              >
                + Add Topic
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setAddingType("item");
                  setBanner(null);
                }}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                + Add Item
              </button>
            </div>
          )}
        </div>

        {adding && (
          <div className="bg-white rounded-xl border border-gray-300 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">
              {addingType === "topic" ? "New Topic" : "New Item"}
            </p>
            <input
              type="text"
              placeholder={addingType === "topic" ? "Topic name" : "Item name"}
              value={newItemName}
              onChange={(e) => {
                setNewItemName(e.target.value);
                setAddError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddItem();
                if (e.key === "Escape") setAdding(false);
              }}
              className="w-full bg-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-red-500"
              // biome-ignore lint/a11y/noAutofocus: intentional — user just opened the add form
              autoFocus
            />
            {addingType === "item" && (
              <textarea
                placeholder="Description (optional)"
                value={newItemDesc}
                onChange={(e) => setNewItemDesc(e.target.value)}
                rows={2}
                className="w-full bg-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-red-500 resize-none"
              />
            )}
            {addError && <p className="text-red-400 text-xs">{addError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddItem}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewItemName("");
                  setNewItemDesc("");
                  setAddError("");
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {items.length === 0 && !adding && (
          <p className="text-gray-600 text-sm text-center py-8">No items yet. Add one above.</p>
        )}

        <div className="space-y-2">
          {sortedItems.map((item, pos) =>
            item.type === "topic" ? (
              <div
                key={item.id}
                className="rounded-lg border border-dashed border-gray-600 px-4 py-2.5"
              >
                {editingItem?.id === item.id && editingItem.field === "name" ? (
                  <div className="flex gap-2">
                    <input
                      ref={editInputRef as React.RefObject<HTMLInputElement>}
                      value={editingItem.value}
                      onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveItemEdit();
                        if (e.key === "Escape") setEditingItem(null);
                      }}
                      className="flex-1 bg-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-900 focus:outline-none focus:border-red-500"
                    />
                    <button
                      type="button"
                      onClick={saveItemEdit}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingItem(null)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveItem(item.id, "up")}
                        disabled={pos === 0}
                        className="p-1 text-gray-600 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors leading-none"
                        aria-label="Move up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(item.id, "down")}
                        disabled={pos === sortedItems.length - 1}
                        className="p-1 text-gray-600 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors leading-none"
                        aria-label="Move down"
                      >
                        ▼
                      </button>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-600 flex-1">
                      {item.name}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Rename"
                        onClick={() =>
                          setEditingItem({ id: item.id, field: "name", value: item.name })
                        }
                        className="p-1.5 text-gray-600 hover:text-gray-700 rounded transition-colors"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => setConfirmDeleteItem(item.id)}
                        className="p-1.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                {confirmDeleteItem === item.id && (
                  <div className="mt-2 pt-2 border-t border-gray-300 flex items-center gap-3">
                    <span className="text-xs text-gray-600">Delete this topic?</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded-lg"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteItem(null)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div key={item.id} className="bg-white rounded-xl border border-gray-300 p-4">
                {editingItem?.id === item.id && editingItem.field === "name" ? (
                  <div className="flex gap-2 mb-1">
                    <input
                      ref={editInputRef as React.RefObject<HTMLInputElement>}
                      value={editingItem.value}
                      onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveItemEdit();
                        if (e.key === "Escape") setEditingItem(null);
                      }}
                      className="flex-1 bg-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-red-500"
                    />
                    <button
                      type="button"
                      onClick={saveItemEdit}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingItem(null)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveItem(item.id, "up")}
                        disabled={pos === 0}
                        className="p-1 text-gray-600 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors leading-none"
                        aria-label="Move up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(item.id, "down")}
                        disabled={pos === sortedItems.length - 1}
                        className="p-1 text-gray-600 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors leading-none"
                        aria-label="Move down"
                      >
                        ▼
                      </button>
                    </div>
                    <span className="text-sm font-medium text-gray-900 flex-1">{item.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Rename"
                        onClick={() =>
                          setEditingItem({ id: item.id, field: "name", value: item.name })
                        }
                        className="p-1.5 text-gray-600 hover:text-gray-700 rounded transition-colors"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => setConfirmDeleteItem(item.id)}
                        className="p-1.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                {editingItem?.id === item.id && editingItem.field === "description" ? (
                  <div className="flex gap-2 mt-2">
                    <textarea
                      ref={editInputRef as React.RefObject<HTMLTextAreaElement>}
                      value={editingItem.value}
                      onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingItem(null);
                      }}
                      rows={2}
                      className="flex-1 bg-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-red-500 resize-none"
                    />
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={saveItemEdit}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingItem(null)}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingItem({
                        id: item.id,
                        field: "description",
                        value: item.description ?? "",
                      })
                    }
                    className="text-xs text-gray-600 hover:text-gray-600 transition-colors text-left mt-1 pl-8"
                  >
                    {item.description ?? <span className="italic">Add description…</span>}
                  </button>
                )}

                {confirmDeleteItem === item.id && (
                  <div className="mt-3 pt-3 border-t border-gray-300 flex items-center gap-3">
                    <span className="text-xs text-gray-600">Delete this item?</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded-lg"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteItem(null)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      </div>
    </main>
  );
}
