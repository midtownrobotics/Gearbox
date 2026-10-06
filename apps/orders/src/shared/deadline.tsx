import { formatDate, placeBy, startOfToday } from "./format";
import type { OrderRequest, Vendor } from "./types";

/**
 * "Need by Oct 12 · place by Oct 5" for an open request, warning once the place-by date has
 * passed (need-by minus the vendor's lead time and shipping days). Nothing without a need-by date.
 */
export function Deadline({
  request,
  vendor,
}: {
  request: Pick<OrderRequest, "needBy" | "status">;
  vendor: Vendor | undefined;
}) {
  if (request.needBy === null) return null;
  const open = request.status === "requested" || request.status === "approved";
  const by = placeBy(request.needBy, vendor);
  const late = open && by !== null && by < startOfToday();
  const knowsTimes = vendor?.leadTimeDays != null || vendor?.shippingDays != null;
  return (
    <span className={late ? "text-primary-700 font-semibold" : undefined}>
      {late && <span aria-hidden>⚠ </span>}
      Need by {formatDate(request.needBy)}
      {open && by !== null && knowsTimes && ` · place by ${formatDate(by)}`}
      {late && " (late)"}
    </span>
  );
}

/** Whether an open request is past its place-by date. */
export function isLate(
  request: Pick<OrderRequest, "needBy" | "status">,
  vendor: Vendor | undefined,
): boolean {
  if (request.status !== "requested" && request.status !== "approved") return false;
  const by = placeBy(request.needBy, vendor);
  return by !== null && by < startOfToday();
}
