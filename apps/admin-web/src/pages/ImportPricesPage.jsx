import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { stableFormToken, titleize } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";
import { ConfirmModal } from "../components/ConfirmModal";
import { ProgressOverlay } from "../components/ProgressOverlay";

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function fileToken(file) {
  if (!file) {
    return "";
  }
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function isExcelFile(file) {
  if (!file?.name) {
    return false;
  }
  return /\.(xls|xlsx)$/i.test(file.name);
}

function buildFormData(file, form, commitValue) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("mode", "price-only");
  formData.set("source_format", "auto");
  formData.set("price_history", form.priceHistory);
  formData.set("commit", String(commitValue));
  if (form.limit) {
    formData.set("limit", form.limit);
  }
  if (form.batchSize) {
    formData.set("batch_size", form.batchSize);
  }
  return formData;
}

function SummaryBlock({ summary }) {
  if (!summary) {
    return <p className="muted">Run dry-run to see summary.</p>;
  }

  return (
    <div className="summary-card">
      <h3>Summary ({summary.mode})</h3>
      <p className="muted">
        Rows: {summary.rows_read} | Parsed: {summary.products_parsed} | Skipped: {summary.skipped_rows}
      </p>
      {summary.planned_actions && (
        <div>
          <h4>Planned Actions</h4>
          <ul>
            {Object.entries(summary.planned_actions).map(([key, value]) => (
              <li key={key}>
                {titleize(key)}: {value}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.tables && (
        <div>
          <h4>Table Changes</h4>
          <ul>
            {Object.entries(summary.tables).map(([table, metrics]) => (
              <li key={table}>
                {table}: {JSON.stringify(metrics)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ImportPricesPage() {
  const { isAdmin, csrfToken } = useAuth();
  const { showToast } = useUi();
  const mountedRef = useRef(true);
  const [file, setFile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState({
    priceHistory: "off",
    limit: "",
    batchSize: "500",
  });
  const [lastDryRunToken, setLastDryRunToken] = useState("");
  const [progressOverlay, setProgressOverlay] = useState({
    open: false,
    title: "",
    status: "running",
    stepLabel: "",
    processed: null,
    total: null,
    percent: null,
    meta: null,
    startedAt: null,
    finishedAt: null,
    errorMessage: "",
    networkMessage: "",
  });

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const currentToken = useMemo(
    () =>
      stableFormToken({
        ...form,
        mode: "price-only",
        file: fileToken(file),
      }),
    [file, form],
  );

  const canCommit = isAdmin && Boolean(summary) && summary.mode === "dry-run" && lastDryRunToken === currentToken;

  const setProgressSafe = useCallback((updater) => {
    if (!mountedRef.current) {
      return;
    }
    setProgressOverlay((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  function openProgress(title, stepLabel) {
    setProgressSafe({
      open: true,
      title,
      status: "running",
      stepLabel,
      processed: null,
      total: null,
      percent: null,
      meta: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errorMessage: "",
      networkMessage: "",
    });
  }

  function summaryErrorCount(rawSummary) {
    if (!rawSummary) {
      return null;
    }
    if (Array.isArray(rawSummary.parse_errors)) {
      return rawSummary.parse_errors.length;
    }
    const importStatsErrors = Number(rawSummary.import_stats?.errors);
    if (Number.isFinite(importStatsErrors)) {
      return importStatsErrors;
    }
    const n = Number(rawSummary.parse_errors);
    return Number.isFinite(n) ? n : null;
  }

  async function markProgressSucceeded(rawSummary, stepLabel) {
    const rowsRead = Number(rawSummary?.rows_read);
    const totalRows = Number.isFinite(rowsRead) ? rowsRead : null;
    const errors = summaryErrorCount(rawSummary);

    setProgressSafe((prev) => ({
      ...prev,
      status: "succeeded",
      stepLabel,
      processed: totalRows,
      total: totalRows,
      percent: 100,
      meta: {
        inserted: null,
        updated: null,
        errors,
      },
      finishedAt: new Date().toISOString(),
      errorMessage: "",
      networkMessage: "",
    }));
    await sleep(850);
    setProgressSafe((prev) => ({
      ...prev,
      open: false,
    }));
  }

  function markProgressFailed(stepLabel, message) {
    setProgressSafe((prev) => ({
      ...prev,
      status: "failed",
      stepLabel,
      finishedAt: new Date().toISOString(),
      errorMessage: message,
      networkMessage: "",
    }));
  }

  async function runDryRun() {
    if (!file) {
      showToast("Choose a CSV/XLS file first", "error");
      return;
    }
    openProgress("Monthly Price Update (Dry-run)", "อ่านไฟล์และตรวจรูปแบบ");
    try {
      const formData = buildFormData(file, form, false);
      const data = await api.importPrices(formData, csrfToken);
      if (mountedRef.current) {
        setSummary(data.summary || null);
        setLastDryRunToken(currentToken);
      }
      await markProgressSucceeded(data.summary || null, "อ่านไฟล์และตรวจรูปแบบ");
      showToast("Dry-run completed", "success");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Dry-run failed";
      markProgressFailed("อ่านไฟล์และตรวจรูปแบบ", message);
      showToast(message, "error");
    }
  }

  async function runCommit() {
    setConfirmOpen(false);
    openProgress("Monthly Price Update (Execute)", "Upsert เข้าฐานข้อมูล");
    try {
      const formData = buildFormData(file, form, true);
      const data = await api.importPrices(formData, csrfToken);
      if (mountedRef.current) {
        setSummary(data.summary || null);
      }
      await markProgressSucceeded(data.summary || null, "Upsert เข้าฐานข้อมูล");
      showToast("Price update committed", "success");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Commit failed";
      markProgressFailed("Upsert เข้าฐานข้อมูล", message);
      showToast(message, "error");
    }
  }

  if (!isAdmin) {
    return <div className="empty-state">Staff users cannot run imports.</div>;
  }

  return (
    <div className="stack">
      <h1>Monthly Price Update</h1>
      <p className="muted">
        Price-only mode is enforced. Dry-run required before commit. Excel Data Only import supports
        current-price updates (price history must be off).
      </p>

      <div className="info-card">
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            runDryRun();
          }}
        >
          <label className="label-span-2">
            Source File (CSV or Excel Data Only)
            <input
              type="file"
              accept=".csv,text/csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] || null;
                setFile(nextFile);
                if (isExcelFile(nextFile)) {
                  setForm((prev) => ({ ...prev, priceHistory: "off" }));
                }
                setLastDryRunToken("");
              }}
            />
          </label>
          <label>
            Mode
            <input type="text" value="price-only" disabled />
          </label>
          <label>
            Price History
            <select
              value={form.priceHistory}
              disabled={isExcelFile(file)}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, priceHistory: event.target.value }));
                setLastDryRunToken("");
              }}
            >
              <option value="off">off</option>
              <option value="on">on</option>
            </select>
          </label>
          <label>
            Limit
            <input
              type="number"
              min="1"
              value={form.limit}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, limit: event.target.value }));
                setLastDryRunToken("");
              }}
              placeholder="optional"
            />
          </label>
          <label>
            Batch Size
            <input
              type="number"
              min="1"
              value={form.batchSize}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, batchSize: event.target.value }));
                setLastDryRunToken("");
              }}
            />
          </label>

          <div className="actions-inline label-span-2">
            <button type="submit" className="btn btn-primary">
              Run Dry-Run
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!canCommit}
              onClick={() => setConfirmOpen(true)}
            >
              Commit Price Update
            </button>
          </div>
        </form>
      </div>

      <SummaryBlock summary={summary} />

      <ConfirmModal
        open={confirmOpen}
        title="Confirm Monthly Price Commit"
        message="This will write retail and wholesale pricing updates to the database."
        confirmLabel="Commit"
        onConfirm={runCommit}
        onCancel={() => setConfirmOpen(false)}
      />

      <ProgressOverlay
        open={progressOverlay.open}
        title={progressOverlay.title}
        status={progressOverlay.status}
        stepLabel={progressOverlay.stepLabel}
        processed={progressOverlay.processed}
        total={progressOverlay.total}
        percent={progressOverlay.percent}
        meta={progressOverlay.meta}
        startedAt={progressOverlay.startedAt}
        finishedAt={progressOverlay.finishedAt}
        errorMessage={progressOverlay.errorMessage}
        networkMessage={progressOverlay.networkMessage}
        onClose={
          progressOverlay.status === "running" || progressOverlay.status === "queued"
            ? undefined
            : () =>
                setProgressSafe((prev) => ({
                  ...prev,
                  open: false,
                }))
        }
      />
    </div>
  );
}
