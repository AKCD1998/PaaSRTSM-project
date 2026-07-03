"use strict";

const crypto = require("crypto");

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function logError(logger, message) {
  if (typeof logger.error === "function") {
    logger.error(message);
  } else if (typeof logger.log === "function") {
    logger.log(message);
  }
}

async function insertJobEvent(db, { jobId, eventType, message = null, payload = {}, createdBy = null }) {
  await db.query(
    `INSERT INTO content.video_job_events (video_job_id, event_type, message, payload_json, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [jobId, eventType, message, JSON.stringify(payload || {}), createdBy],
  );
}

// Orchestrates polling remote video-generation providers on a timer. Modeled on
// embedding-sync-jobs.js's runner class, but adapted for waiting on a remote
// provider instead of doing local CPU work: each poll schedules the next one via
// setTimeout (never setInterval), so polls for a given job never overlap.
class VideoJobRunner {
  constructor({ db, config, getVideoProviderFn, storageProvider, logger }) {
    this.db = db;
    this.config = config;
    this.getVideoProviderFn = getVideoProviderFn;
    this.storageProvider = storageProvider;
    this.logger = logger || console;
    this.timers = new Map();
  }

  schedulePoll(jobId, delayMs) {
    const normalizedJobId = Number(jobId);
    if (!Number.isInteger(normalizedJobId) || normalizedJobId <= 0) {
      return;
    }
    const existing = this.timers.get(normalizedJobId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.pollOnce(normalizedJobId).catch((error) => {
        logError(this.logger, `[video-job-runner] job_id=${normalizedJobId} poll failed: ${error.message}`);
      });
    }, delayMs != null ? delayMs : this.config.videoPollIntervalMs);
    // Timers should not keep the Node process alive on their own (tests, CLI scripts).
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.timers.set(normalizedJobId, timer);
  }

  stop(jobId) {
    const normalizedJobId = Number(jobId);
    const existing = this.timers.get(normalizedJobId);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.delete(normalizedJobId);
  }

  async markFailed(jobId, { errorCode, errorMessage }) {
    await this.db.query(
      `UPDATE content.video_jobs
       SET status = 'failed', error_code = $2, error_message = $3, updated_at = now()
       WHERE job_id = $1 AND status IN ('queued', 'processing')`,
      [jobId, errorCode, errorMessage],
    );
    await insertJobEvent(this.db, {
      jobId,
      eventType: "job_failed",
      message: errorMessage,
      payload: { errorCode },
    });
  }

  async pollOnce(jobId) {
    this.timers.delete(jobId);

    try {
      const jobResult = await this.db.query(`SELECT * FROM content.video_jobs WHERE job_id = $1`, [jobId]);
      const job = jobResult.rows[0];
      if (!job) {
        return;
      }
      if (!["queued", "processing"].includes(job.status)) {
        return;
      }

      const submittedAtMs = job.submitted_at ? new Date(job.submitted_at).getTime() : Date.now();
      const elapsedMinutes = (Date.now() - submittedAtMs) / 60000;
      if (elapsedMinutes > this.config.videoMaxPollMinutes) {
        await this.markFailed(jobId, { errorCode: "timeout", errorMessage: "Polling exceeded videoMaxPollMinutes" });
        return;
      }

      const provider = this.getVideoProviderFn(job.provider, this.config);
      const statusResult = await provider.getGenerationJobStatus(job.provider_job_id);

      if (statusResult.status === "queued") {
        this.schedulePoll(jobId);
        return;
      }

      if (statusResult.status === "processing") {
        await this.db.query(
          `UPDATE content.video_jobs
           SET status = 'processing', started_at = COALESCE(started_at, now()), updated_at = now()
           WHERE job_id = $1 AND status IN ('queued', 'processing')`,
          [jobId],
        );
        await insertJobEvent(this.db, {
          jobId,
          eventType: "provider_status_updated",
          payload: { status: statusResult.status, progress: statusResult.progress ?? null },
        });
        this.schedulePoll(jobId);
        return;
      }

      if (statusResult.status === "completed") {
        const { buffer, mimeType } = await provider.downloadGenerationOutput(job.provider_job_id);
        await insertJobEvent(this.db, { jobId, eventType: "output_downloaded", payload: { mimeType, bytes: buffer.length } });

        const assetPublicId = crypto.randomUUID();
        const ext = mimeType === "video/mp4" ? ".mp4" : "";
        const storageKey = `content/generated_video/${assetPublicId}${ext}`;
        await this.storageProvider.uploadAsset({ key: storageKey, buffer, mimeType });
        await insertJobEvent(this.db, { jobId, eventType: "output_stored", payload: { storageKey } });

        const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
        const assetInsertResult = await this.db.query(
          `INSERT INTO content.video_assets (
             asset_public_id, created_by, storage_provider, storage_key, mime_type,
             file_size_bytes, asset_type, checksum
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'generated_video', $7)
           RETURNING asset_id`,
          [assetPublicId, job.created_by, this.config.videoStorageProvider || "local", storageKey, mimeType, buffer.length, checksum],
        );
        const outputAssetId = assetInsertResult.rows[0].asset_id;

        await this.db.query(
          `UPDATE content.video_jobs
           SET status = 'completed', output_asset_id = $2, completed_at = now(), updated_at = now()
           WHERE job_id = $1 AND status IN ('queued', 'processing')`,
          [jobId, outputAssetId],
        );
        await insertJobEvent(this.db, { jobId, eventType: "job_completed", payload: { outputAssetId } });
        return;
      }

      if (statusResult.status === "failed") {
        await this.markFailed(jobId, {
          errorCode: statusResult.errorCode || "provider_failed",
          errorMessage: normalizeText(statusResult.errorMessage) || "Provider reported failure",
        });
        return;
      }

      // Unknown status: treat as processing and keep polling rather than failing outright.
      this.schedulePoll(jobId);
    } catch (error) {
      logError(this.logger, `[video-job-runner] job_id=${jobId} unexpected error: ${error.message}`);
      try {
        await this.markFailed(jobId, { errorCode: "runner_exception", errorMessage: error.message });
      } catch (_innerError) {
        // Do not let a failure to record the failure crash the process.
      }
    }
  }
}

function createVideoJobRunner(deps) {
  return new VideoJobRunner(deps);
}

module.exports = {
  VideoJobRunner,
  createVideoJobRunner,
};
