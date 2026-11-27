// SPDX-License-Identifier: AGPL-3.0-only
import { appUrl } from "@g3/site-config";
import { Button, ErrorBanner, Field, Loading, SuccessBanner, TextField } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { CodeField, PasswordField, errorOf } from "./email-fields";
import { Turnstile } from "./turnstile";

// A forgotten password, on a team that signs in with email: a code goes to the address, and with
// it they choose a new password (workers/g3id/src/routes/auth/email.ts).

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

type Methods = { email?: boolean; turnstileSiteKey?: string };

const post = (path: string, body: object) =>
  fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function ForgotPage() {
  const [searchParams] = useSearchParams();
  const [methods, setMethods] = useState<Methods | null>(null);
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [token, setToken] = useState<string | null>(null);
  /** Drawn again for each try: a token works once. */
  const [check, setCheck] = useState(0);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
      const res = await post("/auth/password/forgot", { email, turnstile: token });
      if (!res.ok) {
        setError(await errorOf(res));
        setToken(null);
        setCheck((n) => n + 1);
        return;
      }
      setSent(true);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post("/auth/password/reset", { email, code, password });
      if (!res.ok) {
        setError(await errorOf(res));
        return;
      }
      const data = (await res.json()) as { signedIn?: boolean };
      if (data.signedIn) window.location.href = `${appUrl("portal")}/`;
      else setDone(true);
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

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl text-secondary-900">Reset your password</h1>
          <p className="mt-2 text-secondary-600 text-sm">
            {sent
              ? "If this email has a password on your team, we sent it a code."
              : "Enter your email, and we'll send you a code to choose a new password."}
          </p>
        </div>

        {methods === null ? (
          <Loading />
        ) : !methods.email || !methods.turnstileSiteKey ? (
          <ErrorBanner message="Your team doesn't use email and password to sign in." />
        ) : done ? (
          <SuccessBanner message="Your password is changed. You can sign in with it once an admin approves your account." />
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
            <Turnstile
              key={check}
              siteKey={methods.turnstileSiteKey}
              onToken={setToken}
              onError={() => setError("The check didn't load. Reload the page to try again.")}
            />
            {error && <ErrorBanner message={error} />}
            <Button type="submit" className="w-full" disabled={busy} blocked={!token}>
              {busy ? "Sending…" : "Send a code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={reset} className="space-y-4">
            <CodeField email={email} value={code} onChange={setCode} disabled={busy} />
            <PasswordField
              label="New password"
              isNew
              value={password}
              onChange={setPassword}
              disabled={busy}
            />
            {error && <ErrorBanner message={error} />}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Save and sign in"}
            </Button>
            <Button variant="secondary" className="w-full" onClick={startOver} disabled={busy}>
              Send a new code
            </Button>
          </form>
        )}

        <p className="text-center text-sm">
          <Link
            to="/login/email"
            className="text-secondary-600 hover:text-primary-600 transition-colors"
          >
            ← Back to sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}
