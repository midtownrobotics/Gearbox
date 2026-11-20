// SPDX-License-Identifier: AGPL-3.0-only
import { apiPath, appUrl } from "@g3/site-config";
import { Button, ErrorBanner, Field, TextField, buttonClass, inputClass } from "@g3/ui";
import { useState } from "react";
import { MdEmail } from "react-icons/md";

// Adding a password to the member's account, on a team that signs in with email: a code goes to
// the account's email, and the password works once it's entered (G3ID's POST /auth/password and
// /auth/password/verify, through /api/~id). Someone with one changes it from the sign-in page's
// forgotten-password form.

const PASSWORD_MIN = 8;

const post = (path: string, body: object) =>
  fetch(`${apiPath("id")}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function errorOf(res: Response) {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "That didn't work. Try again.";
}

export function PasswordSection({
  email,
  hasPassword,
  onAdded,
}: {
  email: string;
  hasPassword: boolean;
  onAdded: () => void;
}) {
  const [step, setStep] = useState<"idle" | "password" | "code">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hasPassword) {
    return (
      <a
        href={`${appUrl("id")}/login/forgot?email=${encodeURIComponent(email)}`}
        className={`${buttonClass("secondary")} mt-3 w-full`}
      >
        <MdEmail size={16} />
        Change your password
      </a>
    );
  }

  async function sendCode(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post("/auth/password", { password });
      if (!res.ok) return setError(await errorOf(res));
      setPassword("");
      setStep("code");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post("/auth/password/verify", { code });
      if (!res.ok) return setError(await errorOf(res));
      setStep("idle");
      setCode("");
      onAdded();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "idle") {
    return (
      <Button className="mt-3 w-full" onClick={() => setStep("password")}>
        <MdEmail size={16} />
        Add a password
      </Button>
    );
  }

  return (
    <form
      onSubmit={step === "password" ? sendCode : verify}
      className="mt-3 space-y-3 rounded-lg border border-line p-4"
    >
      {step === "password" ? (
        <Field
          label="New password"
          hint={`At least ${PASSWORD_MIN} characters. You'll sign in with ${email} and this password.`}
        >
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            minLength={PASSWORD_MIN}
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </Field>
      ) : (
        <Field
          label="Code"
          hint={`We emailed a 6-digit code to ${email}. It works for 15 minutes.`}
        >
          <TextField
            typeable
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            pattern="\d{6}"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
            required
          />
        </Field>
      )}
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {step === "password"
            ? busy
              ? "Sending…"
              : "Send a code"
            : busy
              ? "Checking…"
              : "Add password"}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setStep("idle");
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
