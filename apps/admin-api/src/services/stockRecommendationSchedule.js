"use strict";

// Regenerates ordering.stock_recommendation_snapshots on a schedule so the
// admin-web/order-web recommendation UI reads precomputed rows instead of
// falling back to the ~10-40s live computation on every request. This only
// needs DATABASE_URL — it has no dependency on branch hardware or the ADAPOS
// sync agent beyond expecting that morning's sync to have already landed.

const cron = require("node-cron");
const { refreshStockRecommendationSnapshots } = require("./stockRecommendations");

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

async function runStockRecommendationRefresh({ db, config, logger = console }) {
  const targetDaysList =
    Array.isArray(config.stockRecommendationCronTargetDays) && config.stockRecommendationCronTargetDays.length > 0
      ? config.stockRecommendationCronTargetDays
      : [90];

  const results = [];
  for (const targetDays of targetDaysList) {
    // eslint-disable-next-line no-await-in-loop
    const result = await refreshStockRecommendationSnapshots(db, { targetDays });
    results.push(result);
    logInfo(
      logger,
      `[stock-recommendation-cron] refreshed targetDays=${targetDays} anchorDate=${result.anchorDate} rows=${result.rowCount}`,
    );
  }
  return results;
}

function startStockRecommendationSchedule({ db, config, logger = console }) {
  if (!config.featureStockRecommendationCron) {
    return null;
  }

  if (!cron.validate(config.stockRecommendationCronExpression)) {
    logError(
      logger,
      `[stock-recommendation-cron] invalid STOCK_RECOMMENDATION_CRON_EXPRESSION "${config.stockRecommendationCronExpression}" — schedule not started`,
    );
    return null;
  }

  const task = cron.schedule(
    config.stockRecommendationCronExpression,
    () => {
      runStockRecommendationRefresh({ db, config, logger }).catch((error) => {
        logError(logger, `[stock-recommendation-cron] run failed: ${error.message}`);
      });
    },
    { timezone: config.stockRecommendationCronTimezone },
  );

  logInfo(
    logger,
    `[stock-recommendation-cron] scheduled "${config.stockRecommendationCronExpression}" (${config.stockRecommendationCronTimezone}), targetDays=${JSON.stringify(config.stockRecommendationCronTargetDays)}`,
  );

  return task;
}

module.exports = {
  runStockRecommendationRefresh,
  startStockRecommendationSchedule,
};
