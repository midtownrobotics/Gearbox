import { type FormEvent, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { STATUS_LABEL, type Status } from "../../shared/progress";
import { useSkillData } from "../../shared/skill-data";
import { Button, Card, ErrorBanner, Field, Page, SuccessBanner, inputClass } from "../../shared/ui";

/** Kiosk PINs are three digits; a full one is looked up without pressing Enter. */
const PIN_LENGTH = 3;

type Person = { userId: string; name: string };
type PickedSkill = { id: number; label: string };

const STATUSES: Status[] = ["complete", "in-progress", "not-started"];

/** Mentors: one status for several people on several skills, e.g. after a group training. */
export function SignOffPage() {
  const user = useAuthUser();
  const { reloadStudents } = useSkillData();
  const [people, setPeople] = useState<Person[]>([]);
  const [skills, setSkills] = useState<PickedSkill[]>([]);
  const [status, setStatus] = useState<Status>("complete");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (!user.isMentor) {
    return (
      <Page title="Sign Off">
        <ErrorBanner message="Only mentors can sign skills off." />
      </Page>
    );
  }

  const addPerson = (person: Person) => {
    setSaved(null);
    setPeople((current) =>
      current.some((p) => p.userId === person.userId) ? current : [...current, person],
    );
  };

  async function apply() {
    setError(null);
    setSaved(null);
    setSaving(true);
    try {
      const res = await api.progress.$post({
        json: { userIds: people.map((p) => p.userId), skillIds: skills.map((s) => s.id), status },
      });
      if (!res.ok) return setError(await getErrorMessage(res));
      setSaved(
        `Marked ${count(skills.length, "skill")} ${STATUS_LABEL[status].toLowerCase()} for ${count(people.length, "person", "people")}.`,
      );
      setSkills([]);
      await reloadStudents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="Sign Off">
      <p className="text-sm text-secondary-500">
        Set one status for several people on several skills at once. This skips the locks: use it
        for what you've seen them do.
      </p>
      <Card title="People">
        <PeoplePicker onAdd={addPerson} />
        <Chips
          items={people.map((p) => ({ key: p.userId, label: p.name }))}
          empty="No one added yet."
          onRemove={(key) => setPeople((current) => current.filter((p) => p.userId !== key))}
        />
      </Card>
      <Card title="Skills">
        <SkillPicker picked={skills} onChange={setSkills} />
        <Chips
          items={skills.map((s) => ({ key: String(s.id), label: s.label }))}
          empty="No skills picked yet."
          onRemove={(key) => setSkills((current) => current.filter((s) => String(s.id) !== key))}
        />
      </Card>
      <Card title="Status">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field label="Set to">
              <select
                className={inputClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
              >
                {STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_LABEL[option]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Button disabled={saving || people.length === 0 || skills.length === 0} onClick={apply}>
            {saving
              ? "Saving…"
              : `Apply to ${count(people.length, "person", "people")} × ${count(skills.length, "skill")}`}
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {error && <ErrorBanner message={error} />}
          {saved && <SuccessBanner message={saved} />}
        </div>
      </Card>
    </Page>
  );
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Chips({
  items,
  empty,
  onRemove,
}: {
  items: { key: string; label: string }[];
  empty: string;
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) return <p className="mt-3 text-sm text-secondary-400">{empty}</p>;
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex items-center gap-1 rounded-full border border-secondary-300 bg-secondary-50 py-1 pl-3 pr-1 text-sm text-secondary-800"
        >
          {item.label}
          <button
            type="button"
            aria-label={`Remove ${item.label}`}
            onClick={() => onRemove(item.key)}
            className="rounded-full px-1.5 text-secondary-400 hover:bg-secondary-200 hover:text-secondary-900"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Adds people by kiosk PIN (students can type their own) or by name. */
function PeoplePicker({ onAdd }: { onAdd: (person: Person) => void }) {
  const { students } = useSkillData();
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function lookUp(value: string) {
    setPinError(null);
    const res = await api.students["by-pin"][":pin"].$get({ param: { pin: value } });
    setPin("");
    if (!res.ok) return setPinError(await getErrorMessage(res));
    onAdd(await res.json());
  }

  function onPinChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    setPinError(null);
    if (digits.length === PIN_LENGTH) void lookUp(digits);
  }

  const query = search.trim().toLowerCase();
  const matches = query
    ? students.filter((s) => s.name.toLowerCase().includes(query)).slice(0, 8)
    : [];

  function addFirstMatch(e: FormEvent) {
    e.preventDefault();
    if (matches[0]) {
      onAdd(matches[0]);
      setSearch("");
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
      <Field label="PIN" hint={pinError ?? undefined}>
        <input
          className={`${inputClass} text-center tracking-widest`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="123"
          value={pin}
          onChange={(e) => onPinChange(e.target.value)}
        />
      </Field>
      <form onSubmit={addFirstMatch}>
        <Field label="Or search by name">
          <input
            className={inputClass}
            placeholder="Type a name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        {matches.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {matches.map((match) => (
              <li key={match.userId}>
                <Button
                  variant="secondary"
                  className="py-1"
                  onClick={() => {
                    onAdd(match);
                    setSearch("");
                  }}
                >
                  + {match.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {query && matches.length === 0 && (
          <p className="mt-2 text-xs text-secondary-500">No student by that name.</p>
        )}
      </form>
    </div>
  );
}

/** Picks skills a category at a time. */
function SkillPicker({
  picked,
  onChange,
}: {
  picked: PickedSkill[];
  onChange: (skills: PickedSkill[]) => void;
}) {
  const { trees } = useSkillData();
  const [treeId, setTreeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const tree = trees.find((t) => String(t.id) === treeId);
  const category = tree?.categories.find((c) => String(c.id) === categoryId);
  const pickedIds = new Set(picked.map((s) => s.id));
  const labelled = (category?.skills ?? []).map((skill) => ({
    id: skill.id,
    name: skill.name,
    label: `${tree?.name} › ${category?.name} › ${skill.name}`,
  }));
  const allPicked = labelled.length > 0 && labelled.every((s) => pickedIds.has(s.id));

  const toggle = (skill: PickedSkill) =>
    onChange(
      pickedIds.has(skill.id) ? picked.filter((s) => s.id !== skill.id) : [...picked, skill],
    );
  const toggleAll = () =>
    onChange(
      allPicked
        ? picked.filter((s) => !labelled.some((l) => l.id === s.id))
        : [
            ...picked,
            ...labelled.filter((l) => !pickedIds.has(l.id)).map(({ id, label }) => ({ id, label })),
          ],
    );

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tree">
          <select
            className={inputClass}
            value={treeId}
            onChange={(e) => {
              setTreeId(e.target.value);
              setCategoryId("");
            }}
          >
            <option value="">Choose a tree…</option>
            {trees.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            className={inputClass}
            value={categoryId}
            disabled={!tree}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Choose a category…</option>
            {tree?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {category && (
        <div className="rounded-lg border border-secondary-200 p-3">
          {labelled.length === 0 ? (
            <p className="text-sm text-secondary-500">This category has no skills yet.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 border-b border-secondary-200 pb-2 text-sm font-semibold text-secondary-800">
                <input type="checkbox" checked={allPicked} onChange={toggleAll} />
                All of {category.name}
              </label>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {labelled.map((skill) => (
                  <li key={skill.id}>
                    <label className="flex items-center gap-2 text-sm text-secondary-700">
                      <input
                        type="checkbox"
                        checked={pickedIds.has(skill.id)}
                        onChange={() => toggle({ id: skill.id, label: skill.label })}
                      />
                      {skill.name}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
