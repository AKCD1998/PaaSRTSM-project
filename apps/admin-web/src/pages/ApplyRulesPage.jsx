import { useMemo, useState } from "react";
import { ApiError, api } from "../lib/api";
import { stableFormToken } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";
import { ConfirmModal } from "../components/ConfirmModal";

export function ApplyRulesPage() {
  const { isAdmin, csrfToken } = useAuth();
  const { withLoading, showToast } = useUi();

  const [form, setForm] = useState({
    onlyStatus: "",
    limit: "",
    force: false,
  });
  const [summary, setSummary] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastDryRunToken, setLastDryRunToken] = useState("");

  const currentToken = useMemo(() => stableFormToken(form), [form]);
  const canCommit = isAdmin && summary?.mode === "dry-run" && lastDryRunToken === currentToken;

  async function runDryRun() {
    await withLoading(async () => {
      try {
        const data = await api.applyRules(
          {
            commit: false,
            only_status: form.onlyStatus || undefined,
            limit: form.limit || undefined,
            force: form.force,
          },
          csrfToken,
        );
        setSummary(data.summary || null);
        setLastDryRunToken(currentToken);
        showToast("Rule dry-run completed", "success");
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Rule dry-run failed", "error");
        }
      }
    });
  }

  async function runCommit() {
    setConfirmOpen(false);
    await withLoading(async () => {
      try {
        const data = await api.applyRules(
          {
            commit: true,
            only_status: form.onlyStatus || undefined,
            limit: form.limit || undefined,
            force: form.force,
          },
          csrfToken,
        );
        setSummary(data.summary || null);
        showToast("Rules applied", "success");
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Apply rules commit failed", "error");
        }
      }
    });
  }

  if (!isAdmin) {
    return <div className="empty-state">Staff users cannot apply enrichment rules.</div>;
  }

  return (
    <div className="stack">
      <h1>Apply Enrichment Rules</h1>
      <p className="muted">Run dry-run first. Commit is allowed only for matching dry-run options.</p>

      <div className="info-card">
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            runDryRun();
          }}
        >
          <label>
            Only Status
            <select
              value={form.onlyStatus}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, onlyStatus: event.target.value }));
                setLastDryRunToken("");
              }}
            >
              <option value="">all</option>
              <option value="missing">missing</option>
              <option value="partial">partial</option>
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
          <label className="toggle-inline">
            <input
              type="checkbox"
              checked={form.force}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, force: event.target.checked }));
                setLastDryRunToken("");
              }}
            />
            Force overwrite existing fields
          </label>
          <div className="actions-inline label-span-2">
            <button type="submit" className="btn btn-primary">
              Run Dry-Run
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmOpen(true)}
              disabled={!canCommit}
            >
              Commit Apply Rules
            </button>
          </div>
        </form>
      </div>

      <div className="summary-card">
        <h3>Summary</h3>
        {!summary && <p className="muted">No result yet.</p>}
        {summary && (
          <>
            <p className="muted">
              Mode: {summary.mode} | Rules loaded: {summary.rules_loaded} | Updated: {summary.totals?.updated ?? 0}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rule ID</th>
                    <th>Priority</th>
                    <th>Matched</th>
                    <th>Updated</th>
                    <th>Skipped</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.ruleSummaries || []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty-cell">
                        No rule rows.
                      </td>
                    </tr>
                  )}
                  {(summary.ruleSummaries || []).map((row) => (
                    <tr key={row.rule_id}>
                      <td>{row.rule_id}</td>
                      <td>{row.priority}</td>
                      <td>{row.matched}</td>
                      <td>{row.updated}</td>
                      <td>{JSON.stringify(row.skipped || {})}</td>
                      <td>{row.error || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirm Apply Rules Commit"
        message="This action updates SKU enrichment fields in bulk."
        confirmLabel="Commit"
        onConfirm={runCommit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
