import { isDemoTeam } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { discordInstallations, teamSignInMethods } from "../db/schema";
import type { AppEnv } from "../types";

// The sign-in methods a team allows (team_sign_in_methods), chosen by its admins on the Sign-in
// page of the team's admin pages. A method that's off can't sign anyone in or be linked to an
// account; people already signed in stay signed in. The team's chat is always on: members join
// through it. That's Discord for a team that connected Discord, else Slack (a team has one).

export const SIGN_IN_METHODS = ["slack", "discord", "google", "github", "steam", "pin"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
export type SignInMethods = Record<SignInMethod, boolean>;

/** The ones a team can switch off. */
export const OPTIONAL_METHODS = ["google", "github", "steam", "pin"] as const;
export type OptionalMethod = (typeof OPTIONAL_METHODS)[number];

export const METHOD_LABELS: Record<SignInMethod, string> = {
  slack: "Slack",
  discord: "Discord",
  google: "Google",
  github: "GitHub",
  steam: "Steam",
  pin: "Kiosk PIN",
};

type Db = ReturnType<typeof createDb>;

export async function signInMethods(db: Db, teamId: string): Promise<SignInMethods> {
  const [row, discord] = await Promise.all([
    db.select().from(teamSignInMethods).where(eq(teamSignInMethods.teamId, teamId)).get(),
    db
      .select({ teamId: discordInstallations.teamId })
      .from(discordInstallations)
      .where(eq(discordInstallations.teamId, teamId))
      .get(),
  ]);
  // The public demo signs nobody in these ways: visitors pick a role (routes/demo.ts).
  if (isDemoTeam(teamId)) {
    return { slack: false, discord: false, google: false, github: false, steam: false, pin: false };
  }
  return {
    slack: !discord,
    discord: !!discord,
    google: row ? row.google === 1 : true,
    github: row ? row.github === 1 : true,
    steam: row ? row.steam === 1 : true,
    pin: row ? row.kioskPin === 1 : true,
  };
}

export async function saveSignInMethods(
  db: Db,
  teamId: string,
  methods: Record<OptionalMethod, boolean>,
  userId: string,
) {
  const values = {
    google: methods.google ? 1 : 0,
    github: methods.github ? 1 : 0,
    steam: methods.steam ? 1 : 0,
    kioskPin: methods.pin ? 1 : 0,
    updatedAt: Math.floor(Date.now() / 1000),
    updatedBy: userId,
  };
  await db
    .insert(teamSignInMethods)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: teamSignInMethods.teamId, set: values });
}

/** Why a method can't be used for this team now, or null when it can. */
export async function methodOff(
  env: AppEnv["Bindings"],
  teamId: string,
  method: SignInMethod,
): Promise<string | null> {
  const methods = await signInMethods(createDb(env.DB), teamId);
  if (methods[method]) return null;
  if (method === "pin") return "Kiosk sign-in is off for this team.";
  const chat = methods.discord ? "Discord" : methods.slack ? "Slack" : null;
  return `Your team doesn't use ${METHOD_LABELS[method]} to sign in.${chat ? ` Sign in with ${chat} instead.` : ""}`;
}
