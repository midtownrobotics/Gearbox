import type { OnshapePartLink } from "./types";

const linkClass = "text-primary-600 underline hover:text-primary-700 transition-colors";

/**
 * "Open in Onshape" and "Release" for a part, each in a new tab, as items of the row they sit in.
 * Nothing without a link (no Onshape, a part added by hand); only Release when the release left
 * no part element. `className` adds to the link look (a size, a weight).
 */
export function OnshapePartLinks({
  link,
  className = "",
}: { link: OnshapePartLink | null; className?: string }) {
  if (!link) return null;
  return (
    <>
      {link.part && (
        <a
          href={link.part}
          target="_blank"
          rel="noreferrer"
          title="Open this part in Onshape"
          className={`${linkClass} ${className}`}
        >
          Open in Onshape
        </a>
      )}
      <a
        href={link.release}
        target="_blank"
        rel="noreferrer"
        title="Open the release this part came from in Onshape"
        className={`${linkClass} ${className}`}
      >
        Release
      </a>
    </>
  );
}
