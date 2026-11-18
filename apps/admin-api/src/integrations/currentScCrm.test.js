"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createCrmMirrorClient } = require("./currentScCrm");

test("CRM mirror returns parsed success response", async () => {
  const client = createCrmMirrorClient({
    crmMirrorBaseUrl: "https://crm.example.test",
    crmMirrorInternalToken: "test-token",
    crmMirrorTimeoutMs: 100,
  }, async (url, options) => {
    assert.equal(url, "https://crm.example.test/internal/crm/pos/sales");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["x-internal-token"], "test-token");
    assert.equal(options.signal instanceof AbortSignal, true);
    return {
      ok: true,
      async text() {
        return JSON.stringify({ accepted: 1 });
      },
    };
  });

  assert.deepEqual(await client.mirrorSales([{ id: "sale-1" }]), {
    ok: true,
    body: { accepted: 1 },
  });
});

test("CRM mirror timeout remains active while reading the response body", async () => {
  let signal;
  const client = createCrmMirrorClient({
    crmMirrorBaseUrl: "https://crm.example.test",
    crmMirrorInternalToken: "test-token",
    crmMirrorTimeoutMs: 10,
  }, async (_url, options) => {
    signal = options.signal;
    return {
      ok: true,
      text() {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
    };
  });

  await assert.rejects(client.mirrorSales([]), (error) => {
    assert.equal(error.code, "CRM_MIRROR_TIMEOUT");
    assert.match(error.message, /10ms/);
    return true;
  });
  assert.equal(signal.aborted, true);
});
