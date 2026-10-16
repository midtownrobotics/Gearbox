import { demoTeamId, site, teamOfHost } from "@g3/site-config";
import { ErrorBanner } from "@g3/ui";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

// The public demo's sign-in: pick a role, no account. Everyone who picks a role shares its account.

const ROLES = [
  {
    role: "student",
    label: "Student",
    text: "Request parts, check off lists and track your skills.",
  },
  {
    role: "mentor",
    label: "Mentor",
    text: "Approve orders, sign off skills and plan the schedule.",
  },
  { role: "admin", label: "Admin", text: "Everything a mentor does, plus each app's settings." },
] as const;

/** Back to the page that sent the visitor here, if it's the demo's own; else its home. */
function afterPicking(redirect: string | null, home: string): string {
  if (!redirect) return home;
  try {
    return teamOfHost(new URL(redirect).hostname) === demoTeamId ? redirect : home;
  } catch {
    return home;
  }
}

export function DemoPage() {
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A link straight to a role (the platform's home page) picks it at once.
  const asked = ROLES.find((r) => r.role === searchParams.get("role"))?.role;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the page opens
  useEffect(() => {
    if (asked) void pick(asked);
  }, []);

  async function pick(role: (typeof ROLES)[number]["role"]) {
    setBusy(role);
    setError(null);
    try {
      const res = await api.auth.demo.$post({ json: { role } });
      const body = (await res.json()) as { home?: string; error?: string };
      if (!res.ok || !body.home) throw new Error(body.error ?? "Couldn't start the demo.");
      window.location.href = afterPicking(searchParams.get("redirect"), body.home);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the demo.");
      setBusy(null);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10 bg-page">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary-500">
            {site.demo.name}
          </p>
          <h1 className="mt-1 text-3xl text-secondary-900">Try it as…</h1>
          <p className="mt-2 text-sm text-secondary-600">
            No account needed. Everything resets at midnight Eastern, and anyone can see what you
            change.
          </p>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="space-y-3">
          {ROLES.map(({ role, label, text }) => (
            <button
              key={role}
              type="button"
              disabled={busy !== null}
              onClick={() => pick(role)}
              className="block w-full rounded-lg border border-line bg-surface px-4 py-3 text-left hover:border-primary-500 disabled:opacity-60"
            >
              <span className="block font-semibold text-secondary-900">
                {busy === role ? "Starting…" : label}
              </span>
              <span className="block text-sm text-secondary-600">{text}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
