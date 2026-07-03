"use strict";

/**
 * @interface VideoProvider
 *
 * Contract every video-generation backend (mock today; openai/Sora in this phase;
 * future providers later) must implement. Nothing is exported here except this
 * documentation — concrete providers live in sibling files and are selected via
 * providerRegistry.js.
 *
 * async createGenerationJob({ prompt, negativePrompt, aspectRatio, durationSeconds, model, inputImageBuffer, inputImageMimeType })
 *   Kicks off a remote render. Returns { providerJobId, status, estimatedCost }
 *   where status is one of "queued" | "processing".
 *
 * async getGenerationJobStatus(providerJobId)
 *   Polls the remote job. Returns { status, progress, errorCode, errorMessage }
 *   where status is normalized to one of "queued" | "processing" | "completed" | "failed".
 *
 * async cancelGenerationJob(providerJobId)
 *   Best-effort cancellation. Returns { cancelled: boolean, note? }.
 *
 * async downloadGenerationOutput(providerJobId)
 *   Fetches the finished render. Returns { buffer: Buffer, mimeType: string }.
 */

module.exports = {};
