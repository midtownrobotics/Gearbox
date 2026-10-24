import { Button, ConfirmQuestion, ErrorBanner, TextField, inputClass } from "@g3/ui";
import { type ReactNode, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { AnswerDialog } from "../../shared/ask";
import { useAuthUser } from "../../shared/auth";
import { formatCents, parseDollars } from "../../shared/format";
import { QuantityInput, QuantityMessage, parseQuantity } from "../../shared/quantity";
import { ReceiveDialog, asksInventory, useIntake } from "../../shared/receive-dialog";
import type { OrderRequest } from "../../shared/types";

type Action = "approve" | "deny" | "receive" | "cancel";

const LABELS: Record<Action, string> = {
  approve: "Approve",
  deny: "Deny",
  receive: "Mark received",
  cancel: "Cancel request",
};

/**
 * What this user may do to the request right now (mirrors the worker's rules). Ordering isn't
 * here: mentors place orders for whole vendors on the Carts page.
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
      // Whoever opens the package marks it received.
      return ["receive"];
    default:
      return [];
  }
}

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

/**
 * Buttons for the allowed status changes. When approving, the quantity and price can be adjusted
 * first; `compact` (the Approvals queue) leaves out the note box and asks why when denying.
 * `extra` is the page's own buttons, on the same line after these.
 */
export function RequestActions({
  request,
  onChanged,
  compact = false,
  extra,
}: {
  request: OrderRequest;
  onChanged: () => void;
  compact?: boolean;
  extra?: ReactNode;
}) {
  const user = useAuthUser();
  const actions = allowedActions(request, user);
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(String(request.quantity));
  const [price, setPrice] = useState(dollars(request.unitPriceCents));
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  // Canceling asks first, and in the Approvals queue denying asks why: which one is asking.
  const [asking, setAsking] = useState<"cancel" | "deny" | null>(null);
  const intake = useIntake();

  if (actions.length === 0)
    return extra ? <div className="flex flex-wrap gap-2">{extra}</div> : null;
  const canApprove = actions.includes("approve");

  /** `answer`: the yes to canceling, or the reason typed for denying. */
  async function run(action: Action, answer?: { confirmed?: boolean; reason?: string }) {
    if (action === "cancel" && !answer?.confirmed) return setAsking("cancel");
    // With Inventory set up (or required), a pop-up asks where the parts go first.
    if (action === "receive" && asksInventory(intake)) return setReceiving(true);
    if (compact && action === "deny" && answer?.reason === undefined) return setAsking("deny");
    setAsking(null);
    const reason = answer?.reason ?? note;
    const edits: { quantity?: number; unitPriceCents?: number | null } = {};
    if (action === "approve") {
      const q = parseQuantity(quantity);
      if (q === null) return setError("Quantity must be a whole number from 1 to 10000.");
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

  const q = parseQuantity(quantity);
  const p = parseDollars(price);
  const total = q !== null && p !== null && !Number.isNaN(p) ? q * p : null;

  return (
    <div className="space-y-2">
      {canApprove && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-secondary-600">
            Qty
            <QuantityInput
              className={`${inputClass} !w-20 !py-1.5`}
              value={quantity}
              onChange={setQuantity}
            />
          </label>
          <label className="flex items-center gap-1.5 text-secondary-600">
            Each $
            <TextField
              typeable
              className="!w-24 !py-1.5"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <span className="text-secondary-500 tabular-nums">
            = {formatCents(total, request.currency)}
          </span>
          {q === null && (
            <span className="basis-full">
              <QuantityMessage value={quantity} />
            </span>
          )}
        </div>
      )}
      {!compact && (canApprove || actions.includes("cancel")) && (
        <TextField
          multiline
          kind="note"
          className="min-h-16"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            canApprove ? "Note for the requester (say why if denying)" : "Note (optional)"
          }
          maxLength={1000}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) =>
          a === "cancel" && asking === "cancel" ? (
            <ConfirmQuestion
              key={a}
              question="Cancel this request?"
              confirmLabel="Cancel request"
              keepLabel="Keep it"
              onConfirm={() => run("cancel", { confirmed: true })}
              onKeep={() => setAsking(null)}
            />
          ) : (
            <Button
              key={a}
              variant={
                a === "approve" || a === "receive"
                  ? "primary"
                  : a === "deny"
                    ? "danger"
                    : "secondary"
              }
              disabled={busy !== null || (a === "approve" && q === null)}
              onClick={() => run(a)}
            >
              {busy === a ? "…" : LABELS[a]}
            </Button>
          ),
        )}
        {extra}
      </div>
      {asking === "deny" && (
        <AnswerDialog
          title="Deny request"
          label="Why is it denied? (shown to the requester)"
          multiline
          confirmLabel="Deny"
          danger
          onSubmit={(reason) => {
            void run("deny", { reason });
            return undefined;
          }}
          onClose={() => setAsking(null)}
        />
      )}
      {error && <ErrorBanner message={error} />}
      {receiving && intake && (
        <ReceiveDialog
          lines={[request]}
          intake={intake}
          onClose={() => setReceiving(false)}
          onReceived={() => {
            setReceiving(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
