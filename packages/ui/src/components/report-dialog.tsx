import { apiPath } from "@g3/site-config";
import { type FormEvent, useState } from "react";
import { chatName, useTeamChat } from "../session";
import { Button } from "./button";
import { Chip } from "./chip";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { ErrorBanner, SuccessBanner } from "./messages";
import { TextField } from "./text-field";

// "Report a problem", from every app's bar (AppNavBar): a problem or an idea, sent to the
// platform's /team/reports, which posts it as a public issue on Gearbox's GitHub.

type Kind = "problem" | "idea";

export function ReportDialog({ version, onClose }: { version?: string; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("problem");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ issueUrl: string | null } | null>(null);
  const chat = useTeamChat();

  async function send(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${apiPath("platform")}/team/reports`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message, page: window.location.href, version }),
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
        <Field
          label={kind === "problem" ? "What happened?" : "What would help?"}
          hint="Reports are public on Gearbox's GitHub, with this page's address and your browser but not your name. Leave out names and anything private."
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
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={sending || message.trim().length < 10}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
