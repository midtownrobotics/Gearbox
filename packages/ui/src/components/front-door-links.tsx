import { pageTeamNumber, platformUrl } from "@g3/site-config";
import { useTeamUiSettings } from "../team-ui";

// Lines under a team's front doors (Portal's signed-out home, ID's sign-in pages): for someone
// who isn't a member, or who's on another team's addresses.

/** Someone on another team's page (each team has its own addresses) finds theirs on the platform. */
export function NotYourTeam() {
  return (
    <p className="text-center text-sm text-secondary-500">
      Not team {pageTeamNumber}?{" "}
      <a
        href={`${platformUrl}/team`}
        className="font-medium text-primary-500 hover:text-primary-600 transition-colors"
      >
        Find your team
      </a>
    </p>
  );
}

/** The team's public site, for visitors who aren't members: hidden when the team has none. */
export function PublicSiteLink() {
  const teamUi = useTeamUiSettings();
  const url = teamUi.links.publicSite;
  if (!url || teamUi.hiddenLinks?.includes("publicSite")) return null;
  return (
    <p className="text-center text-sm text-secondary-500">
      Not a team member?{" "}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary-500 hover:text-primary-600 transition-colors"
      >
        Visit the team's public site
      </a>
    </p>
  );
}
