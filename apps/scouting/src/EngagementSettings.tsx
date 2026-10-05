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
    <section className="engagement-settings">
      <h2>Optional engagement</h2>
      <p>Choose which activities your team uses. This module is off by default.</p>
      <label>
        <input
          type="checkbox"
          disabled={saving}
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />{" "}
        Enable scouting points and activities
      </label>
      <p>
        Valid match scouting reports earn 10 points. Turning this off hides the module and pauses
        point awards and prediction results. Existing balances and picks are kept.
      </p>
      <fieldset disabled={!draft.enabled || saving}>
        <legend>Activities and naming</legend>
        <label>
          Points name
          <input
            type="text"
            value={draft.pointsLabel}
            maxLength={40}
            required
            onChange={(e) => setDraft({ ...draft, pointsLabel: e.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.predictionsEnabled}
            onChange={(e) => setDraft({ ...draft, predictionsEnabled: e.target.checked })}
          />{" "}
          Match predictions
        </label>
        <p>
          Members use earned points on match picks. Those points are spent when submitted; correct
          picks earn points back. Points have no monetary value.
        </p>
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
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      <button
        type="button"
        className="primary-button"
        disabled={saving || !draft.pointsLabel.trim()}
        onClick={save}
      >
        {saving ? "Saving…" : "Save engagement settings"}
      </button>
    </section>
  );
}
