import { useEffect, useState } from "react";
import { api } from "./api";

type AuthState = { id: string; displayName: string; isAdmin: boolean; email: string } | null;

/**
 * Who is signed in. `signedOut` is only true once the worker has said nobody is: with no
 * connection `user` is null too, and that isn't a reason to ask anyone to sign in.
 */
export function useAuth(): { user: AuthState; loading: boolean; signedOut: boolean } {
  const [user, setUser] = useState<AuthState>(undefined as unknown as AuthState);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    api.me
      .$get()
      .then((res) => {
        if ((res.status as number) === 401) setSignedOut(true);
        return res.ok ? res.json() : null;
      })
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return { user, loading, signedOut };
}
