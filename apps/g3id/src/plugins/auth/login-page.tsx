import { useEffect, useState } from "react";
import { FaGithub, FaGoogle, FaSlack, FaSteam } from "react-icons/fa";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

const PROVIDERS = [
  { method: "slack", label: "Slack", Icon: FaSlack },
  { method: "google", label: "Google", Icon: FaGoogle },
  { method: "github", label: "GitHub", Icon: FaGithub },
  { method: "steam", label: "Steam", Icon: FaSteam },
] as const;

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  const redirect = searchParams.get("redirect") ?? "";

  const rp = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";

  // Each team signs in on its own address; this is the team this one is for.
  const [team, setTeam] = useState<{ name: string; teamNumber: number } | null>(null);
  const [methods, setMethods] = useState<Partial<Record<string, boolean>>>({});
  useEffect(() => {
    api.teams.current
      .$get()
      .then((res) => (res.ok ? res.json() : null))
      .then(setTeam)
      .catch(() => {});
    // The ways this team signs in (its admins can switch some off); all of them until it says.
    api.team["sign-in"]
      .$get()
      .then((res) => (res.ok ? res.json() : {}))
      .then(setMethods)
      .catch(() => {});
  }, []);

  return (
    <main className="flex-1 flex items-center justify-center px-4 bg-secondary-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="h-5 text-sm font-semibold uppercase tracking-widest text-primary-500">
            {team && `Team ${team.teamNumber}`}
          </p>
          <h1 className="mt-1 min-h-12 text-4xl font-bold text-secondary-900">{team?.name}</h1>
          <p className="mt-2 text-secondary-600 text-sm">Sign in with your account</p>
        </div>
        {error && <p className="text-sm text-primary-500 text-center">{error}</p>}

        <div className="space-y-3">
          {PROVIDERS.filter((p) => methods[p.method] !== false).map(({ method, label, Icon }) => (
            <a
              key={method}
              href={`${apiBase}${method === "slack" ? "/auth/slack/initiate" : `/auth/${method}`}${rp}`}
              className="w-full flex items-center justify-center gap-3 rounded-lg bg-surface border border-secondary-300 hover:border-primary-500 hover:bg-secondary-50 px-4 py-2.5 text-sm text-secondary-900 transition-colors"
            >
              <Icon size={20} />
              Sign in with {label}
            </a>
          ))}
        </div>

        <p className="text-center text-sm text-secondary-500">
          Don't have an account?{" "}
          <Link to="/signup" className="text-primary-500 hover:text-primary-600 transition-colors">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
