import {
  Badge,
  Button,
  Card,
  Chip,
  Field,
  Page as SharedPage,
  TextField,
  chatName,
  inputClass,
  tones,
  useQuestions,
  useTeamChat,
} from "@g3/ui";
import {
  SERVICE_ISSUE_TYPES,
  type ServiceIssueType,
  describeServiceIssue,
} from "@g3/worker-scouting/service-issues";
import { CheckCircle, Hand, MessageSquarePlus, Plus, Trash2 } from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";
import {
  type IssueChoice,
  IssueTypePicker,
  emptyIssueChoice,
  issueTypesToSend,
} from "./IssueTypePicker";
import { TeamLookupInput } from "./TeamLookupInput";
import { api } from "./api";

const issueLabel = (type: ServiceIssueType) =>
  SERVICE_ISSUE_TYPES.find((item) => item.value === type)?.label ?? type;

type Ticket = {
  id: string;
  team_name: string;
  issueTypes: ServiceIssueType[];
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
  const chat = chatName(useTeamChat());
  const [data, setData] = useState<Data>({
    tickets: [],
    helpers: [],
    users: [],
    isAdmin: false,
  });
  const [ticketView, setTicketView] = useState<"active" | "closed">("active");
  const [ticket, setTicket] = useState({ teamName: "", description: "" });
  const [issue, setIssue] = useState<IssueChoice>(emptyIssueChoice);
  const [issueMissing, setIssueMissing] = useState(false);
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
    const issueTypes = issueTypesToSend(issue);
    if (!issueTypes) {
      setIssueMissing(true);
      return;
    }
    if (
      !(await questions.confirm(
        `Open a service ticket for ${describeServiceIssue(issueTypes)} on team ${ticket.teamName}? Helpers will be notified in ${chat}.`,
      ))
    )
      return;
    await api("/service-tickets", {
      method: "POST",
      body: JSON.stringify({ ...ticket, issueTypes }),
    });
    setTicket({ teamName: "", description: "" });
    setIssue(emptyIssueChoice);
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
            <IssueTypePicker
              choice={issue}
              missing={issueMissing}
              onChange={(update) => {
                setIssue(update);
                setIssueMissing(false);
              }}
            />
            <div className="sm:col-span-2">
              <Field label="Description">
                <TextField
                  multiline
                  kind="note"
                  aria-label="Description"
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
              <div className="flex flex-wrap gap-1.5">
                {item.issueTypes.length ? (
                  item.issueTypes.map((type) => <Badge key={type}>{issueLabel(type)}</Badge>)
                ) : (
                  <Badge>Type not sure</Badge>
                )}
              </div>
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
                  `Approve this member for the service crew? They will receive ticket alerts in ${chat}.`,
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
              <TextField
                kind="skills"
                aria-label="Skills"
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
