"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const PLACEHOLDER_PATH = path.join(__dirname, "..", "..", "..", "assets", "mock-placeholder.mp4");

// Minimal, structurally-valid-enough fallback used only if BOTH ffmpeg spawning
// and the checked-in placeholder file are unavailable. This path should not be
// hit in practice — the placeholder is committed to the repo specifically so a
// deploy target without ffmpeg on PATH still has a guaranteed fallback.
const EMPTY_FALLBACK_BUFFER = Buffer.alloc(0);

// Module-level state is fine for a mock provider — it only needs to survive for
// the lifetime of one process, and is never a source of truth (video_jobs rows are).
const jobs = new Map();

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function createMockVideoProvider(config) {
  // Allow tests to shrink the simulated queued/processing/completed thresholds.
  const timing = Object.assign(
    { queuedMs: 5000, processingMs: 12000 },
    config?.videoMockTimingMs || {},
  );

  return {
    async createGenerationJob(_args) {
      const providerJobId = crypto.randomUUID();
      jobs.set(providerJobId, { createdAtMs: Date.now() });
      return { providerJobId, status: "queued", estimatedCost: null };
    },

    async getGenerationJobStatus(providerJobId) {
      const job = jobs.get(providerJobId);
      if (!job) {
        return { status: "failed", progress: 0, errorCode: "unknown_job", errorMessage: "Unknown mock job id" };
      }
      const elapsed = Date.now() - job.createdAtMs;
      if (elapsed < timing.queuedMs) {
        return { status: "queued", progress: 0, errorCode: null, errorMessage: null };
      }
      if (elapsed < timing.processingMs) {
        const progress = Math.min(
          99,
          Math.floor(((elapsed - timing.queuedMs) / (timing.processingMs - timing.queuedMs)) * 100),
        );
        return { status: "processing", progress, errorCode: null, errorMessage: null };
      }
      return { status: "completed", progress: 100, errorCode: null, errorMessage: null };
    },

    async cancelGenerationJob(providerJobId) {
      jobs.delete(providerJobId);
      return { cancelled: true };
    },

    async downloadGenerationOutput(_providerJobId) {
      const tmpOutPath = path.join(os.tmpdir(), `mock-video-${crypto.randomUUID()}.mp4`);
      try {
        await execFileAsync("ffmpeg", [
          "-f", "lavfi",
          "-i", "color=c=black:s=320x240:d=2",
          "-y",
          tmpOutPath,
        ]);
        const buffer = await fs.readFile(tmpOutPath);
        await fs.unlink(tmpOutPath).catch(() => {});
        return { buffer, mimeType: "video/mp4" };
      } catch (_error) {
        try {
          await fs.unlink(tmpOutPath).catch(() => {});
        } catch (_cleanupError) {
          // ignore
        }
        if (fsSync.existsSync(PLACEHOLDER_PATH)) {
          const buffer = await fs.readFile(PLACEHOLDER_PATH);
          return { buffer, mimeType: "video/mp4" };
        }
        return { buffer: EMPTY_FALLBACK_BUFFER, mimeType: "video/mp4" };
      }
    },
  };
}

module.exports = {
  createMockVideoProvider,
};
