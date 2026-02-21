import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../lib/api";
import { formatDateTime, formatNumber } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";
import { ConfirmModal } from "../components/ConfirmModal";

const POLL_INTERVAL_MS = 3000;

function isActiveStatus(status) {
  return status === "queued" || status === "running";
}

function toPayload(form, mode) {
  const filters = {};
  if (form.companyCode.trim()) {
    filters.company_code = form.companyCode.trim();
  }
  if (form.productKind.trim()) {
    filters.product_kind = form.productKind.trim();
  }
  if (form.categoryName.trim()) {
    filters.category_name = form.categoryName.trim();
  }
  if (form.supplierCode.trim()) {
    filters.supplier_code = form.supplierCode.trim();
  }

  return {
    mode,
    only_stale: form.onlyStale,
    limit: form.limit || undefined,
    batch_size: form.batchSize || undefined,
    since: form.since || undefined,
    rate_limit_ms: form.rateLimitMs || undefined,
    filters,
  };
}

function statusClass(status) {
  return `pill status-${status || "unknown"}`;
}

export function EmbeddingSyncPage() {
  const { isAdmin, csrfToken } = useAuth();
  const { showToast } = useUi();

  const [form, setForm] = useState({
    limit: "200",
    batchSize: "100",
    since: "",
    rateLimitMs: "0",
    onlyStale: true,
    companyCode: "",
    productKind: "",
    categoryName: "",
    supplierCode: "",
  });
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [jobDetail, setJobDetail] = useState(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmExecuteOpen, setConfirmExecuteOpen] = useState(false);

  const hasActiveJobs = useMemo(() => {
    if (jobDetail?.job && isActiveStatus(jobDetail.job.status)) {
      return true;
    }
    return jobs.some((job) => isActiveStatus(job.status));
  }, [jobDetail, jobs]);

  const refreshJobs = useCallback(
    async (options = {}) => {
      const silent = Boolean(options.silent);
      if (!silent) {
        setLoadingJobs(true);
      }
      try {
        const data = await api.listSkuEmbeddingSyncJobs({ limit: 50 });
        setJobs(data.rows || []);
      } catch (error) {
        if (!silent) {
          if (error instanceof ApiError) {
            showToast(error.message, "error");
          } else {
            showToast("Failed to load embedding sync jobs", "error");
          }
        }
      } finally {
        if (!silent) {
          setLoadingJobs(false);
        }
      }
    },
    [showToast],
  );

  const refreshJobDetail = useCallback(
    async (jobId, options = {}) => {
      if (!jobId) {
        setJobDetail(null);
        return;
      }
      const silent = Boolean(options.silent);
      try {
        const data = await api.getSkuEmbeddingSyncJob(jobId, {
          items_limit: 200,
        });
        setJobDetail({
          job: data.job,
          items: data.items || [],
        });
      } catch (error) {
        if (!silent) {
          if (error instanceof ApiError && error.status === 404) {
            showToast("Job not found", "error");
          } else if (error instanceof ApiError) {
            showToast(error.message, "error");
          } else {
            showToast("Failed to load job detail", "error");
          }
        }
      }
    },
    [showToast],
  );

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    if (!selectedJobId) {
      setJobDetail(null);
      return;
    }
    refreshJobDetail(selectedJobId);
  }, [refreshJobDetail, selectedJobId]);

  useEffect(() => {
    if (!hasActiveJobs) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      refreshJobs({ silent: true });
      if (selectedJobId) {
        refreshJobDetail(selectedJobId, { silent: true });
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, refreshJobDetail, refreshJobs, selectedJobId]);

  async function triggerSync(mode) {
    setTriggerBusy(true);
    try {
      const payload = toPayload(form, mode);
      const data = await api.triggerSkuEmbeddingSync(payload, csrfToken);
      const jobId = data.job_id;
      if (jobId) {
        setSelectedJobId(jobId);
      }
      await refreshJobs({ silent: true });
      if (jobId) {
        await refreshJobDetail(jobId, { silent: true });
      }
      showToast(mode === "execute" ? "Execute job queued" : "Dry-run job queued", "success");
    } catch (error) {
      if (error instanceof ApiError) {
        showToast(error.message, "error");
      } else {
        showToast("Failed to trigger embedding sync", "error");
      }
    } finally {
      setTriggerBusy(false);
    }
  }

  async function cancelSelectedJob() {
    if (!selectedJobId) {
      return;
    }
    setCancelBusy(true);
    try {
      const data = await api.cancelSkuEmbeddingSyncJob(selectedJobId, csrfToken);
      if (data.canceled) {
        showToast(`Cancel requested for job ${selectedJobId}`, "info");
      } else {
        showToast("Job is not active, cancel skipped", "info");
      }
      await refreshJobs({ silent: true });
      await refreshJobDetail(selectedJobId, { silent: true });
    } catch (error) {
      if (error instanceof ApiError) {
        showToast(error.message, "error");
      } else {
        showToast("Failed to cancel job", "error");
      }
    } finally {
      setCancelBusy(false);
    }
  }

  if (!isAdmin) {
    return <div className="empty-state">Staff users cannot trigger embedding sync jobs.</div>;
  }

  return (
    <div className="stack">
      <h1>SKU Embedding Sync</h1>
      <p className="muted">
        Dry-run is safe default and writes nothing. Execute writes to <code>public.sku_embeddings</code>.
      </p>

      <div className="info-card">
        <h3>Sync Controls</h3>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            triggerSync("dry_run");
          }}
        >
          <label>
            Limit
            <input
              type="number"
              min="1"
              max="5000"
              value={form.limit}
              onChange={(event) => setForm((prev) => ({ ...prev, limit: event.target.value }))}
            />
          </label>
          <label>
            Batch Size
            <input
              type="number"
              min="1"
              max="500"
              value={form.batchSize}
              onChange={(event) => setForm((prev) => ({ ...prev, batchSize: event.target.value }))}
            />
          </label>
          <label>
            Since (optional)
            <input
              type="datetime-local"
              value={form.since}
              onChange={(event) => setForm((prev) => ({ ...prev, since: event.target.value }))}
            />
          </label>
          <label>
            Provider Delay (ms)
            <input
              type="number"
              min="0"
              max="2000"
              value={form.rateLimitMs}
              onChange={(event) => setForm((prev) => ({ ...prev, rateLimitMs: event.target.value }))}
            />
          </label>
          <label>
            Filter: Company Code
            <input
              value={form.companyCode}
              onChange={(event) => setForm((prev) => ({ ...prev, companyCode: event.target.value }))}
              placeholder="e.g. 630010001"
            />
          </label>
          <label>
            Filter: Product Kind
            <input
              value={form.productKind}
              onChange={(event) => setForm((prev) => ({ ...prev, productKind: event.target.value }))}
              placeholder="e.g. medicine"
            />
          </label>
          <label>
            Filter: Category
            <input
              value={form.categoryName}
              onChange={(event) => setForm((prev) => ({ ...prev, categoryName: event.target.value }))}
            />
          </label>
          <label>
            Filter: Supplier
            <input
              value={form.supplierCode}
              onChange={(event) => setForm((prev) => ({ ...prev, supplierCode: event.target.value }))}
            />
          </label>
          <label className="toggle-inline label-span-2">
            <input
              type="checkbox"
              checked={form.onlyStale}
              onChange={(event) => setForm((prev) => ({ ...prev, onlyStale: event.target.checked }))}
            />
            Process only stale/missing embeddings
          </label>
          <div className="actions-inline label-span-2">
            <button type="submit" className="btn btn-primary" disabled={triggerBusy}>
              Dry-run Sync
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmExecuteOpen(true)}
              disabled={triggerBusy}
            >
              Execute Sync
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => refreshJobs()}
              disabled={loadingJobs}
            >
              Refresh Jobs
            </button>
          </div>
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Requested By</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Processed</th>
              <th>Inserted</th>
              <th>Updated</th>
              <th>Skipped</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={11} className="empty-cell">
                  No embedding sync jobs yet.
                </td>
              </tr>
            )}
            {jobs.map((job) => (
              <tr
                key={job.job_id}
                className={selectedJobId === job.job_id ? "row-selected" : ""}
                onClick={() => setSelectedJobId(job.job_id)}
                style={{ cursor: "pointer" }}
              >
                <td>{job.job_id}</td>
                <td>{job.mode}</td>
                <td>
                  <span className={statusClass(job.status)}>{job.status}</span>
                </td>
                <td>{job.requested_by}</td>
                <td>{formatDateTime(job.started_at)}</td>
                <td>{formatDateTime(job.finished_at)}</td>
                <td>{formatNumber(job.processed_count)}</td>
                <td>{formatNumber(job.inserted_count)}</td>
                <td>{formatNumber(job.updated_count)}</td>
                <td>{formatNumber(job.skipped_count)}</td>
                <td>{formatNumber(job.error_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="summary-card">
        <div className="row-space">
          <h3>Job Detail</h3>
          <div className="actions-inline">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => selectedJobId && refreshJobDetail(selectedJobId)}
              disabled={!selectedJobId}
            >
              Refresh Detail
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={cancelSelectedJob}
              disabled={!selectedJobId || !isActiveStatus(jobDetail?.job?.status) || cancelBusy}
            >
              Cancel Job
            </button>
          </div>
        </div>

        {!jobDetail && <p className="muted">Select a job to view detail.</p>}
        {jobDetail && (
          <div className="stack">
            <p className="muted">
              Job #{jobDetail.job.job_id} | status: {jobDetail.job.status} | started:{" "}
              {formatDateTime(jobDetail.job.started_at)} | finished: {formatDateTime(jobDetail.job.finished_at)}
            </p>
            <p className="muted">
              processed={formatNumber(jobDetail.job.processed_count)} inserted=
              {formatNumber(jobDetail.job.inserted_count)} updated={formatNumber(jobDetail.job.updated_count)}{" "}
              skipped={formatNumber(jobDetail.job.skipped_count)} errors={formatNumber(jobDetail.job.error_count)}
            </p>
            {jobDetail.job.error_summary && <p className="muted">Error summary: {jobDetail.job.error_summary}</p>}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item ID</th>
                    <th>SKU ID</th>
                    <th>Action</th>
                    <th>Hash Before</th>
                    <th>Hash After</th>
                    <th>Error</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {jobDetail.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty-cell">
                        No changed/error item logs for this job.
                      </td>
                    </tr>
                  )}
                  {jobDetail.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.sku_id ?? "-"}</td>
                      <td>{item.action}</td>
                      <td>{item.content_hash_before || "-"}</td>
                      <td>{item.content_hash_after || "-"}</td>
                      <td>{item.error_message || "-"}</td>
                      <td>{formatDateTime(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmExecuteOpen}
        title="Confirm Execute Sync"
        message="Execute mode writes/upserts embeddings into public.sku_embeddings. Continue?"
        confirmLabel="Execute Sync"
        busy={triggerBusy}
        onCancel={() => setConfirmExecuteOpen(false)}
        onConfirm={async () => {
          setConfirmExecuteOpen(false);
          await triggerSync("execute");
        }}
      />
    </div>
  );
}
