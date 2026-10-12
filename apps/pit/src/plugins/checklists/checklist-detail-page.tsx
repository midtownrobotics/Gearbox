import {
  Button,
  Card,
  ConfirmButton,
  ErrorBanner,
  Field,
  Loading,
  Page,
  focusRing,
  inputClass,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchItems } from "../../shared/getters/items";
import { fetchList } from "../../shared/getters/lists";
import type { ChecklistItem, ChecklistList } from "../../shared/getters/types";

/** The item or topic being edited: its name and, for an item, its description. */
type ItemDraft = { id: number; name: string; description: string } | null;

const arrowButton = `rounded p-1 leading-none text-secondary-500 hover:text-secondary-900 disabled:cursor-not-allowed disabled:opacity-20 ${focusRing}`;

function BackLink() {
  return (
    <Link to="/editor" className="text-sm text-secondary-500 hover:text-primary-600">
      ← All checklists
    </Link>
  );
}

export function ChecklistDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [list, setList] = useState<ChecklistList | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // The checklist's own name and description, as typed; null until the list has loaded.
  const [listDraft, setListDraft] = useState<{ name: string; description: string } | null>(null);
  const [savingList, setSavingList] = useState(false);

  const [editingItem, setEditingItem] = useState<ItemDraft>(null);

  const [adding, setAdding] = useState(false);
  const [addingType, setAddingType] = useState<"item" | "topic">("item");
  const [newItemName, setNewItemName] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [addError, setAddError] = useState("");

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
      setListDraft(
        (prev) => prev ?? { name: listData.name, description: listData.description ?? "" },
      );
      setItems(itemsData);
    } catch {}
    setLoading(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load captures id via closure, re-runs when id changes
  useEffect(() => {
    setListDraft(null);
    load();
  }, [id]);

  async function saveList() {
    if (!list || !listDraft) return;
    const name = listDraft.name.trim();
    const description = listDraft.description.trim() || null;
    if (!name) return;
    const param = { id: String(list.id) };
    setSavingList(true);
    try {
      if (name !== list.name) {
        const res = await api.lists[":id"].name.$patch({ param, json: { name } });
        if (!res.ok) {
          setBanner(await getErrorMessage(res as unknown as Response));
          return;
        }
      }
      if (description !== list.description) {
        const res = await api.lists[":id"].description.$patch({ param, json: { description } });
        if (!res.ok) {
          setBanner(await getErrorMessage(res as unknown as Response));
          return;
        }
      }
      setBanner(null);
      setListDraft({ name, description: description ?? "" });
      await load();
    } finally {
      setSavingList(false);
    }
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
    setEditingItem(null);
    await load();
  }

  async function saveItemEdit(item: ChecklistItem) {
    if (!list || !editingItem) return;
    const name = editingItem.name.trim();
    if (!name) return;
    const param = { id: String(list.id), itemId: String(item.id) };
    if (name !== item.name) {
      const res = await api.lists[":id"].items[":itemId"].name.$patch({ param, json: { name } });
      if (!res.ok) {
        setBanner(await getErrorMessage(res as unknown as Response));
        return;
      }
    }
    const description = editingItem.description.trim() || null;
    if (item.type === "item" && description !== item.description) {
      const res = await api.lists[":id"].items[":itemId"].description.$patch({
        param,
        json: { description },
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
      <Page title="Edit Checklists" width="narrow" actions={<BackLink />}>
        <Loading />
      </Page>
    );
  }

  if (notFound || !list || !listDraft) {
    return (
      <Page title="Edit Checklists" width="narrow" actions={<BackLink />}>
        <p className="text-sm text-secondary-500">Checklist not found.</p>
      </Page>
    );
  }

  const sortedItems = [...items].sort((a, b) => a.index - b.index);
  const listChanged =
    listDraft.name.trim() !== list.name ||
    (listDraft.description.trim() || null) !== list.description;

  return (
    <Page title={list.name} width="narrow" actions={<BackLink />}>
      {banner && <ErrorBanner message={banner} />}

      <Card title="Checklist" className="space-y-3">
        <Field label="Name">
          <input
            type="text"
            value={listDraft.name}
            onChange={(e) => setListDraft({ ...listDraft, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveList();
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            value={listDraft.description}
            onChange={(e) => setListDraft({ ...listDraft, description: e.target.value })}
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </Field>
        <div>
          <Button
            onClick={saveList}
            disabled={savingList || !listChanged || !listDraft.name.trim()}
          >
            {savingList ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>

      {/* Items header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
          Items · {items.length}
        </h2>
        {!adding && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setAdding(true);
                setAddingType("topic");
                setBanner(null);
              }}
            >
              Add a topic
            </Button>
            <Button
              onClick={() => {
                setAdding(true);
                setAddingType("item");
                setBanner(null);
              }}
            >
              Add an item
            </Button>
          </div>
        )}
      </div>

      {adding && (
        <Card title={addingType === "topic" ? "New topic" : "New item"} className="space-y-3">
          <Field label="Name">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => {
                setNewItemName(e.target.value);
                setAddError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddItem();
                if (e.key === "Escape") setAdding(false);
              }}
              className={inputClass}
              // biome-ignore lint/a11y/noAutofocus: intentional — user just opened the add form
              autoFocus
            />
          </Field>
          {addingType === "item" && (
            <Field label="Description (optional)">
              <textarea
                value={newItemDesc}
                onChange={(e) => setNewItemDesc(e.target.value)}
                rows={2}
                className={`${inputClass} resize-none`}
              />
            </Field>
          )}
          {addError && <p className="text-xs text-red-700">{addError}</p>}
          <div className="flex gap-2">
            <Button onClick={handleAddItem}>Add</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAdding(false);
                setNewItemName("");
                setNewItemDesc("");
                setAddError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {items.length === 0 && !adding && (
        <p className="text-sm text-secondary-500">No items yet. Add one above.</p>
      )}

      <div className="space-y-2">
        {sortedItems.map((item, pos) => {
          const topic = item.type === "topic";
          const editing = editingItem?.id === item.id ? editingItem : null;
          return (
            <div
              key={item.id}
              className={
                topic
                  ? "rounded-lg border border-dashed border-secondary-300 px-4 py-2.5"
                  : "rounded-xl border border-secondary-200 bg-surface p-4"
              }
            >
              {editing ? (
                <div className="space-y-3">
                  <Field label="Name">
                    <input
                      type="text"
                      value={editing.name}
                      onChange={(e) => setEditingItem({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveItemEdit(item);
                        if (e.key === "Escape") setEditingItem(null);
                      }}
                      className={inputClass}
                      // biome-ignore lint/a11y/noAutofocus: intentional — user just opened the edit form
                      autoFocus
                    />
                  </Field>
                  {!topic && (
                    <Field label="Description (optional)">
                      <textarea
                        value={editing.description}
                        onChange={(e) =>
                          setEditingItem({ ...editing, description: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingItem(null);
                        }}
                        rows={2}
                        className={`${inputClass} resize-none`}
                      />
                    </Field>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => saveItemEdit(item)} disabled={!editing.name.trim()}>
                      Save
                    </Button>
                    <Button variant="secondary" onClick={() => setEditingItem(null)}>
                      Cancel
                    </Button>
                    <ConfirmButton
                      label="Delete"
                      question={
                        topic
                          ? `Delete the topic ${item.name}? Its items stay.`
                          : `Delete ${item.name}? Its open issues go with it.`
                      }
                      onConfirm={() => handleDeleteItem(item.id)}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveItem(item.id, "up")}
                      disabled={pos === 0}
                      className={arrowButton}
                      aria-label="Move up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(item.id, "down")}
                      disabled={pos === sortedItems.length - 1}
                      className={arrowButton}
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        topic
                          ? "text-xs font-bold uppercase tracking-widest text-secondary-500"
                          : "text-sm font-medium text-secondary-900"
                      }
                    >
                      {item.name}
                    </p>
                    {item.description && (
                      <p className="mt-0.5 text-xs text-secondary-500">{item.description}</p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setEditingItem({
                        id: item.id,
                        name: item.name,
                        description: item.description ?? "",
                      })
                    }
                  >
                    Edit
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Page>
  );
}
