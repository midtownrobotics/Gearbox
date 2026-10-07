import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { api, redirectToLogin } from "./api";
import { setTeamCurrency } from "./format";
import { PageLoading } from "./ui";

export type AuthUser = {
  userId: string;
  displayName: string;
  /** G3ID mentor flag: approves requests and manages budgets. */
  isMentor: boolean;
  /** Mentors and trusted students: add catalog categories and add, edit or delete parts. */
  canEditCatalog: boolean;
  /** The team's settings every page needs: its currency and fiscal calendar. */
  currency: string;
  /** 1–12: the month the team's fiscal year starts. */
  fiscalYearStart: number;
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
        if (me) setTeamCurrency(me.currency);
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
