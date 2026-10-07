import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { api, redirectToLogin } from "./api";
import { setBoxTimeZone } from "./format";
import { PageLoading } from "./ui";

export type AuthUser = {
  userId: string;
  displayName: string;
  isAdmin: boolean;
  /** The team's box's time zone: the app shows its days and times. */
  timeZone: string;
};

const AuthUserContext = createContext<AuthUser | null>(null);

/** The logged-in user. Only valid inside ProtectedRoute. */
export function useAuthUser(): AuthUser {
  const user = useContext(AuthUserContext);
  if (!user) throw new Error("useAuthUser must be used inside ProtectedRoute");
  return user;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | "loading">("loading");

  useEffect(() => {
    api.me
      .$get()
      .then(async (res) => {
        const me: AuthUser | null = res.ok ? await res.json() : null;
        if (me) setBoxTimeZone(me.timeZone);
        setUser(me);
      })
      .catch(() => setUser(null));
  }, []);

  if (user === "loading") return <PageLoading />;
  if (!user) {
    redirectToLogin();
    return null;
  }
  return <AuthUserContext.Provider value={user}>{children}</AuthUserContext.Provider>;
}
