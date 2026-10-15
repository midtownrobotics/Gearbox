import { Button, Card, ErrorBanner, Field, Loading, Page, TextField } from "@g3/ui";
import { useState } from "react";
import { type Friend, type Person, api, unwrap } from "../../shared/api";
import { compareNames } from "../../shared/names";
import { useLoad } from "../../shared/use-load";

// Each person's friends: who they want beside them on schedules. Only they ever see the list.

/** The most matches the search shows at once. */
const SHOWN = 8;

/** Whether a name matches what was typed: any word of it starting with each word typed. */
function matches(name: string, query: string) {
  const words = name.toLowerCase().split(/\s+/);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => words.some((word) => word.startsWith(part)));
}

export function FriendsPage() {
  const friends = useLoad(() => unwrap(api.friends.$get()), []);
  const people = useLoad(() => unwrap(api.friends.people.$get()), []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await work();
      friends.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }
  const add = (person: Person) =>
    run(() => unwrap(api.friends[":userId"].$put({ param: { userId: person.id } })));
  const remove = (friend: Friend) =>
    run(() => unwrap(api.friends[":userId"].$delete({ param: { userId: friend.userId } })));

  const mine = new Set(friends.data?.map((f) => f.userId));
  const found = query.trim()
    ? (people.data ?? [])
        .filter((p) => matches(p.displayName, query))
        .sort((a, b) => compareNames(a.displayName, b.displayName, "first"))
    : [];
  const loadError = error ?? friends.error ?? people.error;

  return (
    <Page
      title="Friends"
      description="Your friends are shown with you on schedules. Only you can see who they are."
      width="narrow"
    >
      {loadError && <ErrorBanner message={loadError} />}
      <Card title="Add a friend">
        <div className="space-y-3">
          <Field label="Search">
            <TextField
              type="search"
              value={query}
              placeholder="Name"
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          {!people.data && !people.error && <Loading />}
          {query.trim() && people.data && found.length === 0 && (
            <p className="text-sm text-secondary-500">No one on the team matches that.</p>
          )}
          {found.length > 0 && (
            <ul className="divide-y divide-secondary-100">
              {found.slice(0, SHOWN).map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm text-secondary-900">{person.displayName}</span>
                  {mine.has(person.id) ? (
                    <span className="text-sm text-secondary-500">Friend</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={saving}
                      onClick={() => void add(person)}
                    >
                      Add
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {found.length > SHOWN && (
            <p className="text-xs text-secondary-500">
              {found.length - SHOWN} more match. Type more of the name to narrow it down.
            </p>
          )}
        </div>
      </Card>

      <Card title={`Your friends${friends.data ? ` (${friends.data.length})` : ""}`}>
        {!friends.data && !friends.error && <Loading />}
        {friends.data?.length === 0 && (
          <p className="text-sm text-secondary-500">No friends yet. Search above to add one.</p>
        )}
        <ul className="divide-y divide-secondary-100">
          {[...(friends.data ?? [])]
            .sort((a, b) => compareNames(a.displayName, b.displayName, "first"))
            .map((friend) => (
              <li key={friend.userId} className="flex items-center justify-between gap-2 py-2">
                <span className="text-sm text-secondary-900">{friend.displayName}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void remove(friend)}
                >
                  Remove
                </Button>
              </li>
            ))}
        </ul>
      </Card>
    </Page>
  );
}
