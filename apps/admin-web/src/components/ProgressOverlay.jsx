import { useEffect, useMemo, useRef, useState } from "react";
import { formatNumber } from "../lib/format";
import { computeProgressPercent, formatElapsedMs } from "../lib/progress";

function toStatusLabel(status) {
  const normalized = String(status || "running").toLowerCase();
  if (normalized === "queued") {
    return "queued";
  }
  if (normalized === "running") {
    return "running";
  }
  if (normalized === "succeeded") {
    return "succeeded";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "canceled") {
    return "canceled";
  }
  return normalized || "running";
}

export function ProgressOverlay({
  open,
  title,
  status = "running",
  stepLabel = "กำลังเริ่มงาน...",
  processed = null,
  total = null,
  percent = null,
  meta = null,
  errorMessage = "",
  startedAt = null,
  finishedAt = null,
  networkMessage = "",
  onCancel,
  onClose,
  closeLabel = "ปิด",
}) {
  const [nowMs, setNowMs] = useState(Date.now());
  const lastPercentRef = useRef(0);

  useEffect(() => {
    if (!open) {
      lastPercentRef.current = 0;
      return undefined;
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  const computedPercent = useMemo(() => {
    const resolved = computeProgressPercent({
      percent,
      processed,
      total,
    });
    if (resolved == null) {
      if (String(status).toLowerCase() === "succeeded") {
        return 100;
      }
      return null;
    }
    const nonDecreasing = Math.max(lastPercentRef.current, resolved);
    lastPercentRef.current = nonDecreasing;
    return nonDecreasing;
  }, [percent, processed, status, total]);

  const determinate = computedPercent != null;
  const hasTotal = total != null && Number(total) > 0;
  const hasProcessed = processed != null;

  const elapsedMs = useMemo(() => {
    if (!startedAt) {
      return null;
    }
    const started = new Date(startedAt);
    if (Number.isNaN(started.getTime())) {
      return null;
    }
    if (finishedAt) {
      const finished = new Date(finishedAt);
      if (!Number.isNaN(finished.getTime())) {
        return Math.max(0, finished.getTime() - started.getTime());
      }
    }
    return Math.max(0, nowMs - started.getTime());
  }, [finishedAt, nowMs, startedAt]);

  if (!open) {
    return null;
  }

  return (
    <div className="loading-overlay progress-overlay-backdrop" role="status" aria-live="polite">
      <div className="progress-overlay-card">
        <div className="progress-overlay-header">
          <div className="loading-spinner" />
          <div>
            <div className="progress-overlay-title">{title || "กำลังทำงาน..."}</div>
            <div className="progress-overlay-status">
              สถานะงาน: <b>{toStatusLabel(status)}</b> | ใช้เวลา: <b>{formatElapsedMs(elapsedMs)}</b>
            </div>
          </div>
        </div>

        <div className="progress-overlay-step">
          ตอนนี้ทำขั้นตอน: <b>{stepLabel || "กำลังประมวลผล"}</b>
        </div>

        {hasProcessed && hasTotal && determinate && (
          <div className="progress-overlay-step">
            ...ไปแล้ว {formatNumber(processed)} แถว จาก {formatNumber(total)} แถว ({computedPercent}%)
          </div>
        )}
        {hasProcessed && !hasTotal && (
          <div className="progress-overlay-step">
            ...ไปแล้ว {formatNumber(processed)} แถว
          </div>
        )}
        {!hasTotal && <div className="progress-overlay-muted">กำลังคำนวณจำนวนทั้งหมด...</div>}

        <div className={`progress-bar-wrap${determinate ? "" : " indeterminate"}`}>
          {determinate ? (
            <div className="progress-bar-fill" style={{ width: `${computedPercent}%` }} />
          ) : (
            <div className="progress-bar-fill progress-bar-fill-indeterminate" />
          )}
        </div>

        {meta && (meta.inserted != null || meta.updated != null || meta.errors != null) && (
          <div className="progress-overlay-meta">
            {meta.inserted != null && <span>inserted: {formatNumber(meta.inserted)}</span>}
            {meta.updated != null && <span>updated: {formatNumber(meta.updated)}</span>}
            {meta.errors != null && <span>errors: {formatNumber(meta.errors)}</span>}
          </div>
        )}

        {networkMessage ? <div className="progress-overlay-muted">{networkMessage}</div> : null}
        {errorMessage ? <div className="progress-overlay-error">{errorMessage}</div> : null}

        <div className="progress-overlay-actions">
          {typeof onCancel === "function" && (
            <button type="button" className="btn btn-danger" onClick={onCancel}>
              ยกเลิกงาน
            </button>
          )}
          {typeof onClose === "function" && (
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {closeLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
