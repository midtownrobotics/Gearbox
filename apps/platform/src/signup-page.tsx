import { site, teamAppUrl } from "@g3/site-config";
import { useEffect, useMemo, useState } from "react";
import { FaCheck, FaSlack } from "react-icons/fa";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { Page } from "./layout";

// Signing a team up: its details, then its Slack, then a code the founder sends to the Slack bot.
// The sign-up's id is in the URL (?id=), so Slack's install can send the founder back here.

/** Countries with FRC teams, named in the browser's language. */
const COUNTRIES = [
  "US",
  "CA",
  "MX",
  "BR",
  "CO",
  "CL",
  "DO",
  "GB",
  "NL",
  "FR",
  "DE",
  "PL",
  "TR",
  "IL",
  "IN",
  "CN",
  "TW",
  "JP",
  "KR",
  "AU",
  "NZ",
  "ZA",
];

type Signup = {
  teamNumber: number;
  name: string;
  step: "slack" | "code" | "done";
  workspaceName: string | null;
};

const field =
  "w-full rounded-lg border border-secondary-300 bg-white px-3 py-2 text-secondary-900 focus:border-primary-500 focus:outline-none";

const STEPS = ["Your team", "Connect Slack", "Confirm it's you"];

export function SignupPage() {
  const [params] = useSearchParams();
  const signupId = params.get("id");
  const [error, setError] = useState<string | null>(params.get("error"));
  const [stepIndex, setStepIndex] = useState(0);

  return (
    <Page>
      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:py-16 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-500">
              Sign up your team
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-secondary-900">
              Your team's apps, in about two minutes.
            </h1>
            <p className="text-secondary-600">
              Gearbox is free. Your team signs in with its own Slack, so nobody needs another
              password.
            </p>
          </div>
          <ol className="space-y-3">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    i < stepIndex
                      ? "bg-primary-600 text-white"
                      : i === stepIndex
                        ? "border-2 border-primary-500 text-primary-500"
                        : "border border-line text-secondary-500"
                  }`}
                >
                  {i < stepIndex ? <FaCheck size={11} /> : i + 1}
                </span>
                <span
                  className={
                    i === stepIndex ? "font-semibold text-secondary-900" : "text-secondary-500"
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-secondary-500">
            You'll need permission to add apps to your team's Slack workspace. The person who signs
            up becomes the team's first admin.
          </p>
        </div>
        <div className="space-y-4">
          {error && (
            <p className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {error}
              {/already on Gearbox|being signed up/.test(error) && (
                <>
                  {" "}
                  Not you?{" "}
                  <Link
                    to={`/report?team=${error.match(/Team (\d+)/)?.[1] ?? ""}`}
                    className="font-semibold underline"
                  >
                    Report it
                  </Link>
                </>
              )}
            </p>
          )}
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
            {signupId ? (
              <SignupSteps signupId={signupId} onError={setError} onStep={setStepIndex} />
            ) : (
              <TeamForm onError={setError} />
            )}
          </div>
        </div>
      </section>
    </Page>
  );
}

function TeamForm({ onError }: { onError: (error: string | null) => void }) {
  const navigate = useNavigate();
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = useMemo(
    () =>
      (Intl as unknown as { supportedValuesOf(key: "timeZone"): string[] }).supportedValuesOf(
        "timeZone",
      ),
    [],
  );
  const countryName = useMemo(() => new Intl.DisplayNames(undefined, { type: "region" }), []);
  const [form, setForm] = useState({
    teamNumber: "",
    name: "",
    country: "US",
    timeZone: browserZone,
    acceptTerms: false,
  });
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<typeof form>) => setForm({ ...form, ...change });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const res = await api.signup.$post({
        json: { ...form, teamNumber: Number(form.teamNumber) },
      });
      const body = (await res.json().catch(() => ({}))) as { signupId?: string; error?: string };
      if (!res.ok || !body.signupId) {
        onError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      navigate(`/signup?id=${body.signupId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold text-secondary-900">Your team</h2>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary-700">FRC team number</span>
        <input
          required
          inputMode="numeric"
          pattern="[0-9]*"
          value={form.teamNumber}
          onChange={(e) => set({ teamNumber: e.target.value })}
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-secondary-700">Team name</span>
        <input
          required
          maxLength={80}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          className={field}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-secondary-700">Country</span>
          <select
            value={form.country}
            onChange={(e) => set({ country: e.target.value })}
            className={field}
          >
            {COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryName.of(code)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-secondary-700">Time zone</span>
          <select
            value={form.timeZone}
            onChange={(e) => set({ timeZone: e.target.value })}
            className={field}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="rounded-lg border border-line bg-inset px-3 py-2.5 text-xs text-secondary-600">
        <strong className="text-secondary-900">Only sign up a team you belong to.</strong> If a team
        number turns out to have been registered by someone who isn't that team, the team and
        everything in it may be permanently deleted when it's discovered.{" "}
        <Link to="/report" className="underline">
          Report a falsely registered number
        </Link>
        .
      </p>
      <label className="flex items-start gap-2 text-sm text-secondary-700">
        <input
          type="checkbox"
          checked={form.acceptTerms}
          onChange={(e) => set({ acceptTerms: e.target.checked })}
          className="mt-1"
        />
        <span>
          I agree to the{" "}
          <a href={site.legal.terms} target="_blank" rel="noreferrer" className="underline">
            terms of service
          </a>{" "}
          and{" "}
          <a href={site.legal.privacy} target="_blank" rel="noreferrer" className="underline">
            privacy policy
          </a>
          , and that this is my team's number.
        </span>
      </label>
      <button
        type="submit"
        disabled={busy || !form.acceptTerms}
        className="w-full rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 py-2.5 font-semibold text-white transition-colors"
      >
        Continue
      </button>
    </form>
  );
}

function SignupSteps({
  signupId,
  onError,
  onStep,
}: {
  signupId: string;
  onError: (error: string | null) => void;
  onStep: (index: number) => void;
}) {
  const [signup, setSignup] = useState<Signup | null>(null);

  useEffect(() => {
    if (signup) onStep({ slack: 1, code: 2, done: 3 }[signup.step]);
  }, [signup, onStep]);

  useEffect(() => {
    api.signup[":signupId"]
      .$get({ param: { signupId } })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Signup & { error?: string };
        if (res.ok) setSignup(body);
        else onError(body.error ?? "This sign-up has expired. Please start again.");
      })
      .catch(() => onError("Couldn't load your sign-up."));
  }, [signupId, onError]);

  if (!signup) return <p className="text-center text-sm text-secondary-500">Loading…</p>;

  return (
    <div className="space-y-5">
      <p className="text-sm text-secondary-600">
        Team <span className="font-semibold text-secondary-900">{signup.teamNumber}</span>,{" "}
        {signup.name}
      </p>
      {signup.step === "slack" && <ConnectSlack signupId={signupId} />}
      {signup.step === "code" && (
        <SendCode signupId={signupId} workspace={signup.workspaceName} onError={onError} />
      )}
      {signup.step === "done" && (
        <p className="text-sm text-secondary-700">
          This team is set up.{" "}
          <a
            href={teamAppUrl(`frc${signup.teamNumber}`, "portal")}
            className="text-primary-500 underline"
          >
            Go to its home
          </a>
        </p>
      )}
    </div>
  );
}

