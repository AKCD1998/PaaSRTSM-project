import { useMemo, useState } from "react";
import { ApiError, api } from "../lib/api";
import { stableFormToken, titleize } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";
import { ConfirmModal } from "../components/ConfirmModal";

function fileToken(file) {
  if (!file) {
    return "";
  }
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function buildFormData(file, form, commitValue) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("mode", "price-only");
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
  const { withLoading, showToast } = useUi();
  const [file, setFile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState({
    priceHistory: "off",
    limit: "",
    batchSize: "500",
  });
  const [lastDryRunToken, setLastDryRunToken] = useState("");

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

  async function runDryRun() {
    if (!file) {
      showToast("Choose a CSV file first", "error");
      return;
    }
    await withLoading(async () => {
      try {
        const formData = buildFormData(file, form, false);
        const data = await api.importPrices(formData, csrfToken);
        setSummary(data.summary || null);
        setLastDryRunToken(currentToken);
        showToast("Dry-run completed", "success");
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Dry-run failed", "error");
        }
      }
    });
  }

  async function runCommit() {
    setConfirmOpen(false);
    await withLoading(async () => {
      try {
        const formData = buildFormData(file, form, true);
        const data = await api.importPrices(formData, csrfToken);
        setSummary(data.summary || null);
        showToast("Price update committed", "success");
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Commit failed", "error");
        }
      }
    });
  }

  if (!isAdmin) {
    return <div className="empty-state">Staff users cannot run imports.</div>;
  }

  return (
    <div className="stack">
      <h1>Monthly Price Update</h1>
      <p className="muted">Price-only mode is enforced. Dry-run required before commit.</p>

      <div className="info-card">
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            runDryRun();
          }}
        >
          <label className="label-span-2">
            CSV File
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
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
    </div>
  );
}
