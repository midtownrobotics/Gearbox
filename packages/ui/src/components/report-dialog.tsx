import { apiPath } from "@g3/site-config";
import { type FormEvent, useEffect, useState } from "react";
import { chatName, useTeamChat } from "../session";
import { Button } from "./button";
import { Chip } from "./chip";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { ErrorBanner, SuccessBanner } from "./messages";
import { TextField } from "./text-field";

// "Report a problem", from every app's bar (AppNavBar): a problem or an idea, sent to the
// platform's /team/reports, which posts it as a public issue on Gearbox's GitHub. It shows the
// member their reporter ID, which stands for them on the issue, and that it can be blocked.

type Kind = "problem" | "idea";

type Reporter = { id: string; blocked: boolean; blockReason: string | null };

/** The signed-in member's reporter ID, or null until it's known (or if it can't be). */
function useReporter() {
  const [reporter, setReporter] = useState<Reporter | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${apiPath("platform")}/team/reports/reporter`, { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<Reporter>) : null))
      .then((r) => live && r && setReporter(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return reporter;
}

export function ReportDialog({ version, onClose }: { version?: string; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("problem");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ issueUrl: string | null } | null>(null);
  const chat = useTeamChat();
  const reporter = useReporter();

  async function send(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${apiPath("platform")}/team/reports`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title, message, page: window.location.href, version }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        issueUrl?: string | null;
      };
      if (!res.ok) throw new Error(body.error ?? "Couldn't send it. Try again.");
      setSent({ issueUrl: body.issueUrl ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Dialog title="Thanks for the report" onClose={onClose} centered>
        <SuccessBanner
          message={
            chat
              ? `Sent. You'll get a ${chatName(chat)} message when it's fixed or closed.`
              : "Sent."
          }
        />
        <div className="flex flex-wrap justify-end gap-2">
          {sent.issueUrl && (
            <a
              href={sent.issueUrl}
              target="_blank"
              rel="noreferrer"
              className="self-center text-sm font-medium text-primary-700 hover:underline"
            >
              See it on GitHub
            </a>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Report a problem" onClose={onClose}>
      <form onSubmit={send} className="space-y-4">
        <div className="flex gap-2">
          <Chip selected={kind === "problem"} onClick={() => setKind("problem")}>
            Something's wrong
          </Chip>
          <Chip selected={kind === "idea"} onClick={() => setKind("idea")}>
            An idea
          </Chip>
        </div>
        <Field label="Title (optional)">
          <TextField
            kind="issue"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              kind === "problem" ? "Approve button does nothing" : "Sort parts by vendor"
            }
          />
        </Field>
        <Field
          label={kind === "problem" ? "What happened?" : "What would help?"}
          hint="Reports are public on Gearbox's GitHub, with this page's address, your browser and your reporter ID, but not your name. Leave out names and anything private."
        >
          <TextField
            multiline
            kind="note"
            rows={5}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              kind === "problem"
                ? "What you did, what you expected, and what happened instead"
                : "What you'd like Gearbox to do"
            }
            required
          />
        </Field>
        {reporter && (
          <p className="text-sm text-secondary-600">
            Your reporter ID is <span className="font-mono text-secondary-900">{reporter.id}</span>.
            Gearbox can block it for spam or misuse, and if it does, your team's admins are told
            it's you and why.
          </p>
        )}
        {reporter?.blocked && (
          <ErrorBanner message="Your reporter ID is blocked, so you can't send reports. Ask your team's admins." />
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={sending || message.trim().length < 10 || reporter?.blocked}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
