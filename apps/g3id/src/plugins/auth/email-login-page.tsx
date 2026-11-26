// SPDX-License-Identifier: AGPL-3.0-only
import { appUrl } from "@g3/site-config";
import { Button, ErrorBanner, Field, NotYourTeam, TextField, useTeamNames } from "@g3/ui";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PasswordField } from "./email-fields";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

export function EmailLoginPage() {
  const names = useTeamNames();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/auth/login/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, redirect }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        next?: string;
        to?: string | null;
      };
      // Someone who signed up and hasn't entered their name yet.
      if (data.next) {
        navigate(data.next);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      // Where they were going (checked by the worker), else the team's home.
      window.location.href = data.to ?? `${appUrl("portal")}/`;
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl text-secondary-900">{names.name}</h1>
          <p className="mt-2 text-secondary-600 text-sm">Sign in with email</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email">
            <TextField
              kind="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </Field>
          <PasswordField value={password} onChange={setPassword} disabled={loading} />

          {error && <ErrorBanner message={error} />}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="space-y-2 text-center text-sm">
          <p>
            <Link
              to={`/login/forgot${email ? `?email=${encodeURIComponent(email)}` : ""}`}
              className="text-primary-500 hover:text-primary-600 transition-colors"
            >
              Forgot your password?
            </Link>
          </p>
          <p>
            <Link
              to={`/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`}
              className="text-secondary-600 hover:text-primary-600 transition-colors"
            >
              ← Other sign-in options
            </Link>
          </p>
        </div>
        <NotYourTeam />
      </div>
    </main>
  );
}
