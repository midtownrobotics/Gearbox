// Consistent, searchable request names from a team template. No imports (shared with the app as
// "@g3/worker-orders/naming").

/** Tokens: {vendor}, {sku}, {title} (cleaned), {variant}. */
export const DEFAULT_TEMPLATE = "{vendor} {sku} – {title}";
const MAX_TITLE = 120;
const SEPARATORS = "[\\s|:–—\\-,;]";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A product title without store boilerplate: the vendor's name stuck on the front or end
 * ("Amazon.com: …", "… | McMaster-Carr"), the SKU (the template adds it once), extra spaces and
 * dangling punctuation. Long titles are cut at a word boundary.
 */
export function cleanTitle(title: string, vendor: string, sku: string | null): string {
  let t = title.replace(/\s+/g, " ").trim();
  const names = [vendor, vendor.replace(/\s+/g, ""), vendor.split(/\s+/)[0]]
    .filter((n) => n.length >= 3)
    .map((n) => `${escapeRegex(n)}(?:\\.com)?`);
  for (const name of names) {
    t = t
      .replace(new RegExp(`^${name}${SEPARATORS}*[:|–—-]${SEPARATORS}*`, "i"), "")
      .replace(new RegExp(`${SEPARATORS}*[|–—-]${SEPARATORS}*${name}\\s*$`, "i"), "");
  }
  if (sku && sku.length >= 3) {
    t = t
      .replace(new RegExp(`\\(\\s*${escapeRegex(sku)}\\s*\\)`, "gi"), "")
      .replace(new RegExp(`(^|${SEPARATORS})${escapeRegex(sku)}(?=${SEPARATORS}|$)`, "gi"), "$1");
  }
  t = t
    .replace(/\s+/g, " ")
    .replace(new RegExp(`^${SEPARATORS}+|${SEPARATORS}+$`, "g"), "")
    .trim();
  if (t.length > MAX_TITLE) {
    const cut = t.slice(0, MAX_TITLE);
    t = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), MAX_TITLE * 0.6)).replace(/[\s,;:|–—-]+$/, "")}…`;
  }
  return t || title.trim();
}

/**
 * Fills the template. Empty tokens disappear along with the separator next to them, so
 * "{vendor} {sku} – {title}" without a SKU reads "Amazon – Duct tape", not "Amazon  – Duct tape".
 */
export function applyTemplate(
  template: string,
  parts: { vendor: string; sku: string | null; title: string; variant: string | null },
): string {
  const values: Record<string, string> = {
    vendor: parts.vendor.trim(),
    sku: (parts.sku ?? "").trim(),
    title: cleanTitle(parts.title, parts.vendor, parts.sku),
    variant: (parts.variant ?? "").trim(),
  };
  const name = template
    .replace(/\{(vendor|sku|title|variant)\}/g, (_, k: string) => values[k])
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:])/g, "$1")
    .replace(/([–—|-])(\s*[–—|-])+/g, "$1")
    .replace(/^[\s|:–—\-,;]+|[\s|:–—\-,;]+$/g, "")
    .trim();
  return (name || values.title).slice(0, 300);
}
