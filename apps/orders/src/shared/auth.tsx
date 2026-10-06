import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { api, redirectToLogin } from "./api";
import { PageLoading } from "./ui";

export type AuthUser = {
  userId: string;
  displayName: string;
  /** G3ID mentor flag: approves requests and manages budgets. */
  isMentor: boolean;
  /** Mentors and trusted students: add catalog categories and add, edit or delete parts. */
  canEditCatalog: boolean;
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
      .then(async (res) => setUser(res.ok ? await res.json() : null))
      .catch(() => setUser(null));
  }, []);

  if (user === "loading") return <PageLoading />;
  if (!user) {
    redirectToLogin();
    return null;
  }
  return <AuthUserContext.Provider value={user}>{children}</AuthUserContext.Provider>;
}
