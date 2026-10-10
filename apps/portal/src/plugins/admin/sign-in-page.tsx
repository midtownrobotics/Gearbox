import { apiPath } from "@g3/site-config";
import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FaGithub, FaGoogle, FaSlack, FaSteam } from "react-icons/fa";
import { MdPin } from "react-icons/md";
import { g3id } from "../../lib/api";
import { Switch } from "./switch";

// The ways the team's members sign in (G3ID's /admin/team/sign-in, through /api/~id). Slack is
// always on: members join through it.

type Optional = "google" | "github" | "steam" | "pin";
type State = {
  methods: Record<Optional | "slack", boolean>;
  /** Active members who can sign in only with that method. */
  onlyWith: Record<Optional, number>;
};

const METHODS: { key: Optional; label: string; Icon: IconType; summary: string }[] = [
  { key: "google", label: "Google", Icon: FaGoogle, summary: "Sign in with a Google account." },
  { key: "github", label: "GitHub", Icon: FaGithub, summary: "Sign in with a GitHub account." },
  { key: "steam", label: "Steam", Icon: FaSteam, summary: "Sign in with a Steam account." },
  {
    key: "pin",
    label: "Kiosk PIN",
    Icon: MdPin,
    summary: "Sign in on the team's shop kiosks with a 3-digit PIN.",
  },
];

const people = (n: number) => (n === 1 ? "1 member" : `${n} members`);

export function SignInPage() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** A method being switched off that someone can only sign in with: asked about first. */
  const [asking, setAsking] = useState<Optional | null>(null);

  useEffect(() => {
    g3id.admin.team["sign-in"]
      .$get()
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setState((await res.json()) as State);
      })
      .catch(() => setError("Couldn't load your team's sign-in methods."));
  }, []);

  async function change(key: Optional, on: boolean) {
    if (!state) return;
    setAsking(null);
    setBusy(true);
    setError("");
    try {
      const { slack: _, ...current } = state.methods;
      const res = await fetch(`${apiPath("id")}/admin/team/sign-in`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, [key]: on }),
      });
      const data = (await res.json()) as State & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't change it.");
      setState(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't change it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold text-secondary-900">Sign-in</h1>
      <p className="mb-6 text-secondary-600">
        Choose how your team's members can sign in. Anyone already signed in stays signed in.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}
      {!state && !error && <p className="text-secondary-600">Loading…</p>}
      {state && (
        <ul className="space-y-3">
          <li className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface p-4">
            <div className="flex gap-3">
              <FaSlack size={20} className="mt-0.5 shrink-0 text-secondary-700" />
              <div>
                <h2 className="font-semibold text-secondary-900">Slack</h2>
                <p className="text-sm text-secondary-600">
                  Members join through Slack, so it's always on.
                </p>
              </div>
            </div>
            <Switch on label="Slack on" disabled onChange={() => {}} />
          </li>
          {METHODS.map(({ key, label, Icon, summary }) => {
            const on = state.methods[key];
            const only = state.onlyWith[key];
            return (
              <li key={key} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <Icon size={20} className="mt-0.5 shrink-0 text-secondary-700" />
                    <div>
                      <h2 className="font-semibold text-secondary-900">{label}</h2>
                      <p className="text-sm text-secondary-600">{summary}</p>
                      {on && only > 0 && key !== "pin" && (
                        <p className="mt-1 text-xs text-amber-700">
                          {people(only)} can only sign in with {label}.
                        </p>
                      )}
                    </div>
                  </div>
                  <Switch
                    on={on}
                    label={`${label} ${on ? "on" : "off"}`}
                    disabled={busy}
                    onChange={(next) =>
                      !next && only > 0 && key !== "pin" ? setAsking(key) : change(key, next)
                    }
                  />
                </div>
                {asking === key && (
                  <div className="mt-3 space-y-3 rounded-md border border-line bg-inset p-3 text-sm">
                    <p className="text-secondary-900">
                      Switch off {label}? {people(only)} won't be able to sign in until they link
                      Slack to their account.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => change(key, false)}
                        className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                      >
                        Switch off
                      </button>
                      <button
                        type="button"
                        onClick={() => setAsking(null)}
                        className="px-3 py-1.5 text-secondary-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
