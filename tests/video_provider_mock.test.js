"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMockVideoProvider } = require("../apps/admin-api/src/services/video-providers/mockVideoProvider");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("mock provider transitions queued -> processing -> completed and downloads a valid mp4 buffer", async () => {
  const provider = createMockVideoProvider({
    videoMockTimingMs: { queuedMs: 20, processingMs: 50 },
  });

  const created = await provider.createGenerationJob({
    prompt: "a cat playing piano",
    aspectRatio: "16:9",
    durationSeconds: 4,
    model: "mock-v1",
  });
  assert.equal(created.status, "queued");
  assert.ok(created.providerJobId);
  assert.equal(created.estimatedCost, null);

  const immediateStatus = await provider.getGenerationJobStatus(created.providerJobId);
  assert.equal(immediateStatus.status, "queued");

  await sleep(25);
  const processingStatus = await provider.getGenerationJobStatus(created.providerJobId);
  assert.equal(processingStatus.status, "processing");
  assert.ok(processingStatus.progress >= 0 && processingStatus.progress <= 100);

  await sleep(40);
  const completedStatus = await provider.getGenerationJobStatus(created.providerJobId);
  assert.equal(completedStatus.status, "completed");

  const output = await provider.downloadGenerationOutput(created.providerJobId);
  assert.ok(Buffer.isBuffer(output.buffer));
  assert.ok(output.buffer.length > 0, "expected a non-empty video buffer");
  assert.equal(output.mimeType, "video/mp4");
});

test("mock provider reports failed for an unknown job id", async () => {
  const provider = createMockVideoProvider({});
  const status = await provider.getGenerationJobStatus("does-not-exist");
  assert.equal(status.status, "failed");
  assert.equal(status.errorCode, "unknown_job");
});

test("mock provider cancelGenerationJob removes the job from its in-memory map", async () => {
  const provider = createMockVideoProvider({ videoMockTimingMs: { queuedMs: 1000, processingMs: 2000 } });
  const created = await provider.createGenerationJob({ prompt: "x", aspectRatio: "1:1", durationSeconds: 4, model: "mock-v1" });
  const cancelResult = await provider.cancelGenerationJob(created.providerJobId);
  assert.equal(cancelResult.cancelled, true);
  const status = await provider.getGenerationJobStatus(created.providerJobId);
  assert.equal(status.status, "failed");
  assert.equal(status.errorCode, "unknown_job");
});
