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
function fakeDb({ totalActual, dailyRows, targetRows = [] }) {
  const captured = { actualSql: null };
  return {
    captured,
    async query(sql) {
      if (/branch_sales_targets/.test(sql)) {
        return { rows: targetRows };
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

test("remaining daily average follows Excel and includes the as-of date", async () => {
  const db = fakeDb({
    totalActual: 1318741,
    dailyRows: [],
    targetRows: [{
      tier: 1,
      monthly_target: 1627500,
      updated_at: null,
      updated_by: null,
    }],
  });

  const result = await getSalesProgress({
    db,
    branchCode: "003",
    month: "2026-07",
    asOfDate: "2026-07-24",
  });

  assert.equal(result.daysElapsed, 24);
  assert.equal(result.daysRemaining, 8); // July 24..31, inclusive
  assert.equal(result.tiers[0].remainingAmount, 308759);
  assert.equal(result.tiers[0].remainingAvgPerDay, 38594.875);
});

test("inclusive remaining-day count works for 28, 29, 30, and 31-day months", async () => {
  const cases = [
    { month: "2026-02", asOfDate: "2026-02-01", totalDays: 28, daysRemaining: 28 },
    { month: "2026-02", asOfDate: "2026-02-28", totalDays: 28, daysRemaining: 1 },
    { month: "2028-02", asOfDate: "2028-02-29", totalDays: 29, daysRemaining: 1 },
    { month: "2026-04", asOfDate: "2026-04-30", totalDays: 30, daysRemaining: 1 },
    { month: "2026-07", asOfDate: "2026-07-31", totalDays: 31, daysRemaining: 1 },
  ];

  for (const testCase of cases) {
    const db = fakeDb({ totalActual: 0, dailyRows: [] });
    // eslint-disable-next-line no-await-in-loop
    const result = await getSalesProgress({
      db,
      branchCode: "003",
      month: testCase.month,
      asOfDate: testCase.asOfDate,
    });
    assert.equal(result.totalDaysInMonth, testCase.totalDays, testCase.asOfDate);
    assert.equal(result.daysRemaining, testCase.daysRemaining, testCase.asOfDate);
  }
});
