import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../lib/api";
import { formatDateTime, stableFormToken } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";
import { ConfirmModal } from "../components/ConfirmModal";

const EMPTY_RULE_FORM = {
  isEnabled: true,
  priority: "100",
  matchNameRegex: "",
  matchCategoryRegex: "",
  matchSupplierRegex: "",
  setGenericName: "",
  setStrengthText: "",
  setForm: "",
  setRoute: "",
  setProductKind: "",
  setStatus: "partial",
  note: "",
};

function toRuleForm(rule) {
  if (!rule) {
    return { ...EMPTY_RULE_FORM };
  }
  return {
    isEnabled: Boolean(rule.is_enabled),
    priority: String(rule.priority ?? "100"),
    matchNameRegex: String(rule.match_name_regex || ""),
    matchCategoryRegex: String(rule.match_category_regex || ""),
    matchSupplierRegex: String(rule.match_supplier_regex || ""),
    setGenericName: String(rule.set_generic_name || ""),
    setStrengthText: String(rule.set_strength_text || ""),
    setForm: String(rule.set_form || ""),
    setRoute: String(rule.set_route || ""),
    setProductKind: String(rule.set_product_kind || ""),
    setStatus: String(rule.set_status || "partial"),
    note: String(rule.note || ""),
  };
}

function toRulePayload(form) {
  return {
    is_enabled: Boolean(form.isEnabled),
    priority: form.priority,
    match_name_regex: form.matchNameRegex,
    match_category_regex: form.matchCategoryRegex,
    match_supplier_regex: form.matchSupplierRegex,
    set_generic_name: form.setGenericName,
    set_strength_text: form.setStrengthText,
    set_form: form.setForm,
    set_route: form.setRoute,
    set_product_kind: form.setProductKind,
    set_status: form.setStatus,
    note: form.note,
  };
}

