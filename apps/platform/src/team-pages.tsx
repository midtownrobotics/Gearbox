import { teamAppUrl } from "@g3/site-config";
import { forgetTeam, rememberedTeam } from "@g3/ui/my-team";
import { useEffect, useState } from "react";
import { FaArrowRight, FaSearch } from "react-icons/fa";
import { Link, useSearchParams } from "react-router-dom";
import { Page } from "./layout";

// Finding a team's home from the platform's site: "My team" (the team this browser last signed in
// to, remembered by its home), a box for any team number, and the page the gateway sends an
// address for a team that isn't on Gearbox to.

/** A team's home (Portal): <number>.<platform>. */
export const teamHome = (teamNumber: number) => `${teamAppUrl(`frc${teamNumber}`, "portal")}/`;

const parseNumber = (value: string) => {
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 1 && n <= 99999 ? n : null;
};

/** A team number box and Next, which opens that team's home. */
export function TeamNumberForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const teamNumber = parseNumber(value);
        if (teamNumber === null) {
          setError("Enter an FRC team number.");
          return;
        }
        window.location.assign(teamHome(teamNumber));
      }}
    >
      <label htmlFor="team-number" className="block text-sm font-medium text-secondary-700">
        Team number
      </label>
      <div className="flex gap-2">
        <input
          id="team-number"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => {
            setValue(event.target.value.replace(/\D/g, ""));
            setError("");
          }}
          placeholder="e.g. 1648"
          className="w-full min-w-0 rounded-lg border border-secondary-300 bg-surface px-3 py-2 text-secondary-900 focus:border-primary-500 focus:outline-none"
        />
        <button
          type="submit"
          className="flex shrink-0 items-center gap-2 rounded-lg bg-primary-600 px-5 py-2 font-semibold text-white transition-colors hover:bg-primary-500"
        >
          Next <FaArrowRight size={12} />
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

/** The remembered team's number, read after the page loads. */
export function useRememberedTeam(): number | null {
  const [team, setTeam] = useState<number | null>(null);
  useEffect(() => setTeam(rememberedTeam()), []);
  return team;
}

/** The header's button: straight to the remembered team's home, or to the team number page. */
export function MyTeamButton({ large = false }: { large?: boolean }) {
  const team = useRememberedTeam();
  const className = `rounded-lg border border-line bg-surface font-semibold text-secondary-900 transition-colors hover:border-primary-500 ${
    large ? "px-6 py-3" : "px-4 py-2"
  }`;
  return team ? (
    <a href={teamHome(team)} className={className}>
      My team
    </a>
  ) : (
    <Link to="/team" className={className}>
      My team
    </Link>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-md px-5 py-16 sm:py-24">
      <div className="space-y-6 rounded-2xl border border-line bg-surface p-8 shadow-sm">
        {children}
      </div>
    </section>
  );
}

/** /team: the remembered team, if any, and a box for any number. */
export function MyTeamPage() {
  const team = useRememberedTeam();
  return (
    <Page>
      <Card>
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Go to your team</h1>
          <p className="mt-1 text-sm text-secondary-600">
            Enter your FRC team number to open your team's Gearbox.
          </p>
        </div>
        {team && (
          <a
            href={teamHome(team)}
            className="flex items-center justify-between rounded-lg bg-inset px-4 py-3 font-semibold text-secondary-900 hover:text-primary-600"
          >
            Team {team} <FaArrowRight size={12} />
          </a>
        )}
        <TeamNumberForm autoFocus={!team} />
        <p className="text-sm text-secondary-600">
          Not on Gearbox yet?{" "}
          <Link to="/signup" className="font-semibold text-primary-600 hover:underline">
            Sign up your team
          </Link>
        </p>
      </Card>
    </Page>
  );
}

/** /team-not-found?team=<number>: where the gateway sends an address for a team it doesn't have. */
export function TeamNotFoundPage() {
  const [params] = useSearchParams();
  const teamNumber = parseNumber(params.get("team") ?? "");

  // The remembered team is gone (deleted, or never finished signing up): stop offering it.
  useEffect(() => {
    if (teamNumber !== null && rememberedTeam() === teamNumber) forgetTeam();
  }, [teamNumber]);

  return (
    <Page>
      <Card>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-inset text-secondary-500">
          <FaSearch />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">
            {teamNumber ? `Team ${teamNumber} isn't on Gearbox` : "We couldn't find that team"}
          </h1>
          <p className="mt-2 text-sm text-secondary-600">
            Check the number, or if your team hasn't signed up yet, you can set it up in a couple of
            minutes.
          </p>
        </div>
        <TeamNumberForm autoFocus />
        <div className="border-t border-line pt-5">
          <Link
            to={teamNumber ? `/signup?team=${teamNumber}` : "/signup"}
            className="block w-full rounded-lg border border-line px-4 py-2.5 text-center font-semibold text-secondary-900 transition-colors hover:border-primary-500"
          >
            {teamNumber ? `Sign up team ${teamNumber}` : "Sign up your team"}
          </Link>
        </div>
      </Card>
    </Page>
  );
}

/**
 * /not-found?host=<name>: where the gateway sends an address on the platform's domain that isn't
 * anything (a mistyped app, a made-up name).
 */
export function NotFoundPage() {
  const [params] = useSearchParams();
  const host = (params.get("host") ?? "").slice(0, 253);
  // <number>-<something>: a team's address with an app that doesn't exist.
  const teamNumber = parseNumber(host.match(/^(\d{1,5})-/)?.[1] ?? "");

  return (
    <Page>
      <Card>
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-primary-500">404</p>
          <h1 className="mt-1 text-2xl font-bold text-secondary-900">Nothing is here</h1>
          <p className="mt-2 text-sm text-secondary-600">
            {host ? (
              <>
                <span className="font-mono text-secondary-900">{host}</span> isn't a Gearbox
                address.
              </>
            ) : (
              "That isn't a Gearbox address."
            )}{" "}
            Check it for typos, or find your team below.
          </p>
        </div>
        {teamNumber && (
          <a
            href={teamHome(teamNumber)}
            className="flex items-center justify-between rounded-lg bg-inset px-4 py-3 font-semibold text-secondary-900 hover:text-primary-600"
          >
            Team {teamNumber}'s home <FaArrowRight size={12} />
          </a>
        )}
        <TeamNumberForm />
        <div className="border-t border-line pt-5 text-sm">
          <Link to="/" className="font-semibold text-primary-600 hover:underline">
            Go to Gearbox's home page
          </Link>
        </div>
      </Card>
    </Page>
  );
}
