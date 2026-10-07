import { Link } from "react-router-dom";
import { useAuthUser } from "../../shared/auth";
import { countSkills, percent, treeSkills } from "../../shared/progress";
import { useSkillData } from "../../shared/skill-data";
import { Card, Page, ProgressBar } from "../../shared/ui";

/** The whole team at a glance: how far along each tree is, and each student's progress. */
export function OverviewPage() {
  const { trees, students } = useSkillData();
  const user = useAuthUser();

  const skillsByTree = trees.map((tree) => ({ tree, skills: treeSkills(tree) }));
  const totalSkills = skillsByTree.reduce((sum, t) => sum + t.skills.length, 0);
  const rows = students.map((student) => {
    const perTree = skillsByTree.map(({ skills }) => countSkills(skills, student.progress));
    return {
      student,
      perTree,
      complete: perTree.reduce((sum, c) => sum + c.complete, 0),
      inProgress: perTree.reduce((sum, c) => sum + c.inProgress, 0),
    };
  });

  return (
    <Page title="Overview" wide>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {skillsByTree.map(({ tree, skills }, i) => {
          const done = rows.reduce((sum, row) => sum + row.perTree[i].complete, 0);
          const average = percent(done, skills.length * rows.length);
          const finished = rows.filter(
            (row) => skills.length > 0 && row.perTree[i].complete === skills.length,
          ).length;
          return (
            <Link
              key={tree.id}
              to={`/trees/${tree.id}`}
              className="block rounded-xl border border-secondary-200 bg-surface p-5 hover:border-secondary-400"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden="true">
                  {tree.icon}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-2xl text-secondary-900">{tree.name}</h2>
                  <p className="text-xs text-secondary-500">
                    {skills.length} {skills.length === 1 ? "skill" : "skills"}
                  </p>
                </div>
              </div>
              <ProgressBar percent={average} className="mt-4" />
              <p className="mt-2 flex justify-between text-xs text-secondary-500">
                <span>Team average {average}%</span>
                <span>
                  {finished} of {rows.length} finished
                </span>
              </p>
            </Link>
          );
        })}
      </div>
      {trees.length === 0 && (
        <Card>
          <p className="text-secondary-500">There are no skill trees yet.</p>
        </Card>
      )}

      <Card title="Students">
        {rows.length === 0 ? (
          <p className="text-sm text-secondary-500">There are no student accounts yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 text-left text-xs uppercase tracking-wide text-secondary-400">
                  <th className="py-2 pr-4 font-bold">Student</th>
                  {trees.map((tree) => (
                    <th key={tree.id} className="px-2 py-2 text-center font-bold" title={tree.name}>
                      <span aria-hidden="true">{tree.icon}</span>
                      <span className="sr-only">{tree.name}</span>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-bold">Complete</th>
                  <th className="px-2 py-2 text-right font-bold">In progress</th>
                  <th className="py-2 pl-4 font-bold">Overall</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ student, perTree, complete, inProgress }) => {
                  const overall = percent(complete, totalSkills);
                  return (
                    <tr
                      key={student.userId}
                      className="border-b border-secondary-100 last:border-0"
                    >
                      <td className="whitespace-nowrap py-2 pr-4">
                        <Link
                          to={`/trees?student=${encodeURIComponent(student.userId)}`}
                          className="font-medium text-secondary-900 hover:text-primary-600 hover:underline"
                        >
                          {student.name}
                        </Link>
                        {student.userId === user.userId && (
                          <span className="ml-1.5 text-xs text-secondary-400">(you)</span>
                        )}
                      </td>
                      {perTree.map((count, i) => {
                        const share = percent(count.complete, count.total);
                        return (
                          <td
                            key={trees[i].id}
                            className={`px-2 py-2 text-center tabular-nums ${
                              share === 100
                                ? "font-semibold text-emerald-700"
                                : share === 0
                                  ? "text-secondary-300"
                                  : "text-secondary-700"
                            }`}
                          >
                            {share}%
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-emerald-700">
                        {complete}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-amber-700">
                        {inProgress}
                      </td>
                      <td className="py-2 pl-4">
                        <div className="flex min-w-32 items-center gap-2">
                          <ProgressBar percent={overall} className="flex-1" />
                          <span className="w-9 text-right text-xs tabular-nums text-secondary-500">
                            {overall}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
