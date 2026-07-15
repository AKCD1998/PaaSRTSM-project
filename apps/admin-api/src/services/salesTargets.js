"use strict";

// Monthly sales-target tracking, 3 escalating tiers per branch per month.
// Targets are admin-set and stored (ordering.branch_sales_targets, rarely
// changes). Everything else — month-to-date actual, daily pacing, remaining
// amount — is computed live from ada.sales_headers on every read, never
// cached, so it's always as current as the last successful branch sync.
//
// The "actual sales" filter below was verified against real production data
// for all 4 storefront branches on 2026-07-14 (exact match to POS-reported
// daily totals): a sale counts only if it's a normal sale document
// (FTShdDocType='1'), fully paid (FTShdStaPaid='3'), and not a refund
// (FTShdStaRefund='1'). Note: apps/admin-api/src/routes/movement-analytics.js
// uses a very similar filter but omits the FTShdStaRefund check — that's a
// known small inaccuracy there (it would have overcounted branch 001 by ~70
// on the date this was verified), out of scope to fix here, flagged in
// docs/sync-program for follow-up.
const ACTUAL_SALES_FILTER = `
  COALESCE(NULLIF(raw_payload->>'FTShdDocType', ''), '1') = '1'
  AND COALESCE(NULLIF(raw_payload->>'FTShdStaPaid', ''), paid_status, '') = '3'
  AND COALESCE(NULLIF(raw_payload->>'FTShdStaRefund', ''), '1') = '1'
`;

const TIERS = [1, 2, 3];

function normalizeMonth(monthInput) {
  // Accepts "2026-07" or "2026-07-01" or a Date; always returns the 1st of
  // the month as YYYY-MM-DD, since target_month is a normalized anchor, not
  // a real "as of" date.
  const raw = monthInput ? String(monthInput) : new Date().toISOString().slice(0, 10);
  const [year, month] = raw.split("-");
  if (!year || !month) {
    throw new Error(`Invalid month "${monthInput}" — expected YYYY-MM or YYYY-MM-DD.`);
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function daysInMonth(monthStartIso) {
  const d = new Date(monthStartIso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

async function listSalesTargets({ db, branchCode, month }) {
  const monthStart = normalizeMonth(month);
  const result = await db.query(
    `
      SELECT tier, monthly_target, updated_at, updated_by
      FROM ordering.branch_sales_targets
      WHERE branch_code = $1 AND target_month = $2::date
      ORDER BY tier
    `,
    [branchCode, monthStart],
  );
  const byTier = new Map(result.rows.map((r) => [r.tier, r]));
  return {
    branchCode,
    month: monthStart,
    tiers: TIERS.map((tier) => ({
      tier,
      monthlyTarget: byTier.has(tier) ? Number(byTier.get(tier).monthly_target) : null,
      updatedAt: byTier.get(tier)?.updated_at ?? null,
      updatedBy: byTier.get(tier)?.updated_by ?? null,
    })),
  };
}

async function upsertSalesTargets({ db, branchCode, month, tiers, actor }) {
  const monthStart = normalizeMonth(month);
  const cleaned = (tiers || [])
    .map((t) => ({ tier: Number(t.tier), monthlyTarget: Number(t.monthlyTarget) }))
    .filter((t) => TIERS.includes(t.tier) && Number.isFinite(t.monthlyTarget) && t.monthlyTarget >= 0);

  if (cleaned.length === 0) {
    throw new Error("At least one valid tier (1-3) with a non-negative monthlyTarget is required.");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const t of cleaned) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `
          INSERT INTO ordering.branch_sales_targets
            (branch_code, target_month, tier, monthly_target, created_by, updated_by)
          VALUES ($1, $2::date, $3, $4, $5, $5)
          ON CONFLICT (branch_code, target_month, tier) DO UPDATE SET
            monthly_target = EXCLUDED.monthly_target,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
        `,
        [branchCode, monthStart, t.tier, t.monthlyTarget, actor || null],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  return listSalesTargets({ db, branchCode, month: monthStart });
}

async function getSalesProgress({ db, branchCode, month, asOfDate }) {
  const monthStart = normalizeMonth(month);
  const totalDays = daysInMonth(monthStart);
  const monthEnd = new Date(monthStart + "T00:00:00Z");
  monthEnd.setUTCDate(totalDays);
  const monthEndIso = monthEnd.toISOString().slice(0, 10);

  const today = new Date().toISOString().slice(0, 10);
  const requestedAsOf = asOfDate ? String(asOfDate).slice(0, 10) : today;
  // Clamp asOfDate into [monthStart, monthEnd] so a stale/future param can't
  // produce a nonsensical days-elapsed count.
  const clampedAsOf = requestedAsOf < monthStart ? monthStart : requestedAsOf > monthEndIso ? monthEndIso : requestedAsOf;

  const [targetsResult, actualResult] = await Promise.all([
    listSalesTargets({ db, branchCode, month: monthStart }),
    db.query(
      `
        SELECT COALESCE(SUM(grand_amount), 0) AS actual
        FROM ada.sales_headers
        WHERE branch_code = $1
          AND doc_date >= $2::date
          AND doc_date <= $3::date
          AND ${ACTUAL_SALES_FILTER}
      `,
      [branchCode, monthStart, clampedAsOf],
    ),
  ]);

  const actualSoFar = Number(actualResult.rows[0].actual);
  const daysElapsed = Math.floor(
    (new Date(clampedAsOf + "T00:00:00Z") - new Date(monthStart + "T00:00:00Z")) / 86400000,
  ) + 1;
  const daysRemaining = Math.max(totalDays - daysElapsed, 0);

  const tiers = targetsResult.tiers.map((t) => {
    if (t.monthlyTarget == null) {
      return { ...t, dailyTarget: null, actualAvgPerDay: null, remainingAmount: null, remainingAvgPerDay: null, achieved: null };
    }
    const remainingAmount = Math.max(t.monthlyTarget - actualSoFar, 0);
    return {
      ...t,
      dailyTarget: t.monthlyTarget / totalDays,
      actualAvgPerDay: daysElapsed > 0 ? actualSoFar / daysElapsed : 0,
      remainingAmount,
      remainingAvgPerDay: daysRemaining > 0 ? remainingAmount / daysRemaining : remainingAmount > 0 ? remainingAmount : 0,
      achieved: actualSoFar >= t.monthlyTarget,
    };
  });

  return {
    branchCode,
    month: monthStart,
    asOfDate: clampedAsOf,
    totalDaysInMonth: totalDays,
    daysElapsed,
    daysRemaining,
    actualSoFar,
    tiers,
  };
}

module.exports = {
  listSalesTargets,
  upsertSalesTargets,
  getSalesProgress,
  ACTUAL_SALES_FILTER,
};