function summarizeMatchers(rule) {
  const parts = [];
  if (rule.match_name_regex) {
    parts.push(`name: ${rule.match_name_regex}`);
  }
  if (rule.match_category_regex) {
    parts.push(`category: ${rule.match_category_regex}`);
  }
  if (rule.match_supplier_regex) {
    parts.push(`supplier: ${rule.match_supplier_regex}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "-";
}

function summarizeSetters(rule) {
  const parts = [];
  if (rule.set_generic_name) {
    parts.push(`generic=${rule.set_generic_name}`);
  }
  if (rule.set_strength_text) {
    parts.push(`strength=${rule.set_strength_text}`);
  }
  if (rule.set_form) {
    parts.push(`form=${rule.set_form}`);
  }
  if (rule.set_route) {
    parts.push(`route=${rule.set_route}`);
  }
  if (rule.set_product_kind) {
    parts.push(`kind=${rule.set_product_kind}`);
  }
  if (rule.note) {
    parts.push("note");
  }
  parts.push(`status=${rule.set_status}`);
  return parts.join(" | ");
}

export function ApplyRulesPage() {
  const { isAdmin, csrfToken } = useAuth();
  const { withLoading, showToast } = useUi();

  const [applyForm, setApplyForm] = useState({
    onlyStatus: "",
    limit: "",
    force: false,
  });
  const [summary, setSummary] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastDryRunToken, setLastDryRunToken] = useState("");

  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleForm, setRuleForm] = useState(() => ({ ...EMPTY_RULE_FORM }));

  const currentToken = useMemo(() => stableFormToken(applyForm), [applyForm]);
  const canCommit = isAdmin && summary?.mode === "dry-run" && lastDryRunToken === currentToken;

  const loadRules = useCallback(
    async (options = {}) => {
      const silent = Boolean(options.silent);
      if (!silent) {
        setRulesLoading(true);
      }
      try {
        const data = await api.listEnrichmentRules();
        setRules(data.rows || []);
      } catch (error) {
        if (!silent) {
          if (error instanceof ApiError) {
            showToast(error.message, "error");
          } else {
            showToast("Failed to load enrichment rules", "error");
          }
        }
      } finally {
        if (!silent) {
          setRulesLoading(false);
        }
      }
    },
    [showToast],
  );

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  function clearRuleForm() {
    setEditingRuleId(null);
    setRuleForm({ ...EMPTY_RULE_FORM });
  }

  async function saveRule() {
    const payload = toRulePayload(ruleForm);
    await withLoading(async () => {
      try {
        let row = null;
        if (editingRuleId) {
          const data = await api.updateEnrichmentRule(editingRuleId, payload, csrfToken);
          row = data.row;
          showToast("Rule updated", "success");
        } else {
          const data = await api.createEnrichmentRule(payload, csrfToken);
          row = data.row;
          showToast("Rule created", "success");
        }

        await loadRules({ silent: true });
        if (row?.rule_id) {
          setEditingRuleId(row.rule_id);
          setRuleForm(toRuleForm(row));
        }
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Failed to save rule", "error");
        }
      }
    });
  }

  async function toggleRule(rule) {
    await withLoading(async () => {
      try {
        await api.updateEnrichmentRule(
          rule.rule_id,
          {
            is_enabled: !rule.is_enabled,
          },
          csrfToken,
        );
        await loadRules({ silent: true });
        showToast(rule.is_enabled ? "Rule disabled" : "Rule enabled", "success");
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Failed to toggle rule", "error");
        }
      }
    });
  }

  function beginEdit(rule) {
    setEditingRuleId(rule.rule_id);
    setRuleForm(toRuleForm(rule));
  }

  async function runDryRun() {
    await withLoading(async () => {
      try {
        const data = await api.applyRules(
          {
            commit: false,
            only_status: applyForm.onlyStatus || undefined,
            limit: applyForm.limit || undefined,
            force: applyForm.force,
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
            only_status: applyForm.onlyStatus || undefined,
            limit: applyForm.limit || undefined,
            force: applyForm.force,
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
      <p className="muted">
        Define rules and run dry-run/commit in the same page. Commit is allowed only for matching dry-run options.
      </p>

      <div className="info-card">
        <div className="row-space">
          <h3>{editingRuleId ? `Edit Rule #${editingRuleId}` : "Create Enrichment Rule"}</h3>
          <div className="actions-inline">
            <button type="button" className="btn btn-secondary" onClick={() => loadRules()} disabled={rulesLoading}>
              Refresh Rules
            </button>
            <button type="button" className="btn btn-secondary" onClick={clearRuleForm}>
              Clear Form
            </button>
          </div>
        </div>

        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            saveRule();
          }}
        >
          <label className="toggle-inline">
            <input
              type="checkbox"
              checked={ruleForm.isEnabled}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, isEnabled: event.target.checked }))}
            />
            Rule Enabled
          </label>
          <label>
            Priority
            <input
              type="number"
              min="1"
              value={ruleForm.priority}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, priority: event.target.value }))}
            />
          </label>

          <label>
            Match Name Regex
            <input
              value={ruleForm.matchNameRegex}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, matchNameRegex: event.target.value }))}
              placeholder="e.g. amox|amoxicillin"
            />
          </label>
          <label>
            Match Category Regex
            <input
              value={ruleForm.matchCategoryRegex}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, matchCategoryRegex: event.target.value }))}
            />
          </label>

          <label>
            Match Supplier Regex
            <input
              value={ruleForm.matchSupplierRegex}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, matchSupplierRegex: event.target.value }))}
            />
          </label>
          <label>
            Set Status
            <select
              value={ruleForm.setStatus}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, setStatus: event.target.value }))}
            >
              <option value="missing">missing</option>
              <option value="partial">partial</option>
              <option value="verified">verified</option>
            </select>
          </label>

          <label>
            Set Generic Name
            <input
              value={ruleForm.setGenericName}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, setGenericName: event.target.value }))}
            />
          </label>
          <label>
            Set Strength Text
            <input
              value={ruleForm.setStrengthText}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, setStrengthText: event.target.value }))}
            />
          </label>

          <label>
            Set Form
            <input
              value={ruleForm.setForm}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, setForm: event.target.value }))}
            />
          </label>
          <label>
            Set Route
            <input
              value={ruleForm.setRoute}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, setRoute: event.target.value }))}
            />
          </label>

          <label>
            Set Product Kind
            <input
              value={ruleForm.setProductKind}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, setProductKind: event.target.value }))}
            />
          </label>
          <label>
            Note
            <input
              value={ruleForm.note}
              onChange={(event) => setRuleForm((prev) => ({ ...prev, note: event.target.value }))}
            />
          </label>

          <div className="actions-inline label-span-2">
            <button type="submit" className="btn btn-primary">
              {editingRuleId ? "Update Rule" : "Create Rule"}
            </button>
          </div>
        </form>
      </div>

      <div className="summary-card">
        <h3>Rules ({rules.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule ID</th>
                <th>Enabled</th>
                <th>Priority</th>
                <th>Matchers</th>
                <th>Set Values</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No enrichment rules yet.
                  </td>
                </tr>
              )}
              {rules.map((rule) => (
                <tr key={rule.rule_id} className={editingRuleId === rule.rule_id ? "row-selected" : ""}>
                  <td>{rule.rule_id}</td>
                  <td>{rule.is_enabled ? "yes" : "no"}</td>
                  <td>{rule.priority}</td>
                  <td>{summarizeMatchers(rule)}</td>
                  <td>{summarizeSetters(rule)}</td>
                  <td>{formatDateTime(rule.updated_at)}</td>
                  <td>
                    <div className="actions-inline">
                      <button type="button" className="btn btn-secondary" onClick={() => beginEdit(rule)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => toggleRule(rule)}>
                        {rule.is_enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="info-card">
        <h3>Batch Apply</h3>
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
              value={applyForm.onlyStatus}
              onChange={(event) => {
                setApplyForm((prev) => ({ ...prev, onlyStatus: event.target.value }));
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
              value={applyForm.limit}
              onChange={(event) => {
                setApplyForm((prev) => ({ ...prev, limit: event.target.value }));
                setLastDryRunToken("");
              }}
              placeholder="optional"
            />
          </label>
          <label className="toggle-inline">
            <input
              type="checkbox"
              checked={applyForm.force}
              onChange={(event) => {
                setApplyForm((prev) => ({ ...prev, force: event.target.checked }));
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
        <h3>Apply Summary</h3>
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
