import { TextField } from "@g3/ui";
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
      !window.confirm(
        `Open a ${ticket.issueType} service ticket for team ${ticket.teamName}? Helpers will be notified in Slack.`,
      )
    )
      return;
    await api("/service-tickets", { method: "POST", body: JSON.stringify(ticket) });
    setTicket({ teamName: "", issueType: "mechanical", description: "" });
    setTicketView("active");
    await load("active");
  }
  return (
    <section
      className={embedded ? "operations-page embedded-service-crew" : "page operations-page"}
    >
      <div className="page-heading">
        <div>
          <h1>Service Tickets</h1>
        </div>
      </div>
      <div className="analysis-tabs service-ticket-tabs">
        <button
          type="button"
          className={ticketView === "active" ? "active" : ""}
          onClick={() => setTicketView("active")}
        >
          Active tickets
        </button>
        <button
          type="button"
          className={ticketView === "closed" ? "active" : ""}
          onClick={() => setTicketView("closed")}
        >
          Closed tickets
        </button>
      </div>
      {ticketView === "active" && (
        <form className="operation-form" onSubmit={createTicket}>
          <TeamLookupInput
            value={ticket.teamName}
            onChange={(teamName) => setTicket({ ...ticket, teamName })}
          />
          <select
            value={ticket.issueType}
            onChange={(e) => setTicket({ ...ticket, issueType: e.target.value })}
          >
            <option value="mechanical">Mechanical</option>
            <option value="electrical">Electrical</option>
            <option value="programming">Programming</option>
            <option value="other">Other</option>
          </select>
          <TextField
            variant="plain"
            kind="note"
            placeholder="What appears to be broken?"
            value={ticket.description}
            onChange={(e) => setTicket({ ...ticket, description: e.target.value })}
          />
          <button className="primary-button" type="submit">
            <Plus size={16} /> Open ticket
          </button>
        </form>
      )}
      <div className="ticket-board">
        {data.tickets.map((item) => (
          <article key={item.id} className={`ticket ${item.status}`}>
            <header>
              <strong>Team {item.team_name}</strong>
              <span>{item.issue_type}</span>
            </header>
            <p>{item.description || "No description provided."}</p>
            <small>
              {item.status === "claimed" ? `Claimed by ${item.claimed_by_name}` : item.status}
            </small>
            {item.status === "open" && (
              <button
                type="button"
                className="primary-button"
                onClick={async () => {
                  if (!window.confirm(`Claim the service ticket for team ${item.team_name}?`))
                    return;
                  await api(`/service-tickets/${item.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ action: "claim" }),
                  });
                  await load();
                }}
              >
                <Hand size={15} /> Claim
              </button>
            )}
            {item.status !== "closed" && (
              <button
                type="button"
                className="secondary-button"
                onClick={async () => {
                  const resolution = window.prompt("Closure comment (required):");
                  if (
                    !resolution ||
                    !window.confirm(`Close the ticket for team ${item.team_name}?`)
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
              </button>
            )}
            {item.resolution && <div className="ticket-resolution">{item.resolution}</div>}
            {item.status === "closed" && (
              <button
                type="button"
                className="secondary-button"
                onClick={async () => {
                  const comment = window.prompt(
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
                  window.alert("Team comment saved.");
                }}
              >
                <MessageSquarePlus size={15} /> Add team comment
              </button>
            )}
          </article>
        ))}
        {!data.tickets.length && (
          <div className="forms-empty">
            {ticketView === "closed" ? "No closed tickets." : "No active tickets."}
          </div>
        )}
      </div>
      {data.isAdmin && (
        <div className="helper-admin">
          <h2>Approved service helpers</h2>
          <form
            className="operation-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                !window.confirm(
                  "Approve this member for the service crew? They will receive ticket alerts in Slack.",
                )
              )
                return;
              await api("/service-helpers", {
                method: "POST",
                body: JSON.stringify({ userId: helperId, skills: skills.split(",") }),
              });
              await load();
            }}
          >
            <select required value={helperId} onChange={(e) => setHelperId(e.target.value)}>
              <option value="">Member</option>
              {data.users
                .filter((u) => u.status === "active")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
            </select>
            <TextField
              variant="plain"
              kind="skill"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Skills: mechanical, electrical…"
            />
            <button className="primary-button" type="submit">
              Approve helper
            </button>
          </form>
          {data.helpers.map((helper) => (
            <span key={helper.user_id}>
              {helper.display_name}
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(`Remove ${helper.display_name} from the service crew?`))
                    return;
                  await api(`/service-helpers/${helper.user_id}`, { method: "DELETE" });
                  await load();
                }}
              >
                <Trash2 size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
