import type { ImgHTMLAttributes } from "react";
import { useTeamIcon } from "../team-ui";

/**
 * An app's icon, with its accent in the team's brand color (team-icon.ts). Takes what an
 * `<img>` takes; `src` is the icon's SVG.
 */
export function TeamIcon({
  src,
  alt = "",
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string }) {
  return <img {...rest} alt={alt} src={useTeamIcon(src)} />;
}
