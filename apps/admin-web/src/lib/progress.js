function toNumberOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStatus(value, fallback = "running") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["queued", "running", "succeeded", "failed", "canceled"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function clampPercent(value) {
  const n = toNumberOrNull(value);
  if (n == null) {
    return null;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 100) {
    return 100;
  }
  return Math.floor(n);
}

export function formatElapsedMs(ms) {
  const n = toNumberOrNull(ms);
  if (n == null || n < 0) {
    return "-";
  }

  const totalSeconds = Math.floor(n / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function computeProgressPercent(input = {}) {
  const directPercent = clampPercent(input.percent);
  if (directPercent != null) {
    return directPercent;
  }

  const processed = toNumberOrNull(input.processed);
  const total = toNumberOrNull(input.total);
  if (processed != null && total != null && total > 0) {
    return clampPercent((processed / total) * 100);
  }
  return null;
}

export function normalizeProgressPayload(payload, options = {}) {
  const fallbackStatus = options.fallbackStatus || "running";
  const status = toStatus(
    payload?.status || payload?.job?.status || payload?.progress?.status || options.status,
    fallbackStatus,
  );
  const stepLabel =
    payload?.progress?.step ||
    payload?.step ||
    payload?.stepLabel ||
    payload?.message ||
    options.stepLabel ||
    "";

  const processed = toNumberOrNull(
    payload?.progress?.processed ??
      payload?.processedRows ??
      payload?.counts?.processed ??
      payload?.job?.processed_count ??
      payload?.processed,
  );
  const total = toNumberOrNull(
    payload?.progress?.total ??
      payload?.totalRows ??
      payload?.counts?.total ??
      payload?.job?.total_count ??
      payload?.total,
  );
  const percent = computeProgressPercent({
    percent: payload?.progress?.percent ?? payload?.percent,
    processed,
    total,
  });

  const inserted = toNumberOrNull(
    payload?.progress?.inserted ?? payload?.job?.inserted_count ?? payload?.counts?.inserted,
  );
  const updated = toNumberOrNull(
    payload?.progress?.updated ?? payload?.job?.updated_count ?? payload?.counts?.updated,
  );
  const errors = toNumberOrNull(
    payload?.progress?.errors ?? payload?.job?.error_count ?? payload?.counts?.errors,
  );

  return {
    stepLabel,
    processed,
    total,
    percent,
    status,
    meta: {
      inserted,
      updated,
      errors,
    },
  };
}
