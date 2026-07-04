"use strict";

// Since we're deliberately not building an R2/S3 adapter yet, generated videos
// (and uploaded input images) sit on the backend's local disk indefinitely unless
// something cleans them up — this is that something. It's a periodic sweep, not a
// per-file expiry: assets past the retention window get their bytes deleted from
// disk, but the DB row (and job history) stays, so past jobs remain visible with a
// clear "file was auto-removed" state instead of just vanishing without a trace.

const BATCH_LIMIT = 200;

function logInfo(logger, message) {
  if (typeof logger.log === "function") logger.log(message);
}

function logError(logger, message) {
  if (typeof logger.error === "function") {
    logger.error(message);
  } else if (typeof logger.log === "function") {
    logger.log(message);
  }
}

// Only purges assets NOT referenced by a still-active job (draft/queued/processing)
// so a retry never fails trying to re-read an input image that got swept out from
// under it. Terminal jobs (completed/failed/cancelled/approved/rejected) are fair
// game once past the retention window regardless of whether anyone downloaded them.
async function findPurgeCandidates(db, cutoffIso) {
  const result = await db.query(
    `SELECT a.asset_id, a.storage_key
     FROM content.video_assets a
     WHERE a.storage_provider = 'local'
       AND a.storage_key <> ''
       AND a.created_at < $1
       AND NOT EXISTS (
         SELECT 1 FROM content.video_jobs j
         WHERE (j.input_asset_id = a.asset_id OR j.output_asset_id = a.asset_id)
           AND j.status IN ('draft', 'queued', 'processing')
       )
     ORDER BY a.created_at ASC
     LIMIT $2`,
    [cutoffIso, BATCH_LIMIT],
  );
  return result.rows;
}

async function markAssetPurged(db, assetId) {
  await db.query(`UPDATE content.video_assets SET storage_key = '' WHERE asset_id = $1`, [assetId]);
}

async function recordPurgeEvents(db, assetId) {
  const jobsResult = await db.query(
    `SELECT job_id FROM content.video_jobs WHERE input_asset_id = $1 OR output_asset_id = $1`,
    [assetId],
  );
  for (const job of jobsResult.rows) {
    await db.query(
      `INSERT INTO content.video_job_events (video_job_id, event_type, message, payload_json)
       VALUES ($1, 'asset_purged', $2, $3::jsonb)`,
      [
        job.job_id,
        "Local video file was automatically deleted after the retention window to save disk space.",
        JSON.stringify({ assetId }),
      ],
    );
  }
}

async function purgeStaleLocalAssets({ db, storageProvider, config, logger = console }) {
  const retentionDays = Number(config.videoLocalAssetRetentionDays) || 3;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const candidates = await findPurgeCandidates(db, cutoff);
  let purgedCount = 0;

  for (const candidate of candidates) {
    try {
      await storageProvider.deleteAsset({ key: candidate.storage_key });
      await markAssetPurged(db, candidate.asset_id);
      await recordPurgeEvents(db, candidate.asset_id);
      purgedCount += 1;
    } catch (error) {
      logError(logger, `[video-asset-cleanup] failed to purge asset_id=${candidate.asset_id}: ${error.message}`);
    }
  }

  if (purgedCount > 0) {
    logInfo(logger, `[video-asset-cleanup] purged ${purgedCount} stale local video asset(s) older than ${retentionDays}d`);
  }

  return { purgedCount, candidateCount: candidates.length };
}

function startAssetCleanupSchedule({ db, storageProvider, config, logger = console }) {
  const intervalMs = Number(config.videoAssetCleanupIntervalMs) || 0;
  if (!config.featureVideoStudio || String(config.videoStorageProvider || "local").toLowerCase() !== "local" || intervalMs <= 0) {
    return null;
  }

  const timer = setInterval(() => {
    purgeStaleLocalAssets({ db, storageProvider, config, logger }).catch((error) => {
      logError(logger, `[video-asset-cleanup] run failed: ${error.message}`);
    });
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return timer;
}

module.exports = {
  purgeStaleLocalAssets,
  startAssetCleanupSchedule,
};
