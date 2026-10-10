import { type SignedInUser, useSignedInUser } from "@g3/ui";

// Who's signed in (G3ID's /auth/me), asked once per page load and shared by the top bar, the home
// and the admin pages.

export type Me = SignedInUser;

/** The signed-in user, null when signed out, undefined while it's being asked. */
export const useMe = (): Me | null | undefined => useSignedInUser();
