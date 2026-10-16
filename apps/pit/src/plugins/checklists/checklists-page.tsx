import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorBanner,
  Field,
  Loading,
  Page,
  TextField,
  buttonClass,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchLists } from "../../shared/getters/lists";
import type { ChecklistList } from "../../shared/getters/types";

export function ChecklistsPage() {
  const [lists, setLists] = useState<ChecklistList[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [createError, setCreateError] = useState("");

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
      return;
    }
    await load();
  }

  if (loading) {
    return (
      <Page title="Edit Checklists" width="narrow">
        <Loading />
      </Page>
    );
  }

  return (
    <Page
      title="Edit Checklists"
      width="narrow"
      actions={
        !creating && (
          <Button
            onClick={() => {
              setCreating(true);
              setBanner(null);
            }}
          >
            New list
          </Button>
        )
      }
    >
      {banner && <ErrorBanner message={banner} />}

      {creating && (
        <Card title="New checklist" className="space-y-3">
          <Field label="Name">
            <TextField
              kind="title"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setCreateError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              autoFocus
            />
          </Field>
          <Field label="Description (optional)">
            <TextField
              multiline
              kind="note"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </Field>
          {createError && <p className="text-xs text-red-700">{createError}</p>}
          <div className="flex gap-2">
            <Button onClick={handleCreate}>Create</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setNewDesc("");
                setCreateError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {lists.length === 0 && !creating && (
        <p className="text-sm text-secondary-500">No checklists yet. Create one to get started.</p>
      )}

      <div className="space-y-3">
        {lists.map((list) => (
          <div key={list.id} className="rounded-xl border border-secondary-200 bg-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/editor/${list.id}`} className="group min-w-0 flex-1">
                <span className="flex items-center gap-3">
                  <span className="truncate text-lg font-semibold text-secondary-900 group-hover:text-primary-600">
                    {list.name}
                  </span>
                  <Badge>
                    {list.itemCount} {list.itemCount === 1 ? "item" : "items"}
                  </Badge>
                </span>
                {list.description && (
                  <span className="mt-1 block text-sm text-secondary-500">{list.description}</span>
                )}
              </Link>
              <Link to={`/editor/${list.id}`} className={buttonClass("secondary", "sm")}>
                Edit
              </Link>
              <ConfirmButton
                size="sm"
                label="Delete"
                question={`Delete ${list.name} and all its items? This can't be undone.`}
                onConfirm={() => handleDelete(list.id)}
              />
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
