// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuthUser } from "./use-auth";

type Status = {
  hasApiKey: boolean;
  problem: { status: number; message: string | null; at: number; label: string } | null;
  /** Why Onshape's events are being dropped; only sent to admins. */
  webhookProblem?: { kind: "unsigned" | "no keys" | "wrong keys"; at: number } | null;
};

/** What a failed answer from Onshape means for the team, by its HTTP status (0: no answer). */
export function onshapeProblemText(status: number) {
  if (status === 429) return "Onshape's API limit has been reached.";
  if (status === 401) return "Onshape didn't accept the team's API keys.";
  if (status === 402 || status === 403) return "Onshape refused the team's API keys.";
  if (status === 0 || status >= 500) return "Onshape isn't answering.";
  return `Onshape answered with an error (${status}).`;
}

/** Why Shop can't accept the releases Onshape sends. */
export function webhookProblemText(kind: "unsigned" | "no keys" | "wrong keys") {
  if (kind === "unsigned") {
    return "Onshape is sending releases without a signature, so Shop can't accept them. Make webhook signing keys in Onshape's company settings, under Webhooks.";
  }
  if (kind === "no keys") {
    return "Onshape is sending signed releases, but Shop has no webhook signing keys to check them.";
  }
  return "Onshape is signing releases with keys that don't match the ones saved in Shop.";
}

const since = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Saving the keys or checking the connection on the Admin page asks the banner to look again.
const listeners = new Set<() => void>();
export function refreshOnshapeStatus() {
  for (const listener of listeners) listener();
}

/**
 * Under the bar on every page while Onshape can't be used: the team has no API key, or Onshape is
 * refusing its calls (keys refused, the API limit reached, Onshape down). New releases and
 * drawings stop coming in until it's fixed. Admins also see it while Onshape's events are dropped
 * because they aren't signed with the team's keys.
 */
export function OnshapeBanner() {
  const user = useAuthUser();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      try {
        const res = await api.onshape.status.$get();
        if (res.ok && !canceled) setStatus((await res.json()) as Status);
      } catch {
        // Says nothing when Shop's own API can't be reached; the page shows that.
      }
    };
    void load();
    listeners.add(load);
    const timer = setInterval(load, 5 * 60_000);
    window.addEventListener("focus", load);
    return () => {
      canceled = true;
      listeners.delete(load);
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  if (!status || (status.hasApiKey && !status.problem && !status.webhookProblem)) return null;
  const isAdmin = user?.isAdmin ?? false;
  const fix = isAdmin ? (
    <Link to="/admin#onshape" className="font-semibold underline">
      {status.problem || status.webhookProblem
        ? "See details on the Admin page"
        : "Add them on the Admin page"}
    </Link>
  ) : (
    "An admin can fix this on the Admin page."
  );

  return (
    <div role="alert" className="border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
      <p className="max-w-5xl mx-auto">
        {status.problem ? (
          <>
            {onshapeProblemText(status.problem.status)} New releases and drawings can't be loaded
            from Onshape until it works again
            <span className="text-red-700"> (since {since(status.problem.at)})</span>. {fix}
          </>
        ) : status.webhookProblem && status.hasApiKey ? (
          <>
            {webhookProblemText(status.webhookProblem.kind)}{" "}
            <span className="text-red-700">(Since {since(status.webhookProblem.at)}.)</span> {fix}
          </>
        ) : (
          <>
            Shop has no Onshape API keys, so new releases and drawings can't be loaded from Onshape.{" "}
            {fix}
          </>
        )}
      </p>
    </div>
  );
}
