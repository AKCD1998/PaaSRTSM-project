"use strict";

function mapDerivationRows(rows) {
  return rows.map((row) => ({
    stage: row.stage,
    affectedRows: Number(row.affected_rows || 0),
  }));
}

async function runAdaFoundationDerivation(db) {
  const result = await db.query(
    `
      SELECT stage, affected_rows
      FROM ada.refresh_foundations()
    `,
  );

  return mapDerivationRows(result.rows);
}

async function runAdaAnalyticsDerivation(db, periodDays = 30) {
  const result = await db.query(
    `
      SELECT stage, affected_rows
      FROM ada.refresh_analytics($1)
    `,
    [periodDays],
  );

  return mapDerivationRows(result.rows);
}

async function runAdaStandardAnalyticsDerivation(db) {
  const result = await db.query(
    `
      SELECT stage, affected_rows
      FROM ada.refresh_analytics_standard_windows()
    `,
  );

  return mapDerivationRows(result.rows);
}

async function runAdaTransferReconciliationDerivation(db) {
  const result = await db.query(
    `
      SELECT stage, affected_rows
      FROM reconciliation.refresh_transfer_derivations()
    `,
  );

  return mapDerivationRows(result.rows);
}

module.exports = {
  runAdaFoundationDerivation,
  runAdaAnalyticsDerivation,
  runAdaStandardAnalyticsDerivation,
  runAdaTransferReconciliationDerivation,
};
