// SPDX-License-Identifier: AGPL-3.0-only
import { Field, TextField, inputClass } from "@g3/ui";

// The parts of email sign-in's forms (workers/g3id/src/routes/auth/email.ts): a password and the
// 6-digit code emailed to check an address.

/** The fewest characters a password can have (PASSWORD_MIN in the worker). */
export const PASSWORD_MIN = 8;

export function PasswordField({
  label = "Password",
  value,
  onChange,
  disabled,
  isNew = false,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** A password being chosen, not one being entered. */
  isNew?: boolean;
}) {
  return (
    <Field label={label} hint={isNew ? `At least ${PASSWORD_MIN} characters.` : undefined}>
      <input
        type="password"
        autoComplete={isNew ? "new-password" : "current-password"}
        className={inputClass}
        minLength={isNew ? PASSWORD_MIN : undefined}
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
      />
    </Field>
  );
}

export function CodeField({
  email,
  value,
  onChange,
  disabled,
}: {
  email: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label="Code" hint={`We emailed a 6-digit code to ${email}. It works for 15 minutes.`}>
      <TextField
        typeable
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        pattern="\d{6}"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        disabled={disabled}
        required
      />
    </Field>
  );
}

/** A request's error message, or a general one. */
export async function errorOf(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "Something went wrong. Try again.";
}
