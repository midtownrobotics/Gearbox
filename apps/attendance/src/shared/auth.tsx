import { PageLoading } from "@g3/ui";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { API, type Me, redirectToLogin } from "./api";

const MeContext = createContext<Me | null>(null);

/** The signed-in user. Only valid inside ProtectedRoute. */
export function useAuthUser(): Me {
  const user = useContext(MeContext);
  if (!user) throw new Error("useAuthUser must be used inside ProtectedRoute");
  return user;
}

/** The app's pages need someone signed in; anyone else goes to G3ID's sign-in and comes back. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null | "loading">("loading");

  useEffect(() => {
    fetch(`${API}/me`, { credentials: "include" })
      .then(async (res) => setUser(res.ok ? ((await res.json()) as Me) : null))
      .catch(() => setUser(null));
  }, []);

  if (user === "loading") return <PageLoading />;
  if (!user) {
    redirectToLogin();
    return null;
  }
  return <MeContext.Provider value={user}>{children}</MeContext.Provider>;
}
