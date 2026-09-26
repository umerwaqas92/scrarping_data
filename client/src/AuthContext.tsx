import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider, isEmailAllowed } from "./firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      // Enforce the allowlist even for a persisted session.
      if (u && !isEmailAllowed(u.email)) {
        setError(`${u.email} is not permitted to access this app.`);
        signOut(auth).catch(() => undefined);
        setUser(null);
      } else {
        setUser(u);
      }
      setLoading(false);
    });
  }, []);

  async function signInWithGoogle() {
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (!isEmailAllowed(result.user.email)) {
        await signOut(auth);
        setError(`${result.user.email} is not permitted to access this app.`);
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        return;
      }
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    }
  }

  async function signOutUser() {
    await signOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, signInWithGoogle, signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
