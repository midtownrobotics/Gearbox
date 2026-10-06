import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { useAuth } from "../../shared/use-auth";

export function AdminPage() {
  const { user, loading: authLoading } = useAuth();

  const [eventKey, setEventKey] = useState("");
  const [nexusEventKey, setNexusEventKey] = useState("");
  const [tbaAuthKey, setTbaAuthKey] = useState("");
  const [nexusApiKey, setNexusApiKey] = useState("");
  const [iframeUrl, setIframeUrl] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isAdmin = user?.isAdmin === true;

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    api.admin.settings
      .$get()
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setEventKey(data.eventKey);
          setNexusEventKey(data.nexusEventKey);
          setTbaAuthKey(data.tbaAuthKey);
          setNexusApiKey(data.nexusApiKey);
          setIframeUrl(data.iframeUrl ?? "");
          setTeamNumber(data.teamNumber);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const res = await api.admin.settings.$patch({
      json: {
        eventKey: eventKey.trim(),
        nexusEventKey: nexusEventKey.trim(),
        tbaAuthKey: tbaAuthKey.trim(),
        nexusApiKey: nexusApiKey.trim(),
        iframeUrl: iframeUrl.trim(),
      },
    });
    setSaving(false);
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setBanner(null);
    setSaved(true);
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-page flex flex-col items-center justify-center gap-2">
        <p className="text-gray-700 text-lg font-semibold">Access denied</p>
        <p className="text-gray-600 text-sm">You must be an admin to view this page.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

        {banner && (
          <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-2">
            {banner}
          </p>
        )}

        <div className="bg-white rounded-xl border border-gray-300 p-5 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-200">Event & API Configuration</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Team {teamNumber}. Nexus and TBA event keys can be different (especially for
              offseason).
            </p>
          </div>

          <Field
            id="event-key"
            label="TBA Event Key"
            placeholder="e.g. 2026gacmp"
            value={eventKey}
            onChange={setEventKey}
            onSaved={() => setSaved(false)}
            hint="The Blue Alliance event key (year + event code). Used for rankings, matches, and status."
          />

          <Field
            id="nexus-event-key"
            label="Nexus Event Key"
            placeholder="e.g. 2026gacmp"
            value={nexusEventKey}
            onChange={setNexusEventKey}
            onSaved={() => setSaved(false)}
            hint="Nexus event key (can differ from TBA, especially for offseason). Leave blank to disable Nexus data."
          />

          <Field
            id="tba-key"
            label="TBA Auth Key"
            placeholder="The Blue Alliance read API key"
            value={tbaAuthKey}
            onChange={setTbaAuthKey}
            onSaved={() => setSaved(false)}
            secret
            hint="From thebluealliance.com/account. Powers rankings & match data."
          />

          <Field
            id="nexus-key"
            label="Nexus API Key"
            placeholder="FRC Nexus API key"
            value={nexusApiKey}
            onChange={setNexusApiKey}
            onSaved={() => setSaved(false)}
            secret
            hint="From frc.nexus. Powers live queuing/match status."
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-300 p-5 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-200">Pit Monitor Display</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Customize the monitor page display with an embedded feed or dashboard.
            </p>
          </div>

          <Field
            id="iframe-url"
            label="Custom Monitor Feed URL (Optional)"
            placeholder="e.g. https://example.com/monitor"
            value={iframeUrl}
            onChange={setIframeUrl}
            onSaved={() => setSaved(false)}
            hint="URL to display in an iframe on the pit monitor page. Leave blank to disable. Should support embedding (no X-Frame-Options restriction)."
          />

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-gray-900 text-sm font-semibold rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-green-400 text-sm">Saved ✓</span>}
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSaved,
  hint,
  secret,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSaved: () => void;
  hint: string;
  secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-gray-600">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={secret && !show ? "password" : "text"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onSaved();
          }}
          className="flex-1 bg-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-red-500 font-mono"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs rounded-lg shrink-0"
          >
            {show ? "Hide" : "Show"}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-600">{hint}</p>
    </div>
  );
}
