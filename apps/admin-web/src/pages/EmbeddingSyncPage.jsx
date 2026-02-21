import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { formatDateTime, formatNumber } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";
import { ConfirmModal } from "../components/ConfirmModal";
import { ProgressOverlay } from "../components/ProgressOverlay";
import { pollJob } from "../lib/pollJob";
import { normalizeProgressPayload } from "../lib/progress";

const LIST_POLL_INTERVAL_MS = 3000;
const JOB_PROGRESS_POLL_INTERVAL_MS = 1500;

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

function progressTitle(mode) {
  if (mode === "execute") {
    return "Embedding Sync (Execute)";
  }
  return "Embedding Sync (Dry-run)";
}

function progressStepLabel(status, mode) {
  if (status === "queued") {
    return "กำลังรอคิวประมวลผล";
  }
  if (status === "running") {
    if (mode === "execute") {
      return "สร้าง embeddings";
    }
    return "ประเมินรายการที่จะสร้าง embeddings";
  }
  if (status === "succeeded") {
    return "เสร็จสิ้น";
  }
  if (status === "failed") {
    return "เกิดข้อผิดพลาดระหว่างประมวลผล";
  }
  if (status === "canceled") {
    return "งานถูกยกเลิก";
  }
  return "กำลังประมวลผล";
}

