import { Button, Card, ConfirmButton, ErrorBanner, Field, TextField } from "@g3/ui";
import { type FormEvent, useState } from "react";
import type { GearboxStatus } from "../../src/status.ts";

/** A JSON change to the downloader's own API; its error message, or null when it worked. */
async function send(method: "POST" | "DELETE", path: string, body?: unknown) {
  try {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (res.ok) return null;
    const answer = (await res.json().catch(() => null)) as { error?: string } | null;
    return answer?.error ?? "Something went wrong.";
  } catch {
    return "Can't reach the downloader. Check that it's still running.";
  }
}

/**
 * Pairing, which the downloader needs before it does anything: the team number and a code from
 * the team's Pit. The whole page until it's paired.
 */
export function PairingCard({
  gearbox,
  onPaired,
}: { gearbox: GearboxStatus; onPaired: () => void }) {
  const [teamNumber, setTeamNumber] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(gearbox.defaultName);
  // Another Pit than the team's usual one (staging, a Pit of its own): typed here, or left empty.
  const [otherPit, setOtherPit] = useState(false);
  const [pitUrl, setPitUrl] = useState("");
  const usualPitUrl = gearbox.usualPitUrl.replace("<team>", teamNumber || "1648");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const problem = await send("POST", "/api/gearbox/pair", {
      teamNumber,
      code,
      name,
      pitUrl: otherPit ? pitUrl : "",
    });
    setBusy(false);
    if (problem) setError(problem);
    else onPaired();
  }

  return (
    <Card>
      <form onSubmit={submit} className="max-w-md space-y-4">
        {gearbox.connection === "removed" && (
          <ErrorBanner message="This computer was removed from Pit. Pair it again to keep copying logs." />
        )}
        <p className="text-sm text-secondary-600">
          On your team's Pit, a mentor or admin opens Logs and chooses Get a pairing code. Enter it
          here within 10 minutes.
        </p>
        {gearbox.pitUrl && !otherPit && (
          <p className="text-sm text-secondary-600">
            Pairs with the Pit at <span className="font-mono">{gearbox.pitUrl}</span>.
          </p>
        )}
        {error && <ErrorBanner message={error} />}
        <Field label="Team number">
          <TextField
            typeable
            value={teamNumber}
            onChange={(e) => setTeamNumber(e.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            placeholder="1648"
            required
            autoFocus
          />
        </Field>
        <Field label="Pairing code">
          <TextField
            typeable
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="font-mono tracking-widest"
            required
          />
        </Field>
        <Field label="This computer's name in Pit">
          <TextField
            kind="device"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </Field>
        {otherPit ? (
          <Field
            label="Pit address"
            hint="Only for a Pit that isn't at your team's usual address. Copy it from the browser."
          >
            <TextField
              kind="url"
              type="url"
              value={pitUrl}
              onChange={(e) => setPitUrl(e.target.value)}
              placeholder={usualPitUrl}
              required
            />
          </Field>
        ) : (
          <button
            type="button"
            className="block text-sm text-primary-600 underline"
            onClick={() => setOtherPit(true)}
          >
            Use another Pit address
          </button>
        )}
        <Button type="submit" disabled={busy || !teamNumber || code.length !== 6}>
          {busy ? "Pairing…" : "Pair"}
        </Button>
      </form>
    </Card>
  );
}

/** Once paired: which Pit, and Unpair, after which it does nothing until it's paired again. */
export function GearboxCard({
  gearbox,
  onChange,
}: { gearbox: GearboxStatus; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const paired = gearbox.paired;
  if (!paired) return null;

  return (
    <Card title="Gearbox">
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm">
          <p className="text-secondary-900">
            Paired with{" "}
            <a
              className="text-primary-600 underline"
              href={paired.pitUrl}
              target="_blank"
              rel="noreferrer"
            >
              team {paired.teamNumber}'s Pit
            </a>{" "}
            as <span className="font-semibold">{paired.name}</span>.
          </p>
          {!paired.usual && (
            <p className="mt-1 font-mono text-xs text-secondary-500">{paired.pitUrl}</p>
          )}
          {gearbox.connection === "unreachable" && (
            <p className="mt-1 text-amber-700">
              Can't reach Gearbox right now. It tries again every minute.
            </p>
          )}
        </div>
        <ConfirmButton
          label="Unpair"
          size="sm"
          question="Unpair this computer? It stops copying logs until it's paired again, which needs a new code from Pit."
          onConfirm={async () => {
            setError(await send("DELETE", "/api/gearbox"));
            onChange();
          }}
        />
      </div>
    </Card>
  );
}
