import { useUi } from "../context/UiContext";

export function LoadingOverlay() {
  const { isLoading } = useUi();
  if (!isLoading) {
    return null;
  }

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-box">
        <div className="loading-spinner" />
        <div>Working...</div>
      </div>
    </div>
  );
}
