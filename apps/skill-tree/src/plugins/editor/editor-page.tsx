import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { treeSkills } from "../../shared/progress";
import { useSkillData } from "../../shared/skill-data";
import { Button, Card, ErrorBanner, Field, Page, inputClass } from "../../shared/ui";
import { TreeSetCard } from "./tree-set-card";
import { useSave } from "./use-save";

/** Mentors: the list of trees, their order, and adding a new one. */
export function EditorPage() {
  const user = useAuthUser();
  const { trees, reloadTrees } = useSkillData();
  const navigate = useNavigate();
  const order = useSave();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (!user.isMentor) {
    return (
      <Page title="Edit Trees">
        <ErrorBanner message="Only mentors can edit the skill trees." />
      </Page>
    );
  }

  function move(index: number, by: -1 | 1) {
    const ids = trees.map((tree) => tree.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    void order.save(() => api.trees.order.$put({ json: { ids } }));
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await api.trees.$post({ json: { name, icon } });
      if (!res.ok) return setCreateError(await getErrorMessage(res));
      const { id } = await res.json();
      await reloadTrees();
      navigate(`/edit/${id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Page title="Edit Trees">
      <TreeSetCard />
      <Card title="Trees">
        {order.error && <ErrorBanner message={order.error} />}
        {trees.length === 0 ? (
          <p className="text-sm text-secondary-500">There are no skill trees yet.</p>
        ) : (
          <ul className="divide-y divide-secondary-100">
            {trees.map((tree, index) => (
              <li key={tree.id} className="flex items-center gap-3 py-2.5">
                <span className="w-8 text-center text-2xl" aria-hidden="true">
                  {tree.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/edit/${tree.id}`}
                    className="font-semibold text-secondary-900 hover:text-primary-600 hover:underline"
                  >
                    {tree.name}
                  </Link>
                  <p className="truncate text-xs text-secondary-500">
                    {tree.categories.length} categories · {treeSkills(tree).length} skills
                    {tree.subtitle && ` · ${tree.subtitle}`}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="px-2.5 py-1"
                  aria-label={`Move ${tree.name} up`}
                  disabled={index === 0 || order.saving}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  className="px-2.5 py-1"
                  aria-label={`Move ${tree.name} down`}
                  disabled={index === trees.length - 1 || order.saving}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="New tree">
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <div className="w-20">
            <Field label="Icon">
              <input
                className={`${inputClass} text-center`}
                placeholder="🔧"
                maxLength={16}
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
              />
            </Field>
          </div>
          <div className="min-w-48 flex-1">
            <Field label="Name">
              <input
                className={inputClass}
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" disabled={creating || !name.trim()}>
            Add tree
          </Button>
        </form>
        {createError && (
          <div className="mt-3">
            <ErrorBanner message={createError} />
          </div>
        )}
      </Card>
    </Page>
  );
}
