import { Button, Card, ErrorBanner, Field, Loading, Page, inputClass } from "@g3/ui";
import { useState } from "react";
import { api, unwrap } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { useLoad } from "../../shared/use-load";

// Who edits schedules besides mentors and admins: the students mentors trust with it.

export function AdminPage() {
  const user = useAuthUser();
  const editors = useLoad(
    () => (user.isMentor ? unwrap(api.editors.$get()) : Promise.resolve(null)),
    [],
  );
  const members = useLoad(
    () => (user.isMentor ? unwrap(api.members.$get()) : Promise.resolve(null)),
    [],
  );
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user.isMentor) {
    return (
      <Page title="Admin">
        <p className="text-sm text-secondary-500">Only mentors and admins can use Admin.</p>
      </Page>
    );
  }

  async function run(work: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await work();
      editors.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const trusted = new Set(editors.data?.map((e) => e.userId));
  const candidates =
    members.data?.filter((m) => !m.isMentor && !m.isAdmin && !trusted.has(m.id)) ?? [];

  return (
    <Page title="Admin" width="narrow">
      <Card title="Trusted students">
        <div className="space-y-4">
          <p className="text-sm text-secondary-500">
            They can make, change and publish schedules and roles, like mentors.
          </p>
          {(error || editors.error || members.error) && (
            <ErrorBanner message={(error ?? editors.error ?? members.error) as string} />
          )}
          {!editors.data && !editors.error && <Loading />}
          {editors.data?.length === 0 && (
            <p className="text-sm text-secondary-500">No trusted students yet.</p>
          )}
          <ul className="divide-y divide-secondary-100">
            {editors.data?.map((editor) => (
              <li key={editor.userId} className="flex items-center justify-between gap-2 py-2">
                <span className="text-sm text-secondary-900">
                  {editor.displayName ?? "Former member"}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={() =>
                    void run(() =>
                      unwrap(api.editors[":userId"].$delete({ param: { userId: editor.userId } })),
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="flex flex-wrap items-end gap-2 border-t border-secondary-200 pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                unwrap(api.editors[":userId"].$put({ param: { userId: chosen } })),
              ).then(() => setChosen(""));
            }}
          >
            <div className="min-w-48 flex-1">
              <Field label="Add a student">
                <select
                  className={inputClass}
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {candidates.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Button type="submit" disabled={saving || !chosen}>
              Add
            </Button>
          </form>
        </div>
      </Card>
    </Page>
  );
}
