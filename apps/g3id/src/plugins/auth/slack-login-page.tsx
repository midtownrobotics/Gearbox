import { site } from "@g3/site-config";
import { useTeamNames } from "@g3/ui";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

type PollStatus =
  | { status: "pending" }
  | { status: "success"; action?: string }
  | { status: "failed"; message: string }
  | { status: "expired" }
  | { status: "signup_pending" };

type BotInfo = {
  appId: string;
  /** The team's Slack workspace; null if the team hasn't connected one. */
  teamId: string | null;
};

export function SlackLoginPage() {
  const names = useTeamNames();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const code = searchParams.get("code") ?? "";
  const redirect = searchParams.get("redirect");
  const [pollStatus, setPollStatus] = useState<PollStatus>({ status: "pending" });
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formattedCode = code;

  useEffect(() => {
    const fetchBotInfo = async () => {
      try {
        const res = await api.auth.slack.bot.$get();
        if (res.ok) {
          setBotInfo((await res.json()) as BotInfo);
        }
      } catch {
        // Failed to fetch bot info, continue anyway
      }
    };

    fetchBotInfo();
  }, []);

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }

    const poll = async () => {
      try {
        const res = await api.auth.slack.status.$get({ query: { token } });
        if (!res.ok) return;
        const data = (await res.json()) as PollStatus;
        if (data.status === "pending") return;

        if (intervalRef.current) clearInterval(intervalRef.current);

        if (data.status === "success") {
          if (redirect) {
            window.location.href = redirect;
          } else {
            navigate("/dashboard");
          }
          return;
        }
        if (data.status === "signup_pending") {
          navigate("/signup/pending");
          return;
        }
        setPollStatus(data);
      } catch {
        // network error — keep polling
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 2000);

    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, navigate, redirect]);

  async function handleCancel() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (token) {
      await api.auth.slack.cancel.$delete({ query: { token } });
    }
    navigate("/login");
  }

  function handleCopy() {
    const command = `/signin ${formattedCode}`;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(formattedCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  function handleOpenSlack() {
    navigator.clipboard.writeText(formattedCode);

    if (botInfo?.teamId) {
      const slackUrl = `slack://app?team=${botInfo.teamId}&id=${botInfo.appId}&tab=messages`;
      window.location.href = slackUrl;
    }
  }

  const isTerminal = pollStatus.status === "failed" || pollStatus.status === "expired";

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-5xl font-bold text-secondary-900">
            <span className="text-primary-500">{names.shortName}</span>ID
          </h1>
        </div>

        {!isTerminal && (
          <>
            <div className="space-y-4">
              {botInfo && (
                <div className="space-y-2">
                  <p className="text-sm text-secondary-700">
                    EASIEST: Click to copy the code and open the Slack DM:
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenSlack}
                    className="w-full rounded-lg bg-primary-500 hover:bg-primary-600 text-white font-semibold py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    <Send size={16} />
                    Open Slack
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm text-secondary-700">
                  Or DM this code to the {""}
                  <span className="text-primary-500 font-medium">"{site.slackBotName}"</span> user:
                </p>
                <div className="bg-white border border-secondary-200 rounded-xl px-6 py-4 flex items-center justify-center gap-3">
                  <p className="text-5xl font-mono font-bold text-secondary-900 tracking-widest">
                    {formattedCode}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="p-2 rounded-lg hover:bg-secondary-50 transition-colors text-secondary-500 hover:text-primary-600 shrink-0"
                    title={copiedCode ? "Copied!" : "Copy code"}
                  >
                    {copiedCode ? <Check size={24} /> : <Copy size={24} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-secondary-700">Or run this command in any channel:</p>
                <div className="bg-white border border-secondary-200 rounded-xl px-6 py-4 flex items-center justify-center gap-3">
                  <p className="font-mono text-3xl font-bold text-primary-500 tracking-wide">
                    /signin {formattedCode}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="p-2 rounded-lg hover:bg-secondary-50 transition-colors text-secondary-500 hover:text-primary-600 shrink-0"
                    title={copied ? "Copied!" : "Copy command"}
                  >
                    {copied ? <Check size={24} /> : <Copy size={24} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm text-secondary-500 mb-2">
              <Loader2 size={16} className="animate-spin" />
              Waiting for Slack confirmation…
            </div>
          </>
        )}

        {isTerminal && (
          <div className="space-y-4">
            <p className="text-sm text-primary-500">
              {pollStatus.status === "expired" ? "This code has expired." : pollStatus.message}
            </p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="w-full rounded-lg bg-primary-500 hover:bg-primary-600 text-white font-semibold py-2.5 text-sm transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {!isTerminal && (
          <button
            type="button"
            onClick={handleCancel}
            className="text-sm text-secondary-500 hover:text-primary-600 transition-colors"
          >
            ← Go back
          </button>
        )}
      </div>
    </main>
  );
}
