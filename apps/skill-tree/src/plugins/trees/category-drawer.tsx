import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import {
  type Category,
  type NodeState,
  STATUS_LABEL,
  type Skill,
  type Status,
  type Student,
  type Tree,
  countSkills,
  skillState,
  statusOf,
} from "../../shared/progress";
import { useSkillData } from "../../shared/skill-data";
import { STATE, StateBadge } from "../../shared/status";
import { ErrorBanner } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { TreeGraph } from "./tree-graph";

const STATUSES: Status[] = ["not-started", "in-progress", "complete"];

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

async function loadSignOffs(userId: string) {
  const res = await api.students[":userId"].$get({ param: { userId } });
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return (await res.json()).progress;
}

/**
 * A category's skills, in a panel over the right of the page. Picking a skill shows what it
 * takes, what it needs first and, for mentors, the buttons that sign it off.
 */
export function CategoryDrawer({
  tree,
  category,
  student,
  compact,
  skillId,
  onSelectSkill,
  onClose,
}: {
  tree: Tree;
  category: Category;
  student: Student | null;
  compact: boolean;
  skillId: number | null;
  onSelectSkill: (id: number | null) => void;
  onClose: () => void;
}) {
  const { trees } = useSkillData();
  const progress = student?.progress ?? {};
  const skill = category.skills.find((s) => s.id === skillId) ?? null;
  const counts = countSkills(category.skills, progress);
  const stateOf = (s: Skill) => skillState(tree, category, s, trees, progress);
  const userId = student?.userId;
  // Who signed each of this student's skills off, for the skill panel.
  const signOffs = useLoad(async () => (userId ? loadSignOffs(userId) : []), [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (skill) onSelectSkill(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [skill, onSelectSkill, onClose]);

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-40">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 w-full cursor-default bg-black/40"
      />
      <section
        aria-label={category.name}
        className="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col border-l border-line bg-surface shadow-2xl"
      >
        <header className="flex items-center gap-4 border-b border-line px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-secondary-300 px-3 py-1.5 text-sm font-semibold text-secondary-800 hover:bg-secondary-50"
          >
            ← Back
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold uppercase tracking-widest text-secondary-400">
              {tree.icon} {tree.name}
              {student && ` · ${student.name}`}
            </p>
            <h2 className="truncate text-2xl text-secondary-900">{category.name}</h2>
          </div>
          <p className="whitespace-nowrap text-sm text-secondary-500">
            <span className="font-semibold text-emerald-700">{counts.complete}</span> /{" "}
            {counts.total} skills
          </p>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto p-4 sm:p-8">
            {category.skills.length === 0 ? (
              <p className="text-sm text-secondary-500">This category has no skills yet.</p>
            ) : (
              <TreeGraph
                compact={compact}
                selectedId={skill?.id}
                onSelect={onSelectSkill}
                nodes={category.skills.map((s) => ({
                  id: s.id,
                  label: s.name,
                  sub: s.summary,
                  prereqs: s.requires,
                  state: stateOf(s),
                }))}
              />
            )}
          </div>
          {skill && (
            <SkillPanel
              key={`${student?.userId}:${skill.id}`}
              category={category}
              skill={skill}
              state={stateOf(skill)}
              stateOf={stateOf}
              student={student}
              signOff={signOffs.data?.find((p) => p.skillId === skill.id)}
              onSaved={signOffs.reload}
              onClose={() => onSelectSkill(null)}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function SkillPanel({
  category,
  skill,
  state,
  stateOf,
  student,
  signOff,
  onSaved,
  onClose,
}: {
  category: Category;
  skill: Skill;
  state: NodeState;
  stateOf: (skill: Skill) => NodeState;
  student: Student | null;
  /** Who last set this skill for the student, once loaded. */
  signOff?: { updatedByName: string | null; updatedAt: number };
  onSaved: () => void;
  onClose: () => void;
}) {
  const user = useAuthUser();
  const { markLocally, reloadStudents } = useSkillData();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const status = statusOf(student?.progress ?? {}, skill.id);
  const requires = category.skills.filter((s) => skill.requires.includes(s.id));

  async function setStatus(next: Status) {
    if (!student || next === status) return;
    setError(null);
    setSaving(true);
    markLocally([student.userId], [skill.id], next);
    try {
      const res = await api.students[":userId"].skills[":skillId"].$put({
        param: { userId: student.userId, skillId: String(skill.id) },
        json: { status: next },
      });
      if (!res.ok) setError(await getErrorMessage(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // Also puts back what was on screen if the save failed.
    await reloadStudents().catch(() => {});
    onSaved();
    setSaving(false);
  }

  return (
    <aside className="flex flex-col gap-4 overflow-y-auto bg-surface p-5 max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[75%] max-md:rounded-t-2xl max-md:border-t max-md:border-line max-md:shadow-2xl md:w-80 md:shrink-0 md:border-l md:border-line">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl leading-tight text-secondary-900">{skill.name}</h3>
          {skill.summary && <p className="mt-1 text-sm text-secondary-500">{skill.summary}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close skill"
          className="rounded-lg px-2 py-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-900"
        >
          ✕
        </button>
      </div>
      <div>
        <StateBadge state={state} />
        {signOff?.updatedByName && status !== "not-started" && (
          <p className="mt-1.5 text-xs text-secondary-500">
            Marked {STATUS_LABEL[status].toLowerCase()} by {signOff.updatedByName} on{" "}
            {dateFormat.format(signOff.updatedAt)}
          </p>
        )}
      </div>
      {skill.description && (
        <p className="text-sm leading-relaxed text-secondary-700">{skill.description}</p>
      )}
      {requires.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-secondary-400">
            Comes after
          </p>
          <ul className="space-y-1.5">
            {requires.map((required) => {
              const requiredState = stateOf(required);
              return (
                <li
                  key={required.id}
                  className="flex items-center gap-2 rounded-lg border border-secondary-200 px-3 py-1.5 text-sm text-secondary-700"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATE[requiredState].dot}`}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{required.name}</span>
                  <span className="text-xs text-secondary-400">{STATE[requiredState].label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {user.isMentor && student && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-secondary-400">
            Sign off for {student.name}
          </p>
          <div className="flex flex-col gap-1.5">
            {STATUSES.map((option) => (
              <button
                key={option}
                type="button"
                disabled={state === "locked" || saving}
                aria-pressed={option === status}
                onClick={() => setStatus(option)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold disabled:opacity-50 ${
                  option === status
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-secondary-300 text-secondary-800 hover:bg-secondary-50"
                }`}
              >
                {STATUS_LABEL[option]}
                {option === status && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
          {state === "locked" && (
            <p className="mt-2 text-xs text-secondary-500">
              Locked until what it comes after is complete.
            </p>
          )}
        </div>
      )}
      {error && <ErrorBanner message={error} />}
    </aside>
  );
}
