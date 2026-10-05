import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuthUser } from "../../shared/auth";
import {
  type Student,
  type Tree,
  categoryState,
  countSkills,
  lockedBehind,
  treeSkills,
} from "../../shared/progress";
import { useSkillData } from "../../shared/skill-data";
import { Legend } from "../../shared/status";
import { Card, Page, inputClass } from "../../shared/ui";
import { CategoryDrawer } from "./category-drawer";
import { TreeGraph } from "./tree-graph";

/** Whether the screen is phone-sized, where trees are drawn with smaller boxes. */
function useCompact() {
  const query = "(max-width: 699px)";
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

/** The student in the address, else yourself, else the first on the list. */
function pickStudent(students: Student[], wanted: string | null, self: string) {
  return (
    students.find((s) => s.userId === wanted) ??
    students.find((s) => s.userId === self) ??
    students[0] ??
    null
  );
}

/**
 * One tree for one student: its categories as a tree of boxes, each opening a panel with that
 * category's skills. The address holds the tree, student, category and skill, so a view can be
 * shared or reloaded.
 */
export function TreesPage() {
  const { trees, students } = useSkillData();
  const user = useAuthUser();
  const { treeId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const compact = useCompact();

  const setParam = useCallback(
    (changes: Record<string, string | number | null>) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(changes)) {
          if (value === null) next.delete(name);
          else next.set(name, String(value));
        }
        return next;
      });
    },
    [setParams],
  );
  const closeCategory = useCallback(() => setParam({ category: null, skill: null }), [setParam]);
  const selectSkill = useCallback((id: number | null) => setParam({ skill: id }), [setParam]);

  if (trees.length === 0) {
    return (
      <Page title="Skill Trees">
        <Card>
          <p className="text-secondary-500">
            There are no skill trees yet.{" "}
            {user.isMentor && (
              <Link to="/edit" className="font-semibold text-primary-600 hover:underline">
                Add the first one
              </Link>
            )}
          </p>
        </Card>
      </Page>
    );
  }

  const tree = trees.find((t) => String(t.id) === treeId);
  if (!tree) return <Navigate to={`/trees/${trees[0].id}?${params}`} replace />;

  const student = pickStudent(students, params.get("student"), user.userId);
  const progress = student?.progress ?? {};
  const counts = countSkills(treeSkills(tree), progress);
  const gate = lockedBehind(tree, trees, progress);
  const category = tree.categories.find((c) => String(c.id) === params.get("category")) ?? null;
  const studentQuery = student ? `?student=${encodeURIComponent(student.userId)}` : "";

  return (
    <Page
      title="Skill Trees"
      wide
      actions={
        students.length > 0 && (
          <label className="flex items-center gap-2 text-sm font-medium text-secondary-700">
            Student
            <select
              className={`${inputClass} w-56`}
              value={student?.userId ?? ""}
              onChange={(e) => setParam({ student: e.target.value })}
            >
              {students.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                  {s.userId === user.userId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
        )
      }
    >
      <TreeTabs
        trees={trees}
        current={tree}
        student={student}
        compact={compact}
        onPick={(id) => navigate(`/trees/${id}${studentQuery}`)}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-4xl" aria-hidden="true">
            {tree.icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl text-secondary-900">{tree.name}</h2>
            {tree.subtitle && <p className="text-sm text-secondary-500">{tree.subtitle}</p>}
          </div>
          <p className="rounded-full border border-secondary-200 px-3 py-1 text-sm text-secondary-500">
            <span className="font-semibold text-emerald-700">{counts.complete}</span> /{" "}
            {counts.total} skills
          </p>
        </div>
        {gate && (
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            🔒 {student ? `${student.name} needs` : "Students need"} to finish{" "}
            <Link to={`/trees/${gate.id}${studentQuery}`} className="font-semibold underline">
              {gate.icon} {gate.name}
            </Link>{" "}
            before this tree opens.
          </p>
        )}
        <div className="mt-4">
          <Legend />
        </div>
        <div className="mt-2 overflow-x-auto px-1 py-6">
          {tree.categories.length === 0 ? (
            <p className="text-sm text-secondary-500">This tree has no categories yet.</p>
          ) : (
            <TreeGraph
              compact={compact}
              selectedId={category?.id}
              onSelect={(id) => setParam({ category: id, skill: null })}
              nodes={tree.categories.map((c) => {
                const done = countSkills(c.skills, progress);
                return {
                  id: c.id,
                  label: c.name,
                  sub: `${done.complete} / ${done.total} skills`,
                  prereqs: c.requires,
                  state: categoryState(tree, c, trees, progress),
                };
              })}
            />
          )}
        </div>
        {students.length === 0 && (
          <p className="text-sm text-secondary-500">
            There are no student accounts yet, so there's no progress to show.
          </p>
        )}
      </Card>
      {category && (
        <CategoryDrawer
          tree={tree}
          category={category}
          student={student}
          compact={compact}
          skillId={Number(params.get("skill")) || null}
          onSelectSkill={selectSkill}
          onClose={closeCategory}
        />
      )}
    </Page>
  );
}

/** The trees to pick from: a row of buttons, or one menu on a phone. */
function TreeTabs({
  trees,
  current,
  student,
  compact,
  onPick,
}: {
  trees: Tree[];
  current: Tree;
  student: Student | null;
  compact: boolean;
  onPick: (id: number) => void;
}) {
  const isLocked = (tree: Tree) =>
    student !== null && lockedBehind(tree, trees, student.progress) !== null;
  if (compact) {
    return (
      <label className="flex items-center gap-2 text-sm font-medium text-secondary-700">
        Tree
        <select
          className={inputClass}
          value={current.id}
          onChange={(e) => onPick(Number(e.target.value))}
        >
          {trees.map((tree) => (
            <option key={tree.id} value={tree.id}>
              {tree.icon} {tree.name}
              {isLocked(tree) ? " (locked)" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Trees">
      {trees.map((tree) => {
        const selected = tree.id === current.id;
        const locked = isLocked(tree);
        return (
          <button
            key={tree.id}
            type="button"
            aria-current={selected ? "page" : undefined}
            onClick={() => onPick(tree.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
              selected
                ? "border-secondary-900 bg-secondary-900 text-white"
                : "border-secondary-200 bg-white text-secondary-700 hover:bg-secondary-50"
            }`}
          >
            <span aria-hidden="true">{tree.icon}</span>
            {tree.name}
            {locked && (
              <span className="text-xs" title="Locked" aria-label="Locked">
                🔒
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
