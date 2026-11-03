// SPDX-License-Identifier: AGPL-3.0-only
import { Card, ErrorBanner, inputClass } from "@g3/ui";
import { useEffect, useState } from "react";
import { g3id as api } from "../../lib/api";

// The member's own subteam, on their Account page; shown only when the team uses subteams.

type State = {
  enabled: boolean;
  subteams: { id: string; name: string }[];
  mine: string | null;
};

export function SubteamCard() {
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.subteams
      .$get()
      .then(async (res) => (res.ok ? setState((await res.json()) as State) : undefined))
      .catch(() => {});
  }, []);

  async function choose(subteamId: string | null) {
    if (!state) return;
    const before = state.mine;
    setState({ ...state, mine: subteamId });
    setSaving(true);
    setError(null);
    try {
      const res = await api.subteams.mine.$put({ json: { subteamId } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't change your subteam. Try again.");
      }
    } catch (err) {
      setState((s) => (s ? { ...s, mine: before } : s));
      setError(err instanceof Error ? err.message : "Couldn't change your subteam. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!state?.enabled || state.subteams.length === 0) return null;
  return (
    <Card title="Subteam">
      <select
        className={`${inputClass} max-w-full`}
        aria-label="Subteam"
        value={state.mine ?? ""}
        disabled={saving}
        onChange={(e) => void choose(e.target.value || null)}
      >
        <option value="">None</option>
        {state.subteams.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
    </Card>
  );
}