function ConnectSlack({ signupId }: { signupId: string }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-secondary-900">Connect your team's Slack</h2>
      <p className="text-sm text-secondary-600">
        Your team signs in with Slack: members send a code to the bot to sign in, and the apps
        message them there. Add the bot to your team's workspace to continue.
      </p>
      <a
        href={`/api/signup/${signupId}/slack`}
        className="flex items-center justify-center gap-2 rounded-lg bg-[#4a154b] hover:bg-[#611f69] py-2.5 font-semibold text-white transition-colors"
      >
        <FaSlack size={18} />
        Add to Slack
      </a>
    </div>
  );
}

function SendCode({
  signupId,
  workspace,
  onError,
}: {
  signupId: string;
  workspace: string | null;
  onError: (error: string | null) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A code from the bot, and then a check every two seconds for the founder having sent it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs it ("Get a new code")
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setCode(null);

    async function poll() {
      const res = await api.signup[":signupId"].status.$get({ param: { signupId } });
      const status = (await res.json().catch(() => ({}))) as {
        status: string;
        message?: string;
        signInUrl?: string;
      };
      if (stopped) return;
      if (status.status === "done" && status.signInUrl) {
        window.location.href = status.signInUrl;
      } else if (status.status === "pending") {
        timer = setTimeout(poll, 2000);
      } else {
        onError(status.message ?? "That code expired. Get a new one to try again.");
        setCode(null);
      }
    }

    api.signup[":signupId"].code
      .$post({ param: { signupId } })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        if (stopped) return;
        if (!body.code) {
          onError(body.error ?? "Couldn't get a code.");
          return;
        }
        onError(null);
        setCode(body.code);
        timer = setTimeout(poll, 2000);
      })
      .catch(() => onError("Couldn't get a code."));

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [signupId, attempt, onError]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-secondary-900">Confirm it's you</h2>
      <p className="text-sm text-secondary-600">
        Send this code to the bot in {workspace ? <strong>{workspace}</strong> : "your Slack"}: open
        a direct message with it and paste the code. You'll be your team's first admin.
      </p>
      {code ? (
        <p className="rounded-lg bg-inset py-4 text-center font-mono text-4xl tracking-[0.3em] text-secondary-900">
          {code}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setAttempt(attempt + 1)}
          className="w-full rounded-lg border border-secondary-300 py-2 text-sm text-secondary-700 hover:border-primary-500"
        >
          Get a new code
        </button>
      )}
      {code && <p className="text-center text-xs text-secondary-500">Waiting for your message…</p>}
    </div>
  );
}
