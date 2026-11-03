// SPDX-License-Identifier: AGPL-3.0-only
import {
  Button,
  ErrorBanner,
  Field,
  Loading,
  TextField,
  chatName,
  inputClass,
  useTeamChat,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

// Someone new who signed up with Slack or Discord enters their full name here, starting from
// their chat name, and their subteam when the team uses them, before their team's admins are
// asked to approve them.

export function NamePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const chat = chatName(useTeamChat());
  const [name, setName] = useState<string | null>(null);
  /** The team's subteams to choose from; empty when it doesn't use them. */
  const [subteams, setSubteams] = useState<{ id: string; name: string }[]>([]);
  const [subteamId, setSubteamId] = useState("");
  const [expired, setExpired] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.auth.signup.name
      .$get({ query: { token } })
      .then(async (res) => {
        const data = (await res.json()) as {
          username?: string;
          subteams?: { id: string; name: string }[];
          error?: string;
        };
        if (!res.ok) return setExpired(data.error ?? "This link has expired.");
        setSubteams(data.subteams ?? []);
        setName(data.username ?? "");
      })
      .catch(() => setExpired("Could not reach the server. Reload the page to try again."));
  }, [token]);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api.auth.signup.name.$post({
        json: {
          token,
          name: name ?? "",
          subteamId: subteamId || null,
        },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That didn't work. Try again.");
        return;
      }
      navigate("/signup/pending", { replace: true });
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl text-secondary-900">What's your name?</h1>
          <p className="mt-4 text-secondary-600 text-sm leading-relaxed">
            Enter your full name, so your team's admins know who to approve. Your team sees it
            across Gearbox.
          </p>
        </div>

        {expired ? (
          <div className="space-y-4 text-center">
            <ErrorBanner message={expired} />
            <Link to="/login" className="text-sm text-secondary-600 hover:text-primary-600">
              Go to the sign-in page
            </Link>
          </div>
        ) : name === null ? (
          <Loading />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Full name" hint={`Filled in from your ${chat} name.`}>
              <TextField
                kind="person"
                autoComplete="name"
                autoFocus
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                required
              />
            </Field>
            {subteams.length > 0 && (
              <Field label="Subteam" hint="You can change it later on your Account page.">
                <select
                  className={inputClass}
                  value={subteamId}
                  onChange={(e) => setSubteamId(e.target.value)}
                  disabled={saving}
                >
                  <option value="">Not sure yet</option>
                  {subteams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {error && <ErrorBanner message={error} />}
            <Button type="submit" className="w-full" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Continue"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
