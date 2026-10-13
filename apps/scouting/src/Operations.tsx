import {
  Badge,
  Button,
  Card,
  Chip,
  Field,
  Page as SharedPage,
  inputClass,
  tones,
  useQuestions,
} from "@g3/ui";
import { CheckCircle, Hand, MessageSquarePlus, Plus, Trash2 } from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";
import { TeamLookupInput } from "./TeamLookupInput";
import { api } from "./api";

type Ticket = {
  id: string;
  team_name: string;
  issue_type: string;
  description: string;
  status: string;
  claimed_by_name?: string;
  resolution?: string;
  created_at: number;
};
type Helper = { user_id: string; display_name: string; skills_json: string };
type User = {
  id: string;
  displayName: string;
  email: string;
  status: string;
  slackUserId?: string;
};
type Data = {
  tickets: Ticket[];
  helpers: Helper[];
  users: User[];
  isAdmin: boolean;
};

export function Operations({ embedded = false }: { embedded?: boolean }) {
  const questions = useQuestions();
  const [data, setData] = useState<Data>({
    tickets: [],
    helpers: [],
    users: [],
    isAdmin: false,
  });
  const [ticketView, setTicketView] = useState<"active" | "closed">("active");
  const [ticket, setTicket] = useState({ teamName: "", issueType: "mechanical", description: "" });
  const [helperId, setHelperId] = useState("");
  const [skills, setSkills] = useState("");
  const load = useCallback(
    async (view: "active" | "closed" = ticketView) => {
      const result = await api<Partial<Data>>(`/operations?status=${view}`);
      setData((current) => ({ ...current, ...result }));
    },
    [ticketView],
  );
  useEffect(() => {
    load(ticketView).catch(() => undefined);
  }, [load, ticketView]);
  async function createTicket(event: SyntheticEvent) {
    event.preventDefault();
    if (
      !(await questions.confirm(
        `Open a ${ticket.issueType} service ticket for team ${ticket.teamName}? Helpers will be notified in Slack.`,
      ))
    )
      return;
    await api("/service-tickets", { method: "POST", body: JSON.stringify(ticket) });
    setTicket({ teamName: "", issueType: "mechanical", description: "" });
    setTicketView("active");
    await load("active");
  }
  return (
    <SharedPage
      as={embedded ? "section" : "main"}
      title="Service Tickets"
      width="wide"
      className="scouting-page-frame"
      contentClassName={embedded ? "operations-page embedded-service-crew" : "operations-page"}
    >
      <div className="flex flex-wrap gap-2" aria-label="Ticket status">
        <Chip selected={ticketView === "active"} onClick={() => setTicketView("active")}>
          Active tickets
        </Chip>
        <Chip selected={ticketView === "closed"} onClick={() => setTicketView("closed")}>
          Closed tickets
        </Chip>
      </div>
      {ticketView === "active" && (
        <Card title="New service ticket">
          <form className="grid min-w-0 gap-4 sm:grid-cols-2" onSubmit={createTicket}>
            <Field label="Team number">
              <TeamLookupInput
                value={ticket.teamName}
                onChange={(teamName) => setTicket({ ...ticket, teamName })}
              />
            </Field>
            <Field label="Issue type">
              <select
                aria-label="Issue type"
                className={inputClass}
                value={ticket.issueType}
                onChange={(e) => setTicket({ ...ticket, issueType: e.target.value })}
              >
                <option value="mechanical">Mechanical</option>
                <option value="electrical">Electrical</option>
                <option value="programming">Programming</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <textarea
                  aria-label="Description"
                  className={inputClass}
                  rows={3}
                  placeholder="What appears to be broken?"
                  value={ticket.description}
                  onChange={(e) => setTicket({ ...ticket, description: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button variant="primary" type="submit">
                <Plus size={16} /> Open ticket
              </Button>
            </div>
          </form>
        </Card>
      )}
      <div className="grid min-w-0 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.tickets.map((item) => (
          <Card key={item.id} className="service-ticket flex min-w-0 flex-col gap-3">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <strong className="text-base text-secondary-900">Team {item.team_name}</strong>
              <Badge>
                <span className="capitalize">{item.issue_type}</span>
              </Badge>
            </header>
            {item.description && (
              <p className="whitespace-pre-wrap text-sm text-secondary-700 [overflow-wrap:anywhere]">
                {item.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                colors={
                  item.status === "closed"
                    ? tones.success
                    : item.status === "claimed"
                      ? tones.info
                      : tones.warning
                }
              >
                {item.status === "closed"
                  ? "Closed"
                  : item.status === "claimed"
                    ? "Claimed"
                    : "Open"}
              </Badge>
              {item.status === "claimed" && (
                <span className="min-w-0 text-sm text-secondary-500 [overflow-wrap:anywhere]">
                  Claimed by {item.claimed_by_name}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {item.status === "open" && (
                <Button
                  variant="primary"
                  type="button"
                  onClick={async () => {
                    if (
                      !(await questions.confirm(
                        `Claim the service ticket for team ${item.team_name}?`,
                      ))
                    )
                      return;
                    await api(`/service-tickets/${item.id}`, {
                      method: "PUT",
                      body: JSON.stringify({ action: "claim" }),
                    });
                    await load();
                  }}
                >
                  <Hand size={15} /> Claim
                </Button>
              )}
              {item.status !== "closed" && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={async () => {
                    const resolution = await questions.prompt("Closure comment (required):");
                    if (
                      !resolution ||
                      !(await questions.confirm(`Close the ticket for team ${item.team_name}?`))
                    )
                      return;
                    await api(`/service-tickets/${item.id}`, {
                      method: "PUT",
                      body: JSON.stringify({ action: "close", resolution }),
                    });
                    await load();
                  }}
                >
                  <CheckCircle size={15} /> Close
                </Button>
              )}
            </div>
            {item.resolution && (
              <div className="rounded-lg bg-inset p-3 text-sm text-secondary-700 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {item.resolution}
              </div>
            )}
            {item.status === "closed" && (
              <Button
                variant="secondary"
                type="button"
                onClick={async () => {
                  const comment = await questions.prompt(
                    `Add a lasting comment about team ${item.team_name}:`,
                  );
                  if (!comment) return;
                  await api("/team-comments", {
                    method: "POST",
                    body: JSON.stringify({
                      teamName: item.team_name,
                      comment,
                      sourceTicketId: item.id,
                    }),
                  });
                  questions.notify("Team comment saved.");
                }}
              >
                <MessageSquarePlus size={15} /> Add team comment
              </Button>
            )}
          </Card>
        ))}
        {!data.tickets.length && (
          <Card className="col-span-full text-sm text-secondary-500">
            {ticketView === "closed" ? "No closed tickets." : "No active tickets."}
          </Card>
        )}
      </div>
      {data.isAdmin && (
        <Card title="Approved service helpers" className="space-y-4">
          <form
            className="grid min-w-0 items-end gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                !(await questions.confirm(
                  "Approve this member for the service crew? They will receive ticket alerts in Slack.",
                ))
              )
                return;
              await api("/service-helpers", {
                method: "POST",
                body: JSON.stringify({ userId: helperId, skills: skills.split(",") }),
              });
              await load();
            }}
          >
            <Field label="Member">
              <select
                aria-label="Member"
                className={inputClass}
                required
                value={helperId}
                onChange={(e) => setHelperId(e.target.value)}
              >
                <option value="">Member</option>
                {data.users
                  .filter((u) => u.status === "active")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Skills">
              <input
                aria-label="Skills"
                className={inputClass}
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="Mechanical, electrical, programming"
              />
            </Field>
            <div className="sm:col-span-2 lg:col-span-1">
              <Button variant="primary" type="submit">
                Approve helper
              </Button>
            </div>
          </form>
          <div className="space-y-2">
            {data.helpers.map((helper) => (
              <div
                key={helper.user_id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-line p-3"
              >
                <span className="min-w-0 text-sm text-secondary-900 [overflow-wrap:anywhere]">
                  {helper.display_name}
                </span>
                <Button
                  variant="danger"
                  type="button"
                  size="sm"
                  className="shrink-0"
                  aria-label={`Remove ${helper.display_name} from the service crew`}
                  onClick={async () => {
                    if (
                      !(await questions.confirm(
                        `Remove ${helper.display_name} from the service crew?`,
                      ))
                    )
                      return;
                    await api(`/service-helpers/${helper.user_id}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
          {!data.helpers.length && (
            <p className="text-sm text-secondary-500">No approved service helpers.</p>
          )}
        </Card>
      )}
    </SharedPage>
  );
}
