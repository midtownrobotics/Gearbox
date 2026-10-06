import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import type { Category, Skill, Tree } from "../../shared/progress";
import { useSkillData } from "../../shared/skill-data";
import { Button, Card, ErrorBanner, Field, Page, inputClass } from "../../shared/ui";
import { useSave } from "./use-save";

/** Mentors: one tree's name and gate, its categories, and each category's skills. */
export function TreeEditorPage() {
  const user = useAuthUser();
  const { trees } = useSkillData();
  const { treeId } = useParams();
  const tree = trees.find((t) => String(t.id) === treeId);

  if (!user.isMentor) {
    return (
      <Page title="Edit Trees">
        <ErrorBanner message="Only mentors can edit the skill trees." />
      </Page>
    );
  }
  if (!tree) {
    return (
      <Page title="Edit Trees">
        <ErrorBanner message="That tree doesn't exist anymore." />
        <BackLink />
      </Page>
    );
  }

  return (
    <Page title={`${tree.icon} ${tree.name}`.trim()} actions={<BackLink />}>
      <TreeSettings key={tree.id} tree={tree} others={trees.filter((t) => t.id !== tree.id)} />
      {tree.categories.map((category) => (
        <CategoryEditor
          key={category.id}
          category={category}
          others={tree.categories.filter((c) => c.id !== category.id)}
        />
      ))}
      <AddCategory tree={tree} />
    </Page>
  );
}

function BackLink() {
  return (
    <Link to="/edit" className="text-sm font-semibold text-primary-600 hover:underline">
      ← All trees
    </Link>
  );
}

/** Checkboxes for what something comes after. */
function Requires({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: number; name: string }[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset>
      <legend className="text-sm font-medium text-secondary-700">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-sm text-secondary-700">
            <input
              type="checkbox"
              checked={value.includes(option.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id),
                )
              }
            />
            {option.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TreeSettings({ tree, others }: { tree: Tree; others: Tree[] }) {
  const navigate = useNavigate();
  const { save, saving, error } = useSave();
  const [name, setName] = useState(tree.name);
  const [icon, setIcon] = useState(tree.icon);
  const [subtitle, setSubtitle] = useState(tree.subtitle);
  const [requiresTreeId, setRequiresTreeId] = useState(tree.requiresTreeId);
  const param = { id: String(tree.id) };

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(() =>
      api.trees[":id"].$patch({ param, json: { name, icon, subtitle, requiresTreeId } }),
    );
  }

  async function remove() {
    const sure = window.confirm(
      `Delete “${tree.name}”, its categories and skills, and everyone's progress on them? This can't be undone.`,
    );
    if (sure && (await save(() => api.trees[":id"].$delete({ param })))) navigate("/edit");
  }

  return (
    <Card title="Tree">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[5rem_1fr]">
          <Field label="Icon">
            <input
              className={`${inputClass} text-center`}
              maxLength={16}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
            />
          </Field>
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
        <Field label="Subtitle">
          <input
            className={inputClass}
            maxLength={120}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </Field>
        <Field
          label="Opens after"
          hint="Students must finish that whole tree before this one opens."
        >
          <select
            className={inputClass}
            value={requiresTreeId ?? ""}
            onChange={(e) => setRequiresTreeId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Nothing: open from the start</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.icon} {other.name}
              </option>
            ))}
          </select>
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-between gap-3">
          <Button type="submit" disabled={saving || !name.trim()}>
            Save
          </Button>
          <Button variant="danger" disabled={saving} onClick={remove}>
            Delete tree
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CategoryEditor({ category, others }: { category: Category; others: Category[] }) {
  const { save, saving, error } = useSave();
  const [name, setName] = useState(category.name);
  const [requires, setRequires] = useState(category.requires);
  const param = { id: String(category.id) };

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(() => api.categories[":id"].$patch({ param, json: { name, requires } }));
  }

  function remove() {
    const sure = window.confirm(
      `Delete “${category.name}”, its ${category.skills.length} skills, and everyone's progress on them? This can't be undone.`,
    );
    if (sure) void save(() => api.categories[":id"].$delete({ param }));
  }

  return (
    <Card title="Category">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <input
            className={inputClass}
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Requires label="Opens after" options={others} value={requires} onChange={setRequires} />
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-between gap-3">
          <Button type="submit" variant="secondary" disabled={saving || !name.trim()}>
            Save category
          </Button>
          <Button variant="danger" disabled={saving} onClick={remove}>
            Delete category
          </Button>
        </div>
      </form>
      <h3 className="mb-1 mt-5 font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
        Skills
      </h3>
      <ul className="divide-y divide-secondary-100">
        {category.skills.map((skill) => (
          <SkillEditor
            key={skill.id}
            skill={skill}
            others={category.skills.filter((s) => s.id !== skill.id)}
          />
        ))}
      </ul>
      <AddSkill category={category} />
    </Card>
  );
}

