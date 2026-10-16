import { Button, Card, ConfirmButton, Dialog, ErrorBanner, Field, TextField } from "@g3/ui";
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

function PairDialog({
  gearbox,
  onClose,
  onPaired,
}: { gearbox: GearboxStatus; onClose: () => void; onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(gearbox.defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const problem = await send("POST", "/api/gearbox/pair", { code, name });
    setBusy(false);
    if (problem) setError(problem);
    else onPaired();
  }

  return (
    <Dialog title="Pair with Gearbox" onClose={onClose} centered>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-secondary-600">
          On your team's Pit, open Logs and choose Get a pairing code. Enter the code here within 10
          minutes.
        </p>
        {error && <ErrorBanner message={error} />}
        <Field label="Pairing code">
          <TextField
            typeable
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="font-mono text-lg tracking-widest"
            required
            autoFocus
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Pairing…" : "Pair"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function GearboxCard({
  gearbox,
  teamNumber,
  onChange,
}: { gearbox: GearboxStatus; teamNumber: number; onChange: () => void }) {
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pitLink = (
    <a
      className="text-primary-600 underline"
      href={gearbox.pitUrl}
      target="_blank"
      rel="noreferrer"
    >
      team {teamNumber}'s Pit
    </a>
  );

  return (
    <Card title="Gearbox">
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}
      {gearbox.paired ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            <p className="text-secondary-900">
              Paired with {pitLink} as <span className="font-semibold">{gearbox.paired.name}</span>.
            </p>
            {gearbox.connection === "unreachable" && (
              <p className="mt-1 text-amber-700">
                Can't reach Gearbox right now. It tries again every minute.
              </p>
            )}
          </div>
          <ConfirmButton
            label="Unpair"
            size="sm"
            question="Unpair this computer? Pit stops listing it, and you'll need a new code to pair it again."
            onConfirm={async () => {
              setError(await send("DELETE", "/api/gearbox"));
              onChange();
            }}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-secondary-600">
            {gearbox.connection === "removed" ? (
              "This computer was removed from Pit. Pair it again to reconnect."
            ) : (
              <>Pair this computer with {pitLink} on Gearbox.</>
            )}
          </p>
          <Button onClick={() => setPairing(true)}>Pair with Gearbox</Button>
        </div>
      )}
      {pairing && (
        <PairDialog
          gearbox={gearbox}
          onClose={() => setPairing(false)}
          onPaired={() => {
            setPairing(false);
            setError(null);
            onChange();
          }}
        />
      )}
    </Card>
  );
}