function truncateMessage(message, maxLength = 220) {
  const value = String(message == null ? "" : message).trim();
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 12)}...[truncated]`;
}

function toProgressState(detail, mode) {
  const normalized = normalizeProgressPayload(detail || {}, {
    fallbackStatus: detail?.job?.status || "running",
  });
  const status = normalized.status || detail?.job?.status || "running";

  return {
    status,
    stepLabel: normalized.stepLabel || progressStepLabel(status, mode),
    processed: normalized.processed,
    total: normalized.total,
    percent: normalized.percent,
    meta: {
      inserted: normalized.meta?.inserted,
      updated: normalized.meta?.updated,
      errors: normalized.meta?.errors,
    },
    startedAt: detail?.job?.started_at || null,
    finishedAt: detail?.job?.finished_at || null,
    errorMessage: truncateMessage(detail?.job?.error_summary || ""),
  };
}

export function EmbeddingSyncPage() {
  const { isAdmin, csrfToken } = useAuth();
  const { showToast } = useUi();

  const mountedRef = useRef(true);
  const pollSessionRef = useRef(0);
  const selectedJobIdRef = useRef(null);

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
  const [progressOverlay, setProgressOverlay] = useState({
    open: false,
    title: "",
    jobId: null,
    mode: "dry_run",
    status: "queued",
    stepLabel: "กำลังเริ่มงาน...",
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
      pollSessionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  const hasActiveJobs = useMemo(() => {
    if (jobDetail?.job && isActiveStatus(jobDetail.job.status)) {
      return true;
    }
    return jobs.some((job) => isActiveStatus(job.status));
  }, [jobDetail, jobs]);

  const setProgressSafe = useCallback((updater) => {
    if (!mountedRef.current) {
      return;
    }
    setProgressOverlay((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const upsertJobRow = useCallback((nextJob) => {
    if (!nextJob || !nextJob.job_id) {
      return;
    }
    setJobs((prev) => {
      const index = prev.findIndex((job) => job.job_id === nextJob.job_id);
      if (index < 0) {
        return [nextJob, ...prev].slice(0, 50);
      }
      const merged = [...prev];
      merged[index] = nextJob;
      return merged;
    });
  }, []);

  const refreshJobs = useCallback(
    async (options = {}) => {
      const silent = Boolean(options.silent);
      if (!silent && mountedRef.current) {
        setLoadingJobs(true);
      }
      try {
        const data = await api.listSkuEmbeddingSyncJobs({ limit: 50 });
        if (mountedRef.current) {
          setJobs(data.rows || []);
        }
        return data.rows || [];
      } catch (error) {
        if (!silent) {
          if (error instanceof ApiError) {
            showToast(error.message, "error");
          } else {
            showToast("Failed to load embedding sync jobs", "error");
          }
        }
        return [];
      } finally {
        if (!silent && mountedRef.current) {
          setLoadingJobs(false);
        }
      }
    },
    [showToast],
  );

  const refreshJobDetail = useCallback(
    async (jobId, options = {}) => {
      if (!jobId) {
        if (!options.silent && mountedRef.current) {
          setJobDetail(null);
        }
        return null;
      }
      const silent = Boolean(options.silent);
      try {
        const data = await api.getSkuEmbeddingSyncJob(jobId, {
          items_limit: 200,
        });
        const detail = {
          job: data.job,
          items: data.items || [],
        };
        if (mountedRef.current && options.skipState !== true) {
          setJobDetail(detail);
          upsertJobRow(detail.job);
        }
        return detail;
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
        return null;
      }
    },
    [showToast, upsertJobRow],
  );

  const applyOverlayFromJobDetail = useCallback(
    (detail, mode, networkMessage = "") => {
      if (!detail?.job) {
        return;
      }
      const progressState = toProgressState(detail, mode);
      setProgressSafe((prev) => ({
        ...prev,
        open: true,
        title: progressTitle(mode),
        jobId: detail.job.job_id,
        mode,
        ...progressState,
        networkMessage,
      }));
    },
    [setProgressSafe],
  );

  const startPollingJob = useCallback(
    async (jobId, mode) => {
      const session = pollSessionRef.current + 1;
      pollSessionRef.current = session;

      const shouldStop = () => !mountedRef.current || pollSessionRef.current !== session;

      try {
        const terminal = await pollJob(
          jobId,
          (id) =>
            api.getSkuEmbeddingSyncJob(id, {
              items_limit: 200,
            }),
          {
            intervalMs: JOB_PROGRESS_POLL_INTERVAL_MS,
            shouldStop,
            normalize: (payload) => {
              const detail = {
                job: payload?.job || payload,
                items: payload?.items || [],
              };
              return toProgressState(detail, mode);
            },
            onUpdate: (normalized, payload) => {
              const detail = {
                job: payload?.job || payload,
                items: payload?.items || [],
              };
              if (!detail.job) {
                return;
              }
              if (mountedRef.current) {
                upsertJobRow(detail.job);
                if (selectedJobIdRef.current === detail.job.job_id) {
                  setJobDetail(detail);
                }
              }
              setProgressSafe((prev) => ({
                ...prev,
                open: true,
                title: progressTitle(mode),
                jobId: detail.job.job_id,
                mode,
                status: normalized.status,
                stepLabel: normalized.stepLabel,
                processed: normalized.processed,
                total: normalized.total,
                percent: normalized.percent,
                meta: normalized.meta,
                startedAt: detail.job.started_at || prev.startedAt,
                finishedAt: detail.job.finished_at || null,
                errorMessage: truncateMessage(detail.job.error_summary || ""),
                networkMessage: "",
              }));
            },
            onRetry: () => {
              setProgressSafe((prev) => ({
                ...prev,
                networkMessage: "กำลังเชื่อมต่อ...",
              }));
            },
          },
        );

        setProgressSafe((prev) => ({
          ...prev,
          status: terminal.status,
          stepLabel: terminal.stepLabel,
          processed: terminal.processed,
          total: terminal.total,
          percent: terminal.percent,
          meta: terminal.meta,
          errorMessage: terminal.errorMessage || prev.errorMessage,
          networkMessage: "",
        }));

        if (terminal.status === "succeeded") {
          showToast(mode === "execute" ? "Execute sync เสร็จสิ้น" : "Dry-run sync เสร็จสิ้น", "success");
        } else if (terminal.status === "failed") {
          showToast("Embedding sync ล้มเหลว", "error");
        } else if (terminal.status === "canceled") {
          showToast("Embedding sync ถูกยกเลิก", "info");
        }

        await refreshJobs({ silent: true });
        if (selectedJobIdRef.current === jobId) {
          await refreshJobDetail(jobId, { silent: true });
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }
        const message = error instanceof ApiError ? error.message : "Polling embedding sync failed";
        setProgressSafe((prev) => ({
          ...prev,
          status: "failed",
          stepLabel: "ติดตามสถานะไม่สำเร็จ",
          finishedAt: new Date().toISOString(),
          errorMessage: truncateMessage(message),
          networkMessage: "",
        }));
        showToast(message, "error");
      }
    },
    [refreshJobDetail, refreshJobs, setProgressSafe, showToast, upsertJobRow],
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
    }, LIST_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, refreshJobDetail, refreshJobs, selectedJobId]);

  async function triggerSync(mode) {
    setTriggerBusy(true);
    setProgressSafe({
      open: true,
      title: progressTitle(mode),
      jobId: null,
      mode,
      status: "queued",
      stepLabel: "กำลังเริ่มงาน...",
      processed: null,
      total: null,
      percent: null,
      meta: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errorMessage: "",
      networkMessage: "",
    });

    try {
      const payload = toPayload(form, mode);
      const data = await api.triggerSkuEmbeddingSync(payload, csrfToken);
      const jobId = data?.job_id;
      if (!jobId) {
        throw new Error("Missing job_id from sync response");
      }
      if (mountedRef.current) {
        setSelectedJobId(jobId);
      }
      const detail = await refreshJobDetail(jobId, {
        silent: true,
      });
      if (detail) {
        applyOverlayFromJobDetail(detail, mode);
      } else {
        setProgressSafe((prev) => ({
          ...prev,
          jobId,
          mode,
          status: "queued",
          stepLabel: progressStepLabel("queued", mode),
        }));
      }
      refreshJobs({ silent: true });
      startPollingJob(jobId, mode);
      showToast(mode === "execute" ? "Execute job queued" : "Dry-run job queued", "success");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : truncateMessage(error?.message || "Failed to trigger embedding sync");
      setProgressSafe((prev) => ({
        ...prev,
        status: "failed",
        stepLabel: "เริ่มงานไม่สำเร็จ",
        finishedAt: new Date().toISOString(),
        errorMessage: truncateMessage(message),
        networkMessage: "",
      }));
      showToast(message, "error");
    } finally {
      if (mountedRef.current) {
        setTriggerBusy(false);
      }
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
      if (mountedRef.current) {
        setCancelBusy(false);
      }
    }
  }

  async function cancelOverlayJob() {
    if (!progressOverlay.jobId || !isActiveStatus(progressOverlay.status)) {
      return;
    }
    setCancelBusy(true);
    setProgressSafe((prev) => ({
      ...prev,
      networkMessage: "กำลังส่งคำขอยกเลิก...",
    }));

    try {
      const data = await api.cancelSkuEmbeddingSyncJob(progressOverlay.jobId, csrfToken);
      if (data.canceled) {
        showToast(`ส่งคำขอยกเลิกงาน #${progressOverlay.jobId} แล้ว`, "info");
      } else {
        showToast("งานไม่อยู่ในสถานะที่ยกเลิกได้", "info");
      }
      await refreshJobs({ silent: true });
      if (selectedJobId === progressOverlay.jobId) {
        await refreshJobDetail(progressOverlay.jobId, { silent: true });
      }
      setProgressSafe((prev) => ({
        ...prev,
        networkMessage: "",
      }));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to cancel job";
      setProgressSafe((prev) => ({
        ...prev,
        networkMessage: "",
        errorMessage: truncateMessage(message),
      }));
      showToast(message, "error");
    } finally {
      if (mountedRef.current) {
        setCancelBusy(false);
      }
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
              Job #{jobDetail.job.job_id} | status: {jobDetail.job.status} | started: {" "}
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
        onCancel={
          isActiveStatus(progressOverlay.status) && !cancelBusy && progressOverlay.jobId
            ? cancelOverlayJob
            : undefined
        }
        onClose={
          !isActiveStatus(progressOverlay.status)
            ? () =>
                setProgressSafe((prev) => ({
                  ...prev,
                  open: false,
                }))
            : undefined
        }
      />
    </div>
  );
}
