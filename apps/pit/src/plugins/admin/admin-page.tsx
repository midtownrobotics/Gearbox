import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Loading,
  Page,
  type SafeTextKind,
  SuccessBanner,
  TextField,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { useAuth } from "../../shared/use-auth";

export function AdminPage() {
  const { user, loading: authLoading } = useAuth();

  const [eventKey, setEventKey] = useState("");
  const [nexusEventKey, setNexusEventKey] = useState("");
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
      <Page title="Admin" width="narrow">
        <Loading />
      </Page>
    );
  }

  if (!isAdmin) {
    return (
      <Page title="Admin" width="narrow">
        <p className="text-sm text-secondary-500">Only admins can change Pit's settings.</p>
      </Page>
    );
  }

  /** A setting's text box: typing in one takes the "Saved" away. */
  const setting = (
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
    kind: SafeTextKind,
  ) => (
    <TextField
      kind={kind}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        setSaved(false);
      }}
      className="font-mono"
    />
  );

  return (
    <Page title="Admin" width="narrow">
      <Card title="Event" className="space-y-4">
        <p className="text-sm text-secondary-500">
          Team {teamNumber}. Nexus and TBA event keys can differ, especially in the offseason.
        </p>
        <Field label="TBA Event Key" hint="Year + event code. Used for rankings and matches.">
          {setting(eventKey, setEventKey, "e.g. 2026gacmp", "event")}
        </Field>
        <Field label="Nexus Event Key" hint="Leave blank to turn off Nexus data.">
          {setting(nexusEventKey, setNexusEventKey, "e.g. 2026gacmp", "event")}
        </Field>
      </Card>

      <Card title="Monitor" className="space-y-4">
        <p className="text-sm text-secondary-500">Embed a feed or dashboard on the monitor page.</p>
        <Field
          label="Custom Monitor Feed URL (Optional)"
          hint="A page that allows embedding. Leave blank for none."
        >
          {setting(iframeUrl, setIframeUrl, "e.g. https://example.com/monitor", "url")}
        </Field>
      </Card>

      {banner && <ErrorBanner message={banner} />}
      {saved && <SuccessBanner message="Saved." />}

      <div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Page>
  );
}
