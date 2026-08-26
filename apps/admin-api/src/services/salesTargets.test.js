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
  const captured = { actualSql: null, actualParams: null, dailyParams: null };
  return {
    captured,
    async query(sql, params) {
      if (/branch_sales_targets/.test(sql)) {
        return { rows: targetRows };
      }
      if (/GROUP BY (?:sh\.)?doc_date/.test(sql)) {
        captured.dailyParams = params;
        return { rows: dailyRows };
      }
      captured.actualSql = sql; // the month-to-date total
      captured.actualParams = params;
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

test("morning progress divides actuals through yesterday but plans from Bangkok today", async () => {
  const db = fakeDb({
    totalActual: 2500,
    dailyRows: [{ doc_date: "2026-08-25", actual: 100 }],
    targetRows: [{
      tier: 1,
      monthly_target: 3100,
      updated_at: null,
      updated_by: null,
    }],
  });

  // 18:00Z on August 25 is 01:00 on August 26 in Bangkok.
  const result = await getSalesProgress({
    db,
    branchCode: "004",
    month: "2026-08",
    now: new Date("2026-08-25T18:00:00.000Z"),
  });

  assert.equal(result.asOfDate, "2026-08-25");
  assert.equal(result.dataThroughDate, "2026-08-25");
  assert.equal(result.planningDate, "2026-08-26");
  assert.equal(result.daysElapsed, 25);
  assert.equal(result.daysRemaining, 6);
  assert.equal(result.tiers[0].actualAvgPerDay, 100);
  assert.equal(result.tiers[0].remainingAvgPerDay, 100);
  assert.equal(result.dailyActuals.at(-1).date, "2026-08-25");
  assert.deepEqual(db.captured.actualParams, ["004", "2026-08-01", "2026-08-25"]);
  assert.deepEqual(db.captured.dailyParams, ["004", "2026-08-01", "2026-08-25"]);
});

test("first day of a month has no completed actual day but all planning days remain", async () => {
  const db = fakeDb({ totalActual: 0, dailyRows: [] });

  const result = await getSalesProgress({
    db,
    branchCode: "004",
    month: "2026-08",
    now: new Date("2026-07-31T18:00:00.000Z"),
  });

  assert.equal(result.dataThroughDate, null);
  assert.equal(result.planningDate, "2026-08-01");
  assert.equal(result.daysElapsed, 0);
  assert.equal(result.daysRemaining, 31);
  assert.deepEqual(result.dailyActuals, []);
  assert.deepEqual(db.captured.actualParams, ["004", "2026-08-01", null]);
});

test("a historical month uses its full data range and has no planning days remaining", async () => {
  const db = fakeDb({ totalActual: 3100, dailyRows: [] });

  const result = await getSalesProgress({
    db,
    branchCode: "004",
    month: "2026-07",
    now: new Date("2026-08-25T18:00:00.000Z"),
  });

  assert.equal(result.dataThroughDate, "2026-07-31");
  assert.equal(result.planningDate, "2026-08-26");
  assert.equal(result.daysElapsed, 31);
  assert.equal(result.daysRemaining, 0);
});
