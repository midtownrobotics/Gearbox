import { useEffect, useState } from "react";
import { g3id } from "../lib/api";

export type Me = { id: string; displayName: string; isAdmin: boolean };

// Who's signed in (G3ID's /auth/me), asked once per page load and shared by the top bar, the home
// and the admin pages.
let pending: Promise<Me | null> | null = null;

function loadMe(): Promise<Me | null> {
  pending ??= g3id.auth.me
    .$get()
    .then(async (res) => {
      if (!res.ok) return null;
      const me = (await res.json()) as { id: string; displayName: string; isAdmin?: boolean };
      return { id: me.id, displayName: me.displayName, isAdmin: me.isAdmin === true };
    })
    .catch(() => null);
  return pending;
}

/** The signed-in user, null when signed out, undefined while it's being asked. */
export function useMe(): Me | null | undefined {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadMe().then((value) => live && setMe(value));
    return () => {
      live = false;
    };
  }, []);
  return me;
}
