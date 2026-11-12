// SPDX-License-Identifier: AGPL-3.0-only
import { site } from "@g3/site-config";
import { Button, Card, ErrorBanner } from "@g3/ui";
import { useEffect, useState } from "react";
import { platform } from "../../lib/platform";

// The team's owner accepts new terms of service here, on the home page (terms section 21), when
// they changed materially since the version the owner accepted (the platform's GET /team/terms).
// Nobody else sees it.

interface TermsState {
  version: string;
  mustAccept: boolean;
}

export function TermsNotice() {
  const [terms, setTerms] = useState<TermsState | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platform<TermsState>("/team/terms")
      .then(setTerms)
      // The home works the same without it; the owner is asked next time.
      .catch(() => setTerms(null));
  }, []);

  if (!terms?.mustAccept) return null;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await platform("/team/terms/accept", { method: "POST", body: { version: terms.version } });
      setTerms({ ...terms, mustAccept: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="New terms of service" className="mb-10">
      <p className="text-secondary-700">
        Gearbox's terms of service have changed. As your team's owner, please read them and accept
        them for your team.
      </p>
      <label className="mt-4 flex items-start gap-2 text-sm text-secondary-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          I accept the{" "}
          <a href={site.legal.terms} target="_blank" rel="noreferrer" className="underline">
            terms of service
          </a>{" "}
          for my team, and I've read the{" "}
          <a href={site.legal.privacy} target="_blank" rel="noreferrer" className="underline">
            privacy policy
          </a>
          .
        </span>
      </label>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <Button className="mt-4" onClick={accept} disabled={!agreed || busy}>
        Accept
      </Button>
    </Card>
  );
}