function SkillEditor({ skill, others }: { skill: Skill; others: Skill[] }) {
  const { save, saving, error } = useSave();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(skill.name);
  const [summary, setSummary] = useState(skill.summary);
  const [description, setDescription] = useState(skill.description);
  const [requires, setRequires] = useState(skill.requires);
  const param = { id: String(skill.id) };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await save(() =>
      api.skills[":id"].$patch({ param, json: { name, summary, description, requires } }),
    );
    if (ok) setOpen(false);
  }

  function remove() {
    const sure = window.confirm(
      `Delete “${skill.name}” and everyone's progress on it? This can't be undone.`,
    );
    if (sure) void save(() => api.skills[":id"].$delete({ param }));
  }

  if (!open) {
    return (
      <li className="flex items-center gap-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-secondary-900">{skill.name}</p>
          {skill.summary && <p className="truncate text-xs text-secondary-500">{skill.summary}</p>}
        </div>
        <Button variant="secondary" className="py-1" onClick={() => setOpen(true)}>
          Edit
        </Button>
      </li>
    );
  }

  return (
    <li className="py-3">
      <form onSubmit={submit} className="space-y-3 rounded-lg bg-secondary-50 p-4">
        <Field label="Name">
          <input
            className={inputClass}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Summary" hint="A few words shown on the skill's box.">
          <input
            className={inputClass}
            maxLength={120}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <Field label="Description" hint="What a student must show to have it signed off.">
          <textarea
            className={inputClass}
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Requires label="Comes after" options={others} value={requires} onChange={setRequires} />
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap justify-between gap-3">
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || !name.trim()}>
              Save skill
            </Button>
            <Button variant="secondary" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <Button variant="danger" disabled={saving} onClick={remove}>
            Delete skill
          </Button>
        </div>
      </form>
    </li>
  );
}

function AddSkill({ category }: { category: Category }) {
  const { save, saving, error } = useSave();
  const [name, setName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await save(() =>
      api.categories[":id"].skills.$post({ param: { id: String(category.id) }, json: { name } }),
    );
    if (ok) setName("");
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
      <input
        className={`${inputClass} min-w-48 flex-1`}
        placeholder="New skill's name"
        aria-label={`New skill in ${category.name}`}
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={saving || !name.trim()}>
        Add skill
      </Button>
      {error && (
        <div className="w-full">
          <ErrorBanner message={error} />
        </div>
      )}
    </form>
  );
}

function AddCategory({ tree }: { tree: Tree }) {
  const { save, saving, error } = useSave();
  const [name, setName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await save(() =>
      api.trees[":id"].categories.$post({ param: { id: String(tree.id) }, json: { name } }),
    );
    if (ok) setName("");
  }

  return (
    <Card title="New category">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} min-w-48 flex-1`}
          placeholder="e.g. Hand Tools"
          aria-label="New category's name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={saving || !name.trim()}>
          Add category
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
    </Card>
  );
}
