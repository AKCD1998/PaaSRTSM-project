function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isAbortError(error) {
  return error && (error.name === "AbortError" || error.code === "ABORT_ERR");
}

export function isTerminalStatus(status) {
  return ["succeeded", "failed", "canceled"].includes(String(status || "").toLowerCase());
}

export async function pollJob(jobId, fetchStatusFn, options = {}) {
  const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 1000;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 0;
  const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : () => {};
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : () => {};
  const normalize = typeof options.normalize === "function" ? options.normalize : (payload) => payload;
  const shouldStop = typeof options.shouldStop === "function" ? options.shouldStop : () => false;
  const startedAt = Date.now();

  let retryCount = 0;
  while (true) {
    if (shouldStop()) {
      const error = new Error("Polling aborted");
      error.name = "AbortError";
      throw error;
    }
    if (timeoutMs > 0 && Date.now() - startedAt > timeoutMs) {
      const error = new Error("Polling timed out");
      error.code = "POLL_TIMEOUT";
      throw error;
    }

    try {
      const payload = await fetchStatusFn(jobId);
      const normalized = normalize(payload);
      retryCount = 0;
      onUpdate(normalized, payload);
      if (isTerminalStatus(normalized?.status)) {
        return normalized;
      }
    } catch (error) {
      if (isAbortError(error) || shouldStop()) {
        throw error;
      }
      retryCount += 1;
      onRetry({
        retryCount,
        message: error?.message || "Network error",
      });
    }

    await sleep(intervalMs);
  }
}
