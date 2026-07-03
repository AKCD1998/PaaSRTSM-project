"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createOpenAiVideoProvider, estimateCostUsd } = require("../apps/admin-api/src/services/video-providers/openaiVideoProvider");

function buildConfig(overrides = {}) {
  return {
    videoProviderApiKey: "test-api-key",
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("createGenerationJob (no image) posts JSON with the correct fields and normalizes status", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: "video_123", status: "queued" });
  };

  const provider = createOpenAiVideoProvider(buildConfig({ fetchImpl }));
  const result = await provider.createGenerationJob({
    prompt: "a dog surfing",
    model: "sora-2",
    aspectRatio: "16:9",
    durationSeconds: 8,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/videos");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-api-key");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.prompt, "a dog surfing");
  assert.equal(body.model, "sora-2");
  assert.equal(body.size, "1280x720");
  assert.equal(body.seconds, "8"); // OpenAI requires this as a string, not a number

  assert.equal(result.providerJobId, "video_123");
  assert.equal(result.status, "queued");
  // sora-2 @ 1280x720 = $0.10/sec * 8s
  assert.equal(result.estimatedCost, 0.8);
});

test("createGenerationJob uses the pro size when model is sora-2-pro", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: "video_456", status: "in_progress" });
  };

  const provider = createOpenAiVideoProvider(buildConfig({ fetchImpl }));
  const result = await provider.createGenerationJob({
    prompt: "a robot dancing",
    model: "sora-2-pro",
    aspectRatio: "9:16",
    durationSeconds: 4,
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.size, "1080x1920");
  assert.equal(result.status, "processing");
  // sora-2-pro @ 1080x1920 = $0.70/sec * 4s
  assert.equal(result.estimatedCost, 2.8);
});

test("estimateCostUsd returns null for an unpriced model/size combination rather than guessing", () => {
  assert.equal(estimateCostUsd("some-future-model", "1280x720", 8), null);
});

test("createGenerationJob sends multipart form data when an input image is present", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: "video_789", status: "queued" });
  };

  const provider = createOpenAiVideoProvider(buildConfig({ fetchImpl }));
  await provider.createGenerationJob({
    prompt: "a product photo turned into a video",
    model: "sora-2",
    aspectRatio: "1:1",
    durationSeconds: 4,
    inputImageBuffer: Buffer.from("fake-image-bytes"),
    inputImageMimeType: "image/png",
  });

  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.headers["Content-Type"], undefined);
});

test("getGenerationJobStatus normalizes in_progress -> processing and completed -> completed", async () => {
  const responses = [
    jsonResponse({ id: "video_1", status: "in_progress", progress: 42 }),
    jsonResponse({ id: "video_1", status: "completed", progress: 100 }),
  ];
  let callIndex = 0;
  const fetchImpl = async () => responses[callIndex++];

  const provider = createOpenAiVideoProvider(buildConfig({ fetchImpl }));

  const processingResult = await provider.getGenerationJobStatus("video_1");
  assert.equal(processingResult.status, "processing");
  assert.equal(processingResult.progress, 42);

  const completedResult = await provider.getGenerationJobStatus("video_1");
  assert.equal(completedResult.status, "completed");
});

test("getGenerationJobStatus normalizes failed and surfaces error details", async () => {
  const fetchImpl = async () =>
    jsonResponse({ id: "video_2", status: "failed", error: { code: "content_policy", message: "blocked" } });

  const provider = createOpenAiVideoProvider(buildConfig({ fetchImpl }));
  const result = await provider.getGenerationJobStatus("video_2");
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "content_policy");
  assert.equal(result.errorMessage, "blocked");
});

test("cancelGenerationJob is a documented no-op", async () => {
  const provider = createOpenAiVideoProvider(buildConfig({ fetchImpl: async () => jsonResponse({}) }));
  const result = await provider.cancelGenerationJob("video_1");
  assert.equal(result.cancelled, false);
  assert.ok(result.note);
});

test("downloadGenerationOutput requests the content endpoint and returns a Buffer", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from("video-bytes").buffer,
    };
  };

  const provider = createOpenAiVideoProvider(buildConfig({ fetchImpl }));
  const result = await provider.downloadGenerationOutput("video_1");

  assert.equal(calls[0].url, "https://api.openai.com/v1/videos/video_1/content?variant=video");
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.mimeType, "video/mp4");
});

test("methods throw a 503 createHttpError when no API key is configured", async () => {
  const provider = createOpenAiVideoProvider({ videoProviderApiKey: "", fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(
    provider.createGenerationJob({ prompt: "x", model: "sora-2", aspectRatio: "1:1", durationSeconds: 4 }),
    (error) => {
      assert.equal(error.statusCode, 503);
      return true;
    },
  );
});
