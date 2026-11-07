// SPDX-License-Identifier: AGPL-3.0-only
import { ErrorBanner, Loading } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { Turnstile } from "./turnstile";

// Before someone signs up with Google or GitHub (`with`), on a team that allows it: Cloudflare
// Turnstile's check that they're a person. Once it passes, they go on to the provider with its
// token, which the worker checks (workers/g3id/src/lib/open-signup.ts).

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const LABELS: Record<string, string> = { google: "Google", github: "GitHub" };

type Methods = Partial<Record<"google" | "github" | "openSignup", boolean>> & {
  turnstileSiteKey?: string;
};

export function CheckPage() {
  const [searchParams] = useSearchParams();
  const provider = searchParams.get("with") ?? "";
  const label = LABELS[provider];
  const [methods, setMethods] = useState<Methods | null>(null);
  const [failed, setFailed] = useState(false);
  const [going, setGoing] = useState(false);

  useEffect(() => {
    api.team["sign-in"]
      .$get()
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setMethods(data as Methods))
      .catch(() => setMethods({}));
  }, []);

  const siteKey = methods?.turnstileSiteKey;
  const allowed =
    !!label && !!methods?.openSignup && methods[provider as "google" | "github"] === true;

  function go(token: string | null) {
    if (!token) return;
    setGoing(true);
    window.location.href = `${apiBase}/auth/${provider}?signup=1&turnstile=${encodeURIComponent(token)}`;
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 bg-secondary-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl text-secondary-900">One more step</h1>
          <p className="mt-2 text-secondary-700 text-sm">
            {label
              ? `Check that you're a person, then you'll sign up with ${label}.`
              : "Check that you're a person."}
          </p>
        </div>

        {methods === null ? (
          <Loading />
        ) : !allowed || !siteKey ? (
          <ErrorBanner message="Your team doesn't let people sign up this way. Go back and sign up another way." />
        ) : going ? (
          <Loading />
        ) : (
          <>
            <Turnstile siteKey={siteKey} onToken={go} onError={() => setFailed(true)} />
            {failed && (
              <ErrorBanner message="The check didn't load. Reload the page to try again." />
            )}
          </>
        )}

        <p className="text-center text-sm text-secondary-500">
          <Link to="/signup" className="text-primary-500 hover:text-primary-600 transition-colors">
            Back to sign-up
          </Link>
        </p>
      </div>
    </main>
  );
}
