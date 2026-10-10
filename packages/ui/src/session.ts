import { apiPath } from "@g3/site-config";
import { useEffect, useState } from "react";

// Who's signed in and which apps their team has on, for the shared top bar (and Portal's home).
// Each is asked once per page load and shared by everything on the page.

export type SignedInUser = {
  id: string;
  displayName: string;
  isAdmin: boolean;
  /** A mentor (never on a kiosk session). */
  isMentor: boolean;
  /** A kiosk PIN session: a shared device, with no account page of its own to go to. */
  kiosk: boolean;
};

let user: Promise<SignedInUser | null> | null = null;
/** What the last answer was, once it's in: a "signed out" isn't trusted after someone signs in. */
let userWas: SignedInUser | null | undefined;

function loadUser(sure: boolean): Promise<SignedInUser | null> {
  if (!user || (sure && userWas === null)) {
    userWas = undefined;
    user = fetch(`${apiPath("id")}/auth/me?includeIdentities=false`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        const me = (await res.json()) as {
          id: string;
          displayName?: string;
          isAdmin?: boolean;
          isMentor?: boolean;
          sessionType?: string;
        };
        return {
          id: me.id,
          displayName: me.displayName ?? "",
          isAdmin: me.isAdmin === true,
          isMentor: me.isMentor === true,
          kiosk: me.sessionType === "pin",
        };
      })
      .catch(() => null)
      .then((value) => {
        userWas = value;
        return value;
      });
  }
  return user;
}

/**
 * The signed-in user, null when signed out, undefined while it's being asked.
 *
 * `signedIn`: for an app that signs people in and out without reloading (ID). It says what the
 * app already knows (null while it's finding out), so the answer follows it; other apps leave it
 * out.
 */
export function useSignedInUser(signedIn?: boolean | null): SignedInUser | null | undefined {
  const [value, setValue] = useState<SignedInUser | null | undefined>(undefined);
  useEffect(() => {
    if (signedIn === null) return setValue(undefined);
    if (signedIn === false) {
      // Whoever signs in next is asked about afresh.
      user = null;
      return setValue(null);
    }
    let live = true;
    loadUser(signedIn === true).then((loaded) => live && setValue(loaded));
    return () => {
      live = false;
    };
  }, [signedIn]);
  return value;
}

let teamApps: Promise<ReadonlySet<string> | "all"> | null = null;

function loadTeamApps(): Promise<ReadonlySet<string> | "all"> {
  teamApps ??= fetch(`${apiPath("platform")}/team/apps`, { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { apps: { slug: string }[] };
      return new Set(data.apps.map((app) => app.slug));
    })
    .catch(() => "all" as const);
  return teamApps;
}

/**
 * The apps the signed-in user's team has on (the platform's app library), by slug: null while
 * asked or when signed out, "all" if the platform didn't answer (the gateway still keeps the
 * others closed).
 */
export function useTeamApps(signedIn: boolean): ReadonlySet<string> | "all" | null {
  const [apps, setApps] = useState<ReadonlySet<string> | "all" | null>(null);
  useEffect(() => {
    if (!signedIn) return setApps(null);
    let live = true;
    loadTeamApps().then((loaded) => live && setApps(loaded));
    return () => {
      live = false;
    };
  }, [signedIn]);
  return apps;
}

// A feature that needs another app (Orders' part lookup needs Edge, Inventory's Request buttons
// need Orders) is left out of a page when the team has that app off. When it can't be told (the
// platform didn't answer), the app counts as on: the feature is offered and its own errors say
// what's wrong.

/** Whether the team has an app on, for code outside a component (a lookup before it runs). */
export async function appOn(app: string): Promise<boolean> {
  const apps = await loadTeamApps();
  return apps === "all" || apps.has(app);
}

/**
 * Whether the team has an app on: undefined until it's known (signed out: never known). Show a
 * feature that needs it while this isn't `false`, so a team that has it never sees it flicker.
 */
export function useAppOn(app: string): boolean | undefined {
  const user = useSignedInUser();
  const apps = useTeamApps(Boolean(user));
  if (apps === null) return undefined;
  return apps === "all" || apps.has(app);
}
