import { Badge, tones } from "@g3/ui";

/** "In storage" or "In use", as a small label. */
export function StatusBadge({ status }: { status: "storage" | "in_use" }) {
  return status === "in_use" ? (
    <Badge colors={tones.warning}>In use</Badge>
  ) : (
    <Badge>In storage</Badge>
  );
}
