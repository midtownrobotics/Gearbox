import { useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { formatCents, parseDollars } from "../../shared/format";
import type { OrderRequest } from "../../shared/types";
import { Button, ErrorBanner, inputClass } from "../../shared/ui";

type Action = "approve" | "deny" | "receive" | "cancel";

const LABELS: Record<Action, string> = {
  approve: "Approve",
  deny: "Deny",
  receive: "Mark received",
  cancel: "Cancel request",
};

/**
 * What this user may do to the request right now (mirrors the worker's rules). Ordering isn't
 * here: mentors place orders for whole vendors on the Ordering page.
 */
export function allowedActions(
  request: Pick<OrderRequest, "status" | "requesterId">,
  user: { userId: string; isMentor: boolean },
): Action[] {
  const mentor = user.isMentor;
  const owner = request.requesterId === user.userId;
  switch (request.status) {
    case "requested":
      return [
        ...(mentor ? (["approve", "deny"] as const) : []),
        ...(mentor || owner ? (["cancel"] as const) : []),
      ];
    case "approved":
      return mentor || owner ? ["cancel"] : [];
    case "ordered":
      return mentor || owner ? ["receive"] : [];
    default:
      return [];
  }
}

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

/**
 * Buttons for the allowed status changes. When approving, the quantity and price can be adjusted
 * first; `compact` (the Approvals queue) leaves out the note box and asks why when denying.
 */
export function RequestActions({
  request,
  onChanged,
  compact = false,
}: {
  request: OrderRequest;
  onChanged: () => void;
  compact?: boolean;
}) {
  const user = useAuthUser();
  const actions = allowedActions(request, user);
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(String(request.quantity));
  const [price, setPrice] = useState(dollars(request.unitPriceCents));
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (actions.length === 0) return null;
  const canApprove = actions.includes("approve");

  async function run(action: Action) {
    if (action === "cancel" && !window.confirm("Cancel this request?")) return;
    let reason = note;
    if (compact && action === "deny") {
      const answer = window.prompt("Why is it denied? (shown to the requester)");
      if (answer === null) return;
      reason = answer;
    }
    const edits: { quantity?: number; unitPriceCents?: number | null } = {};
    if (action === "approve") {
      const q = Number(quantity);
      if (!Number.isInteger(q) || q < 1) return setError("Quantity must be a whole number.");
      const p = parseDollars(price);
      if (Number.isNaN(p)) return setError("Price must be a dollar amount like 12.50.");
      if (q !== request.quantity) edits.quantity = q;
      if (p !== request.unitPriceCents) edits.unitPriceCents = p;
    }
    setBusy(action);
    setError(null);
    const res = await api.requests[":id"][":action"].$post({
      param: { id: String(request.id), action },
      json: { note: reason.trim() || null, ...edits },
    });
    setBusy(null);
    if (!res.ok) return setError(await getErrorMessage(res));
    setNote("");
    onChanged();
  }

  const q = Number(quantity);
  const p = parseDollars(price);
  const total = Number.isInteger(q) && q > 0 && p !== null && !Number.isNaN(p) ? q * p : null;

  return (
    <div className="space-y-2">
      {canApprove && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-secondary-600">
            Qty
            <input
              type="number"
              min={1}
              max={10000}
              className={`${inputClass} !w-20 !py-1.5`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 text-secondary-600">
            Each $
            <input
              className={`${inputClass} !w-24 !py-1.5`}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <span className="text-secondary-500 tabular-nums">
            = {formatCents(total, request.currency)}
          </span>
        </div>
      )}
      {!compact && (canApprove || actions.includes("cancel")) && (
        <textarea
          className={`${inputClass} min-h-16`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            canApprove ? "Note for the requester (say why if denying)" : "Note (optional)"
          }
          maxLength={1000}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a}
            variant={
              a === "approve" || a === "receive" ? "primary" : a === "deny" ? "danger" : "secondary"
            }
            disabled={busy !== null}
            onClick={() => run(a)}
          >
            {busy === a ? "…" : LABELS[a]}
          </Button>
        ))}
      </div>
      {error && <ErrorBanner message={error} />}
    </div>
  );
}
