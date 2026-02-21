"use strict";

const crypto = require("crypto");

const SUPPORTED_PROVIDERS = new Set(["openai", "local", "mock"]);
const MODEL_DIMENSIONS = Object.freeze({
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
});

function parsePositiveInt(value, fallback = null) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function normalizeProvider(value) {
  const provider = String(value || "mock")
    .trim()
    .toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported EMBEDDING_PROVIDER: ${provider}`);
  }
  return provider;
}

function inferEmbeddingDimension(model) {
  return MODEL_DIMENSIONS[String(model || "").trim()] || null;
}

function normalizeModel(provider, value) {
  const model = String(value || "").trim();
  if (model) {
    return model;
  }
  if (provider === "openai") {
    return "text-embedding-3-small";
  }
  if (provider === "local") {
    return "local-embedding-model";
  }
  return "mock-embedding-model";
}

function resolveEmbeddingSettings(input = {}, env = process.env) {
  const provider = normalizeProvider(input.embeddingProvider || env.EMBEDDING_PROVIDER || "mock");
  const model = normalizeModel(provider, input.embeddingModel || env.EMBEDDING_MODEL || "");
  const configuredDimension = parsePositiveInt(
    input.embeddingDimension != null ? input.embeddingDimension : env.EMBEDDING_DIM,
    null,
  );
  const inferredDimension = inferEmbeddingDimension(model);
  const dimension = configuredDimension || inferredDimension || (provider === "mock" ? 1536 : null);
  if (!dimension) {
    throw new Error(
      `Embedding dimension is unknown for model "${model}". Set EMBEDDING_DIM to match the model output.`,
    );
  }

  return {
    provider,
    model,
    dimension,
    timeoutMs: parsePositiveInt(input.embeddingTimeoutMs || env.EMBEDDING_TIMEOUT_MS, 30_000),
    openaiApiKey: input.openaiApiKey || env.OPENAI_API_KEY || "",
    openaiBaseUrl: String(input.openaiBaseUrl || env.OPENAI_BASE_URL || "https://api.openai.com/v1")
      .trim()
      .replace(/\/+$/g, ""),
    localEmbeddingUrl: String(input.localEmbeddingUrl || env.EMBEDDING_LOCAL_URL || "")
      .trim()
      .replace(/\/+$/g, ""),
  };
}

function assertEmbeddingVector(vector, expectedDim) {
  if (!Array.isArray(vector)) {
    throw new Error("Embedding provider returned non-array vector");
  }
  if (vector.length !== expectedDim) {
    throw new Error(`Embedding vector length mismatch: expected ${expectedDim}, got ${vector.length}`);
  }
  for (let i = 0; i < vector.length; i += 1) {
    const value = Number(vector[i]);
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding vector has non-finite value at index ${i}`);
    }
  }
}

function normalizeVector(vector) {
  return vector.map((value) => Number(value));
}

function generateMockEmbedding(text, dimension) {
  const seed = String(text == null ? "" : text);
  const values = [];
  let round = 0;
  let bytes = Buffer.alloc(0);
  let cursor = 0;

  while (values.length < dimension) {
    if (cursor + 4 > bytes.length) {
      bytes = crypto
        .createHash("sha256")
        .update(`${seed}:${round}`)
        .digest();
      round += 1;
      cursor = 0;
    }

    const intValue = bytes.readInt32BE(cursor);
    cursor += 4;
    values.push(intValue / 2147483647);
  }

  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => Number((value / magnitude).toFixed(10)));
}

async function requestEmbeddingJson(url, body, headers, timeoutMs) {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available in this Node runtime");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      throw new Error(`Embedding provider returned invalid JSON (${error.message})`);
    }

    if (!response.ok) {
      const message = String(payload?.error?.message || payload?.message || response.statusText || "request_failed");
      throw new Error(`Embedding provider request failed (${response.status}): ${message}`);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function extractEmbeddingFromPayload(payload) {
  if (Array.isArray(payload?.embedding)) {
    return payload.embedding;
  }
  if (Array.isArray(payload?.data) && Array.isArray(payload.data[0]?.embedding)) {
    return payload.data[0].embedding;
  }
  return null;
}

function createOpenAIProvider(settings) {
  if (!settings.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");
  }

  return {
    name: "openai",
    model: settings.model,
    dimension: settings.dimension,
    async embed(inputText) {
      const payload = await requestEmbeddingJson(
        `${settings.openaiBaseUrl}/embeddings`,
        {
          model: settings.model,
          input: inputText,
        },
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.openaiApiKey}`,
        },
        settings.timeoutMs,
      );
      const embedding = extractEmbeddingFromPayload(payload);
      assertEmbeddingVector(embedding, settings.dimension);
      return normalizeVector(embedding);
    },
  };
}

function createLocalProvider(settings) {
  if (!settings.localEmbeddingUrl) {
    throw new Error("EMBEDDING_LOCAL_URL is required when EMBEDDING_PROVIDER=local");
  }

  return {
    name: "local",
    model: settings.model,
    dimension: settings.dimension,
    async embed(inputText) {
      const payload = await requestEmbeddingJson(
        settings.localEmbeddingUrl,
        {
          model: settings.model,
          input: inputText,
        },
        {
          "Content-Type": "application/json",
        },
        settings.timeoutMs,
      );
      const embedding = extractEmbeddingFromPayload(payload);
      assertEmbeddingVector(embedding, settings.dimension);
      return normalizeVector(embedding);
    },
  };
}

function createMockProvider(settings) {
  return {
    name: "mock",
    model: settings.model,
    dimension: settings.dimension,
    async embed(inputText) {
      const embedding = generateMockEmbedding(inputText, settings.dimension);
      assertEmbeddingVector(embedding, settings.dimension);
      return embedding;
    },
  };
}

function createEmbeddingProvider(settings) {
  if (!settings || typeof settings !== "object") {
    throw new Error("Embedding settings are required");
  }
  if (settings.provider === "openai") {
    return createOpenAIProvider(settings);
  }
  if (settings.provider === "local") {
    return createLocalProvider(settings);
  }
  return createMockProvider(settings);
}

module.exports = {
  SUPPORTED_PROVIDERS,
  MODEL_DIMENSIONS,
  inferEmbeddingDimension,
  resolveEmbeddingSettings,
  assertEmbeddingVector,
  generateMockEmbedding,
  createEmbeddingProvider,
};
