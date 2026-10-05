import { site } from "./site.ts";

/** The team's pages on FIRST's event site and FRC stats sites. */
export const teamLinks = {
  frcEvents: `https://frc-events.firstinspires.org/team/${site.team.number}`,
  blueAlliance: `https://www.thebluealliance.com/team/${site.team.number}`,
  statbotics: `https://www.statbotics.io/team/${site.team.number}`,
  match13: `https://www.match13.com/team/${site.team.number}`,
};
