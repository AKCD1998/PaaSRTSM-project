"use strict";

const BATCH_LIMIT = 100;
function safeLog(logger, level, message) { const fn = logger?.[level] || logger?.log; if (typeof fn === "function") fn.call(logger, message); }

async function cleanupPreorderAttachments({ db, storageProvider, config, logger = console }) {
  if (!config.featureCustomerPreorders || !storageProvider) return { candidateCount: 0, deletedCount: 0, failedCount: 0 };
  const ageMinutes = Math.max(1, Number(config.preorderPendingUploadMaxAgeMinutes) || 60);
  const sources = [
    { table: "preorder_attachments", id: "attachment_id" },
    { table: "preorder_hq_receipt_photos", id: "photo_id" },
  ];
  let deletedCount = 0; let failedCount = 0;
  let candidateCount = 0;
  for (const source of sources) {
    const result = await db.query(`SELECT ${source.id} AS object_id,object_key FROM customer_relations.${source.table} WHERE upload_state IN ('pending','cleanup_pending') AND COALESCE(cleanup_after,created_at + ($1::text || ' minutes')::interval)<=now() ORDER BY created_at LIMIT $2`, [ageMinutes, BATCH_LIMIT]);
    candidateCount += result.rows.length;
    for (const row of result.rows) {
      try {
        await storageProvider.deleteObject(row.object_key);
        await db.query(`UPDATE customer_relations.${source.table} SET upload_state='deleted',cleanup_after=NULL WHERE ${source.id}=$1 AND upload_state IN ('pending','cleanup_pending')`, [row.object_id]);
        deletedCount += 1;
      } catch (error) {
        failedCount += 1;
        await db.query(`UPDATE customer_relations.${source.table} SET upload_state='cleanup_pending',cleanup_after=now()+interval '15 minutes' WHERE ${source.id}=$1`, [row.object_id]).catch(() => {});
        safeLog(logger, "error", `[preorder-attachment-cleanup] delete failed object_id=${row.object_id}: ${error.message}`);
      }
    }
  }
  if (deletedCount) safeLog(logger, "log", `[preorder-attachment-cleanup] deleted ${deletedCount} abandoned object(s)`);
  return { candidateCount, deletedCount, failedCount };
}

function startPreorderAttachmentCleanupSchedule({ db, storageProvider, config, logger = console }) {
  const intervalMs = Number(config.preorderAttachmentCleanupIntervalMs) || 0;
  if (!config.featureCustomerPreorders || !storageProvider || intervalMs <= 0) return null;
  const run = () => cleanupPreorderAttachments({ db, storageProvider, config, logger }).catch((error) => safeLog(logger, "error", `[preorder-attachment-cleanup] run failed: ${error.message}`));
  const timer = setInterval(run, intervalMs); if (typeof timer.unref === "function") timer.unref(); return timer;
}
module.exports = { BATCH_LIMIT, cleanupPreorderAttachments, startPreorderAttachmentCleanupSchedule };
