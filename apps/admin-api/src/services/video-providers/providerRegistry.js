"use strict";

const { createMockVideoProvider } = require("./mockVideoProvider");
const { createOpenAiVideoProvider } = require("./openaiVideoProvider");

function createHttpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function getVideoProvider(name, config) {
  const normalized = String(name || "").trim().toLowerCase();
  const enabled = config.videoProviderEnabled instanceof Set ? config.videoProviderEnabled : new Set();
  if (!enabled.has(normalized)) {
    throw createHttpError(`Video provider "${name}" is not enabled`, 400);
  }
  if (normalized === "mock") {
    return createMockVideoProvider(config);
  }
  if (normalized === "openai") {
    return createOpenAiVideoProvider(config);
  }
  throw createHttpError(`Video provider "${name}" is not implemented`, 400);
}

module.exports = {
  getVideoProvider,
};
