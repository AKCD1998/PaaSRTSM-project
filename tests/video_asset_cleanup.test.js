"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { purgeStaleLocalAssets } = require("../apps/admin-api/src/services/videoAssetCleanup");

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function createMockDb(state) {
  function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  }

  async function query(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith("select a.asset_id, a.storage_key from content.video_assets a")) {
      const cutoff = new Date(params[0]);
      const activeStatuses = new Set(["draft", "queued", "processing"]);
      const rows = state.assets.filter((asset) => {
        if (asset.storage_provider !== "local" || !asset.storage_key) return false;
        if (new Date(asset.created_at) >= cutoff) return false;
        const referencedByActiveJob = state.jobs.some(
          (job) =>
            (job.input_asset_id === asset.asset_id || job.output_asset_id === asset.asset_id) &&
            activeStatuses.has(job.status),
        );
        return !referencedByActiveJob;
      });
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith("update content.video_assets set storage_key = ''")) {
      const asset = state.assets.find((item) => item.asset_id === params[0]);
      if (asset) asset.storage_key = "";
      return { rowCount: asset ? 1 : 0, rows: [] };
    }

    if (normalized.startsWith("select job_id from content.video_jobs where input_asset_id = $1 or output_asset_id = $1")) {
      const rows = state.jobs
        .filter((job) => job.input_asset_id === params[0] || job.output_asset_id === params[0])
        .map((job) => ({ job_id: job.job_id }));
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith("insert into content.video_job_events")) {
      state.events.push({ jobId: params[0], eventType: "asset_purged", message: params[1] });
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unhandled mock query: ${normalized}`);
  }

  return { query };
}

function createMockStorageProvider(deletedKeys) {
  return {
    async deleteAsset({ key }) {
      deletedKeys.push(key);
    },
  };
}

test("purgeStaleLocalAssets deletes only assets past retention that aren't tied to an active job", async () => {
  const state = {
    assets: [
      { asset_id: 1, storage_key: "content/generated_video/old.mp4", storage_provider: "local", created_at: daysAgoIso(10) },
      { asset_id: 2, storage_key: "content/generated_video/recent.mp4", storage_provider: "local", created_at: daysAgoIso(1) },
      { asset_id: 3, storage_key: "content/input_image/old-but-active.png", storage_provider: "local", created_at: daysAgoIso(10) },
    ],
    jobs: [
      { job_id: 100, input_asset_id: null, output_asset_id: 1, status: "completed" },
      { job_id: 101, input_asset_id: 3, output_asset_id: null, status: "queued" }, // still active, must be skipped
    ],
    events: [],
  };
  const deletedKeys = [];
  const db = createMockDb(state);
  const storageProvider = createMockStorageProvider(deletedKeys);
  const config = { videoLocalAssetRetentionDays: 3 };

  const result = await purgeStaleLocalAssets({ db, storageProvider, config, logger: { log() {}, error() {} } });

  assert.equal(result.purgedCount, 1);
  assert.deepEqual(deletedKeys, ["content/generated_video/old.mp4"]);

  const purged = state.assets.find((a) => a.asset_id === 1);
  assert.equal(purged.storage_key, "");

  const stillActive = state.assets.find((a) => a.asset_id === 3);
  assert.equal(stillActive.storage_key, "content/input_image/old-but-active.png");

  const stillRecent = state.assets.find((a) => a.asset_id === 2);
  assert.equal(stillRecent.storage_key, "content/generated_video/recent.mp4");

  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].jobId, 100);
  assert.equal(state.events[0].eventType, "asset_purged");
});

test("purgeStaleLocalAssets is a no-op when nothing is past retention", async () => {
  const state = {
    assets: [{ asset_id: 1, storage_key: "content/x.mp4", storage_provider: "local", created_at: daysAgoIso(1) }],
    jobs: [],
    events: [],
  };
  const deletedKeys = [];
  const db = createMockDb(state);
  const storageProvider = createMockStorageProvider(deletedKeys);

  const result = await purgeStaleLocalAssets({
    db,
    storageProvider,
    config: { videoLocalAssetRetentionDays: 3 },
    logger: { log() {}, error() {} },
  });

  assert.equal(result.purgedCount, 0);
  assert.equal(deletedKeys.length, 0);
});
