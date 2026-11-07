// SPDX-License-Identifier: AGPL-3.0-only
import {
  Button,
  ErrorBanner,
  NotYourTeam,
  buttonClass,
  chatName,
  useTeamChat,
  useTeamNames,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { FaDiscord, FaGithub, FaGoogle, FaSlack } from "react-icons/fa";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Turnstile } from "./turnstile";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

/** The sign-ups a team can allow besides its chat, after a Turnstile check. */
const OTHERS = [
  { method: "google", label: "Google", Icon: FaGoogle },
  { method: "github", label: "GitHub", Icon: FaGithub },
] as const;

type Methods = Partial<Record<"google" | "github" | "openSignup", boolean>> & {
  turnstileSiteKey?: string;
};

export function SignupPage() {
  const names = useTeamNames();
  // A team on Discord signs its members up with Discord; any other, with Slack.
  const chat = useTeamChat();
  const Icon = chat === "discord" ? FaDiscord : FaSlack;
  const start = chat === "discord" ? "/auth/discord" : "/auth/slack/initiate";

  // Whether the team also lets people sign up with Google or GitHub.
  const [methods, setMethods] = useState<Methods>({});
  const [token, setToken] = useState<string | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [needCheck, setNeedCheck] = useState(false);
  useEffect(() => {
    api.team["sign-in"]
      .$get()
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setMethods(data as Methods))
      .catch(() => {});
  }, []);
  const others = methods.openSignup ? OTHERS.filter(({ method }) => methods[method] === true) : [];
  const siteKey = methods.turnstileSiteKey;

  return (
    <main className="flex-1 flex items-center justify-center px-4 bg-secondary-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl text-secondary-900">Join {names.name}</h1>
          <p className="mt-2 text-secondary-700 text-sm">
            {others.length > 0
              ? "Sign up with one of these. You can add other sign-in methods afterward."
              : `Sign up with ${chatName(chat)}. You can add other sign-in methods afterward.`}
          </p>
        </div>

        <div className="space-y-3">
          <a href={`${apiBase}${start}`} className={`${buttonClass()} w-full`}>
            <Icon size={20} />
            Sign up with {chatName(chat)}
          </a>

          {others.length > 0 && siteKey && (
            <>
              <Turnstile
                siteKey={siteKey}
                onToken={(next) => {
                  setToken(next);
                  if (next) {
                    setNeedCheck(false);
                    setCheckFailed(false);
                  }
                }}
                onError={() => setCheckFailed(true)}
              />
              {checkFailed && (
                <ErrorBanner message="The check didn't load. Reload the page to try again." />
              )}
              {needCheck && !checkFailed && (
                <p className="text-center text-sm text-secondary-600">
                  Finish the check above first.
                </p>
              )}
              {others.map(({ method, label, Icon: OtherIcon }) =>
                token ? (
                  <a
                    key={method}
                    href={`${apiBase}/auth/${method}?signup=1&turnstile=${encodeURIComponent(token)}`}
                    className={`${buttonClass("secondary")} w-full`}
                  >
                    <OtherIcon size={20} />
                    Sign up with {label}
                  </a>
                ) : (
                  <Button
                    key={method}
                    variant="secondary"
                    className="w-full"
                    blocked
                    onClick={() => setNeedCheck(true)}
                  >
                    <OtherIcon size={20} />
                    Sign up with {label}
                  </Button>
                ),
              )}
            </>
          )}
        </div>

        <p className="text-center text-sm text-secondary-500">
          Already have an account?{" "}
          <Link to="/login" className="text-primary-500 hover:text-primary-600 transition-colors">
            Sign in
          </Link>
        </p>
        <NotYourTeam />
      </div>
    </main>
  );
}
