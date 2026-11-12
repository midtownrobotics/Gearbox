// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Program,
  apiPath,
  isDemoPage,
  pageTeamId,
  pageTeamNumber,
  platformHost,
  teamHostLabel,
  teamLabel,
} from "@g3/site-config";
import { useEffect, useState } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { ErrorBanner } from "./messages";
import { ProgramPicker } from "./program-picker";

// Every team from before FTC teams could sign up is FRC until one of its admins says otherwise
// (the platform's GET/PUT /team/program). The shared bar asks the first admin who opens any of
// its pages, and it can't be closed until it's answered. An FTC team then moves to its FTC addresses
// (ftc<number>-<app>.<platform>), and this page goes to the same page there.

type ProgramState = { teamId: string; program: Program; chosen: boolean; moving: boolean };

/** The same page at the team's new address, once it's moved to `teamId`. */
function samePageFor(teamId: string): string {
  const url = new URL(window.location.href);
  const [first, ...rest] = url.hostname.split(".");
  const from = teamHostLabel(pageTeamId);
  if (first === from || first.startsWith(`${from}-`)) {
    url.hostname = [`${teamHostLabel(teamId)}${first.slice(from.length)}`, ...rest].join(".");
  }
  return url.toString();
}

export function ProgramQuestion() {
  const [state, setState] = useState<ProgramState | null>(null);
  const [open, setOpen] = useState(true);
  const [program, setProgram] = useState<Program | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (isDemoPage) return;
    let canceled = false;
    fetch(`${apiPath("platform")}/team/program`, { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<ProgramState>) : null))
      .then((body) => {
        if (!canceled && body) setState(body);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, []);

  if (!state || state.chosen || !open) return null;

  const save = async () => {
    if (!program) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiPath("platform")}/team/program`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        teamId?: string;
        moving?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "That didn't work. Try again.");
        return;
      }
      if (body.moving) {
        setMoving(true);
        return;
      }
      if (body.teamId && body.teamId !== pageTeamId) {
        window.location.assign(samePageFor(body.teamId));
        return;
      }
      setOpen(false);
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const ftcId = `ftc${pageTeamNumber}`;
  return (
    <Dialog title="Is your team in FRC or FTC?" onClose={() => undefined} closable={false} centered>
      {moving ? (
        <>
          <p className="text-sm text-secondary-700">
            Your team is moving to its FTC addresses. This can take a few minutes. Reload the page
            in a little while.
          </p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-secondary-700">
            Gearbox now has FTC teams too. Tell us which program {teamLabel(pageTeamId)} is in. You
            only answer this once.
          </p>
          {error && <ErrorBanner message={error} />}
          <ProgramPicker label="Program" value={program} onChange={setProgram} disabled={busy} />
          {program === "ftc" && (
            <p className="rounded-lg border border-line bg-inset px-3 py-2.5 text-sm text-secondary-700">
              Your team's addresses change to{" "}
              <span className="font-mono text-secondary-900">
                {platformHost(teamHostLabel(ftcId))}
              </span>
              . Links to the old ones keep working until FRC team {pageTeamNumber} signs up. Kiosks
              have to be set up again. Moving can take a few minutes, and your team's apps are
              closed while it happens.
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={save} disabled={!program || busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
