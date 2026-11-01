import { site } from "./site.ts";

/** A team's pages on FIRST's event site and FRC stats sites. */
export function teamLinksFor(teamNumber: number) {
  return {
    frcEvents: `https://frc-events.firstinspires.org/team/${teamNumber}`,
    blueAlliance: `https://www.thebluealliance.com/team/${teamNumber}`,
    statbotics: `https://www.statbotics.io/team/${teamNumber}`,
    match13: `https://www.match13.com/team/${teamNumber}`,
  };
}

/** The site team's pages on FIRST's event site and FRC stats sites. */
export const teamLinks = teamLinksFor(site.team.number);
