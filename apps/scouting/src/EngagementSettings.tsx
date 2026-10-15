import { Button, Card, ErrorBanner, Field, SuccessBanner, TextField } from "@g3/ui";
import { useState } from "react";
import { api } from "./api";

export type EngagementSettings = {
  enabled: boolean;
  predictionsEnabled: boolean;
  combinationsEnabled: boolean;
  leaderboardEnabled: boolean;
  pointsLabel: string;
};

export function EngagementSettingsPanel({
  settings,
  onSaved,
}: {
  settings: EngagementSettings;
  onSaved: (settings: EngagementSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await api<EngagementSettings>("/engagement-settings", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setDraft(saved);
      onSaved(saved);
      setMessage("Engagement settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="scouting-shared-settings">
      <Card title="Optional engagement" className="space-y-4">
        <label>
          <input
            type="checkbox"
            disabled={saving}
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />{" "}
          Enable scouting points and activities
        </label>
        <p>Reports earn 10 points. Disabling activities pauses points and keeps existing picks.</p>
        <fieldset
          className="space-y-4 rounded-lg border border-line p-4"
          disabled={!draft.enabled || saving}
        >
          <legend>Activities and naming</legend>
          <Field label="Points name">
            <TextField
              kind="points"
              value={draft.pointsLabel}
              maxLength={40}
              required
              onChange={(e) => setDraft({ ...draft, pointsLabel: e.target.value })}
            />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={draft.predictionsEnabled}
              onChange={(e) => setDraft({ ...draft, predictionsEnabled: e.target.checked })}
            />{" "}
            Match predictions
          </label>
          <p>Points have no monetary value.</p>
          <label>
            <input
              type="checkbox"
              disabled={!draft.predictionsEnabled}
              checked={draft.combinationsEnabled}
              onChange={(e) => setDraft({ ...draft, combinationsEnabled: e.target.checked })}
            />{" "}
            Combined picks across multiple matches
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.leaderboardEnabled}
              onChange={(e) => setDraft({ ...draft, leaderboardEnabled: e.target.checked })}
            />{" "}
            Team points standings
          </label>
          <p>
            Standings share members’ names, point balances, points earned and points used with
            signed-in teammates.
          </p>
        </fieldset>
        {error && (
          <div role="alert">
            <ErrorBanner message={error} />
          </div>
        )}
        {message && <SuccessBanner message={message} />}
        <Button type="button" disabled={saving || !draft.pointsLabel.trim()} onClick={save}>
          {saving ? "Saving…" : "Save engagement settings"}
        </Button>
      </Card>
    </div>
  );
}
