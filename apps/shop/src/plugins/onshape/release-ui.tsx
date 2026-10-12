// Pieces the Onshape list and a release's page share.

export const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;

export const linkCls =
  "text-sm font-medium text-crimson hover:text-crimson-dark underline-offset-2 hover:underline";
export const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-steel";
export const td = "px-3 py-2 align-top";

export function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={linkCls}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}
