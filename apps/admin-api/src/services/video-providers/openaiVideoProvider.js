"use strict";

// IMPORTANT: OpenAI has stated the Sora 2 Videos API is deprecated and scheduled
// to shut down 2026-09-24. Re-verify this adapter against current docs
// (https://platform.openai.com/docs/guides/video-generation) before that date.

const { ASPECT_RATIO_TO_OPENAI_SIZE, OPENAI_PRICE_PER_SECOND_USD } = require("./videoStudioConstants");

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function createHttpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function resolveApiKey(config) {
  return config?.videoProviderApiKey || process.env.OPENAI_API_KEY || "";
}

function resolveSize(aspectRatio, model) {
  const entry = ASPECT_RATIO_TO_OPENAI_SIZE[aspectRatio];
  if (!entry) {
    throw createHttpError(`Unsupported aspect ratio for openai provider: ${aspectRatio}`, 400);
  }
  return model === "sora-2-pro" ? entry.pro : entry.default;
}

// Estimate USD cost from OpenAI's published per-second pricing (see
// videoStudioConstants.js) — this is a cost *estimate* computed from the request
// parameters, not a real billed amount reported by the API (OpenAI's Videos API
// does not return usage/cost data). Returns null if the size isn't in the pricing
// table rather than guessing, per the "never assume cost" rule.
function estimateCostUsd(model, size, durationSeconds) {
  const pricePerSecond = OPENAI_PRICE_PER_SECOND_USD[model]?.[size];
  if (typeof pricePerSecond !== "number" || !Number.isFinite(Number(durationSeconds))) {
    return null;
  }
  return Number((pricePerSecond * Number(durationSeconds)).toFixed(4));
}

function normalizeStatus(rawStatus) {
  const status = String(rawStatus || "").toLowerCase();
  if (status === "in_progress") return "processing";
  if (status === "queued") return "queued";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  // Default unrecognized states to "processing" rather than erroring the poll loop.
  return "processing";
}

async function readErrorBody(response) {
  try {
    const body = await response.text();
    return body.slice(0, 500);
  } catch (_error) {
    return "";
  }
}

function createOpenAiVideoProvider(config) {
  const fetchImpl = config?.fetchImpl || global.fetch;

  function requireApiKey() {
    const apiKey = resolveApiKey(config);
    if (!apiKey) {
      throw createHttpError(
        "OpenAI video provider is not configured: set VIDEO_PROVIDER_API_KEY or OPENAI_API_KEY",
        503,
      );
    }
    return apiKey;
  }

  return {
    async createGenerationJob({
      prompt,
      model,
      aspectRatio,
      durationSeconds,
      inputImageBuffer,
      inputImageMimeType,
    }) {
      const apiKey = requireApiKey();
      const size = resolveSize(aspectRatio, model);

      let response;
      if (inputImageBuffer) {
        const form = new FormData();
        form.set("prompt", prompt);
        form.set("model", model);
        form.set("size", size);
        form.set("seconds", String(durationSeconds));
        form.set(
          "input_reference",
          new Blob([inputImageBuffer], { type: inputImageMimeType || "image/png" }),
          "input_reference",
        );
        response = await fetchImpl(`${OPENAI_BASE_URL}/videos`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
      } else {
        response = await fetchImpl(`${OPENAI_BASE_URL}/videos`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            model,
            size,
            seconds: durationSeconds,
          }),
        });
      }

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        throw createHttpError(
          `OpenAI video creation failed (${response.status}): ${errorBody}`,
          502,
        );
      }

      const data = await response.json();
      return {
        providerJobId: data.id,
        status: normalizeStatus(data.status),
        estimatedCost: estimateCostUsd(model, size, durationSeconds),
      };
    },

    async getGenerationJobStatus(providerJobId) {
      const apiKey = requireApiKey();
      const response = await fetchImpl(`${OPENAI_BASE_URL}/videos/${encodeURIComponent(providerJobId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        throw createHttpError(
          `OpenAI video status check failed (${response.status}): ${errorBody}`,
          502,
        );
      }

      const data = await response.json();
      const status = normalizeStatus(data.status);
      return {
        status,
        progress: typeof data.progress === "number" ? data.progress : null,
        errorCode: status === "failed" ? data.error?.code || "provider_error" : null,
        errorMessage: status === "failed" ? data.error?.message || null : null,
      };
    },

    // OpenAI's Sora API does not document a cancel endpoint as of this writing.
    // Implement as a no-op rather than inventing an endpoint that may not exist.
    async cancelGenerationJob(_providerJobId) {
      return {
        cancelled: false,
        note: "Provider does not support cancellation; job will be marked cancelled locally but may continue rendering upstream.",
      };
    },

    async downloadGenerationOutput(providerJobId) {
      const apiKey = requireApiKey();
      const response = await fetchImpl(
        `${OPENAI_BASE_URL}/videos/${encodeURIComponent(providerJobId)}/content?variant=video`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        throw createHttpError(
          `OpenAI video download failed (${response.status}): ${errorBody}`,
          502,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), mimeType: "video/mp4" };
    },
  };
}

module.exports = {
  createOpenAiVideoProvider,
  resolveSize,
  normalizeStatus,
  estimateCostUsd,
};
