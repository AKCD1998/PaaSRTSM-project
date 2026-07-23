"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getSalesProgress,
  SALES_NET_SCOPE,
  SALES_NET_AMOUNT,
} = require("./salesTargets");

// Exact Crystal {@nTotal} rule: signed detail FCSdtNet minus its three allocated
// discount fields. Both refund statuses remain in scope; DocType 9 subtracts.

test("net scope includes both sale and return documents, paid only", () => {
  assert.match(SALES_NET_SCOPE, /IN \('1', '9'\)/);
  assert.match(SALES_NET_SCOPE, /'3'/); // FTShdStaPaid = 3
});

test("net scope no longer filters on refund status (keeps refunded originals)", () => {
  assert.doesNotMatch(SALES_NET_SCOPE, /FTShdStaRefund/);
});

test("net amount adds sales and subtracts DocType 9 returns", () => {
  assert.match(SALES_NET_AMOUNT, /WHEN .* = '9' THEN -1 ELSE 1/);
  assert.match(SALES_NET_AMOUNT, /sl\.line_amount/);
  assert.match(SALES_NET_AMOUNT, /FCSdtDisAvg/);
  assert.match(SALES_NET_AMOUNT, /FCSdtFootAvg/);
  assert.match(SALES_NET_AMOUNT, /FCSdtRePackAvg/);
});

// Fake pg pool: routes each query by its SQL text and records the actual-sum SQL.
function fakeDb({ totalActual, dailyRows }) {
  const captured = { actualSql: null };
  return {
    captured,
    async query(sql) {
      if (/branch_sales_targets/.test(sql)) {
        return { rows: [] }; // no targets configured
      }
      if (/GROUP BY (?:sh\.)?doc_date/.test(sql)) {
        return { rows: dailyRows };
      }
      captured.actualSql = sql; // the month-to-date total
      return { rows: [{ actual: totalActual }] };
    },
  };
}

test("getSalesProgress returns the signed net total and issues the corrected SQL", async () => {
  const db = fakeDb({
    totalActual: 494445, // 494,197 sales + 1,931 refunded originals − 1,683 returns
    dailyRows: [{ doc_date: "2026-07-15", actual: 36100 }],
  });

  const result = await getSalesProgress({ db, branchCode: "005", month: "2026-07", asOfDate: "2026-07-22" });

  assert.equal(result.actualSoFar, 494445);
  assert.equal(result.branchCode, "005");
  // The month-to-date query must use the signed sale/return expression and scope,
  // and must NOT restrict to a single refund status.
  assert.match(db.captured.actualSql, /CASE WHEN .* = '9' THEN -1 ELSE 1/);
  assert.match(db.captured.actualSql, /JOIN ada\.sales_lines sl/);
  assert.match(db.captured.actualSql, /FCSdtDisAvg/);
  assert.match(db.captured.actualSql, /IN \('1', '9'\)/);
  assert.doesNotMatch(db.captured.actualSql, /FTShdStaRefund/);
});
