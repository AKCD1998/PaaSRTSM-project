import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [initialized, setInitialized] = useState(false);
  const [user, setUser] = useState(null);
  const [csrfToken, setCsrfToken] = useState("");

  const refreshMe = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user || null);
      setCsrfToken(data.csrf_token || "");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setCsrfToken("");
      } else {
        throw error;
      }
    } finally {
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    refreshMe().catch(() => {
      setInitialized(true);
      setUser(null);
      setCsrfToken("");
    });
  }, [refreshMe]);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    setUser(data.user || null);
    setCsrfToken(data.csrf_token || "");
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      if (csrfToken) {
        await api.logout(csrfToken);
      }
    } catch (_error) {
      // Clear local auth regardless of remote logout outcome.
    }
    setUser(null);
    setCsrfToken("");
  }, [csrfToken]);

  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "staff";

  const value = useMemo(
    () => ({
      initialized,
      user,
      csrfToken,
      isAdmin,
      isStaff,
      refreshMe,
      login,
      logout,
      setLoggedOut() {
        setUser(null);
        setCsrfToken("");
      },
    }),
    [csrfToken, initialized, isAdmin, isStaff, login, logout, refreshMe, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
