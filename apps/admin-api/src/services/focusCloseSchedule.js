"use strict";

const { attachProgress } = require("./focusProducts");

async function closeDueFocusProducts(db) {
  const due = await db.query(
    `SELECT * FROM focus.focus_products
     WHERE frozen_at IS NULL AND is_active = TRUE
       AND (publication_status = 'published'
         OR (publication_status = 'scheduled' AND scheduled_publish_at <= now()))
       AND ((date_to + 1) + time '08:30') AT TIME ZONE 'Asia/Bangkok' <= now()`,
  );
  if (!due.rows.length) return 0;
  const branches = await db.query(
    "SELECT branch_code FROM core.branches WHERE is_active = TRUE ORDER BY branch_code ASC",
  );
  const rows = await attachProgress(db, due.rows, branches.rows.map((row) => row.branch_code));
  return rows.filter((row) => row.isFrozen).length;
}

function startFocusCloseSchedule({ db, logger = console, intervalMs = 60000 }) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const count = await closeDueFocusProducts(db);
      if (count) logger.info?.(`[focus-close] frozen=${count} after completed branch sales syncs`);
    } catch (error) {
      logger.warn?.(`[focus-close] deferred: ${error.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run();
  return timer;
}

module.exports = { closeDueFocusProducts, startFocusCloseSchedule };
