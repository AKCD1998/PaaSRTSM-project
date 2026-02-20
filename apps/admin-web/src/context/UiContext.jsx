import { createContext, useCallback, useContext, useMemo, useState } from "react";

const UiContext = createContext(null);

function nextId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function UiProvider({ children }) {
  const [loadingCount, setLoadingCount] = useState(0);
  const [toasts, setToasts] = useState([]);

  const beginLoading = useCallback(() => {
    setLoadingCount((prev) => prev + 1);
  }, []);

  const endLoading = useCallback(() => {
    setLoadingCount((prev) => (prev <= 0 ? 0 : prev - 1));
  }, []);

  const withLoading = useCallback(
    async (fn) => {
      beginLoading();
      try {
        return await fn();
      } finally {
        endLoading();
      }
    },
    [beginLoading, endLoading],
  );

  const showToast = useCallback((message, tone = "info", ttlMs = 3500) => {
    const id = nextId();
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, ttlMs);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      isLoading: loadingCount > 0,
      loadingCount,
      withLoading,
      showToast,
      toasts,
      dismissToast,
    }),
    [dismissToast, loadingCount, showToast, toasts, withLoading],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const context = useContext(UiContext);
  if (!context) {
    throw new Error("useUi must be used within UiProvider");
  }
  return context;
}
