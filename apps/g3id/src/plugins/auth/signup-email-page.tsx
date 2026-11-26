// SPDX-License-Identifier: AGPL-3.0-only
import { Button, ErrorBanner, Field, Loading, TextField, useTeamNames } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { CodeField, PasswordField, errorOf } from "./email-fields";
import { Turnstile } from "./turnstile";

// Signing up with an email and password, on a team that lets people sign up without chat and
// sign in with email: a code goes to the address, and once it's entered the account is made and
// they enter their name (workers/g3id/src/routes/auth/email.ts).

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

type Methods = { email?: boolean; openSignup?: boolean; turnstileSiteKey?: string };

const post = (path: string, body: object) =>
  fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function SignupEmailPage() {
  const names = useTeamNames();
  const navigate = useNavigate();
  const [methods, setMethods] = useState<Methods | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  /** Drawn again for each try: a token works once. */
  const [check, setCheck] = useState(0);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.team["sign-in"]
      .$get()
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setMethods(data as Methods))
      .catch(() => setMethods({}));
  }, []);

  async function sendCode(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!token) {
      setError("Wait for the check above to finish.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await post("/auth/signup/email", { email, password, turnstile: token });
      if (!res.ok) {
        setError(await errorOf(res));
        setToken(null);
        setCheck((n) => n + 1);
        return;
      }
      setPassword("");
      setSent(true);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post("/auth/signup/email/verify", { email, code });
      if (!res.ok) {
        setError(await errorOf(res));
        return;
      }
      const data = (await res.json()) as { token?: string | null };
      navigate(
        data.token ? `/signup/name?token=${data.token}&with=email` : "/signup/pending?with=email",
        { replace: true },
      );
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setSent(false);
    setCode("");
    setToken(null);
    setCheck((n) => n + 1);
    setError(null);
  }

  const allowed = !!methods?.email && !!methods.openSignup && !!methods.turnstileSiteKey;

  return (
    <main className="flex-1 flex items-center justify-center px-4 bg-secondary-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl text-secondary-900">Join {names.name}</h1>
          <p className="mt-2 text-secondary-700 text-sm">
            {sent
              ? "Check your email for a code."
              : "Sign up with your email. We'll send a code to check it."}
          </p>
        </div>

        {methods === null ? (
          <Loading />
        ) : !allowed ? (
          <ErrorBanner message="Your team doesn't let people sign up with email. Go back and sign up another way." />
        ) : !sent ? (
          <form onSubmit={sendCode} className="space-y-4">
            <Field label="Email">
              <TextField
                kind="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                required
              />
            </Field>
            <PasswordField isNew value={password} onChange={setPassword} disabled={busy} />
            <Turnstile
              key={check}
              siteKey={methods.turnstileSiteKey as string}
              onToken={setToken}
              onError={() => setError("The check didn't load. Reload the page to try again.")}
            />
            {error && <ErrorBanner message={error} />}
            <Button type="submit" className="w-full" disabled={busy} blocked={!token}>
              {busy ? "Sending…" : "Send a code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <CodeField email={email} value={code} onChange={setCode} disabled={busy} />
            {error && <ErrorBanner message={error} />}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Checking…" : "Continue"}
            </Button>
            <Button variant="secondary" className="w-full" onClick={startOver} disabled={busy}>
              Start over
            </Button>
          </form>
        )}

        <p className="text-center text-sm">
          <Link to="/signup" className="text-primary-500 hover:text-primary-600 transition-colors">
            Back to sign-up
          </Link>
        </p>
      </div>
    </main>
  );
}
