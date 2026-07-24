"use strict";

// Monthly sales-target tracking, 3 escalating tiers per branch per month.
// Targets are admin-set and stored (ordering.branch_sales_targets, rarely
// changes). Everything else — month-to-date actual, daily pacing, remaining
// amount — is computed live from ada.sales_headers on every read, never
// cached, so it's always as current as the last successful branch sync.
//
// "Actual sales" = the AdaSoft "ยอดขายตามช่วงเวลา" net total, which the business
// treats as authoritative. Reverse-engineered and proven to the baht (total AND
// every hourly bucket) on branch 005, 2026-07-23 — see
// SC-StockDay-Ordering/docs/EVIDENCE_2026-07-23_ADASOFT_SALES_LOGIC_BRANCH005.md.
//
// Crystal formula {@nTotal}:
//   sale line   = FCSdtNet − FCSdtDisAvg − FCSdtFootAvg − FCSdtRePackAvg
//   return line = the same amount × -1
//
// The OLD filter kept only DocType=1 / Refund=1 and dropped Refund=2 originals
// entirely. That is wrong for a *partial* refund: the DocType 9 return is smaller
// than the original it references, so discarding the whole original undercounts by
// the residual (e.g. branch 005 was short by 248 for 2026-07-01..22; branch 001 by
// 2,774 in July). The correct rule keeps the original and subtracts only the
// actual return. Refund status is therefore NOT filtered; DocType 9 is subtracted.
// The report also zeroes cancelled documents (FTShdStaDoc 2/3).
const DOC_TYPE_EXPR = `COALESCE(NULLIF(sh.raw_payload->>'FTShdDocType', ''), '1')`;
const PAID_OK_EXPR = `COALESCE(NULLIF(sh.raw_payload->>'FTShdStaPaid', ''), sh.paid_status, '') = '3'`;
const NOT_CANCELLED_EXPR = `COALESCE(NULLIF(sh.raw_payload->>'FTShdStaDoc', ''), '1') NOT IN ('2', '3')`;
// Documents that make up the net total: paid sale docs (1) and paid return docs (9).
const SALES_NET_SCOPE = `${DOC_TYPE_EXPR} IN ('1', '9') AND ${PAID_OK_EXPR} AND ${NOT_CANCELLED_EXPR}`;
const DETAIL_ALLOCATIONS = [
  "FCSdtDisAvg",
  "FCSdtFootAvg",
  "FCSdtRePackAvg",
].map((field) => `COALESCE(NULLIF(sl.raw_payload->>'${field}', '')::numeric, 0)`).join(" - ");
// This is the report's {@nTotalCur}; SP_nMnyFactor is fixed to 1 in the .rpt.
const SALES_NET_AMOUNT = `(CASE WHEN ${DOC_TYPE_EXPR} = '9' THEN -1 ELSE 1 END) * (COALESCE(sl.line_amount, 0) - ${DETAIL_ALLOCATIONS})`;

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

function toIsoDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
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

  const [targetsResult, actualResult, dailyResult] = await Promise.all([
    listSalesTargets({ db, branchCode, month: monthStart }),
    db.query(
      `
        SELECT COALESCE(SUM(${SALES_NET_AMOUNT}), 0) AS actual
        FROM ada.sales_headers sh
        JOIN ada.sales_lines sl
          ON sl.branch_code = sh.branch_code
         AND sl.doc_no = sh.doc_no
        WHERE sh.branch_code = $1
          AND sh.doc_date >= $2::date
          AND sh.doc_date <= $3::date
          AND ${SALES_NET_SCOPE}
      `,
      [branchCode, monthStart, clampedAsOf],
    ),
    db.query(
      `
        SELECT sh.doc_date::text AS doc_date, COALESCE(SUM(${SALES_NET_AMOUNT}), 0) AS actual
        FROM ada.sales_headers sh
        JOIN ada.sales_lines sl
          ON sl.branch_code = sh.branch_code
         AND sl.doc_no = sh.doc_no
        WHERE sh.branch_code = $1
          AND sh.doc_date >= $2::date
          AND sh.doc_date <= $3::date
          AND ${SALES_NET_SCOPE}
        GROUP BY sh.doc_date
        ORDER BY sh.doc_date
      `,
      [branchCode, monthStart, clampedAsOf],
    ),
  ]);

  const actualSoFar = Number(actualResult.rows[0].actual);
  const byDate = new Map(dailyResult.rows.map((r) => [r.doc_date.slice(0, 10), Number(r.actual)]));
  const dailyActuals = [];
  for (let d = new Date(monthStart + "T00:00:00Z"); toIsoDateOnly(d) <= clampedAsOf; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = toIsoDateOnly(d);
    dailyActuals.push({ date: iso, actual: byDate.get(iso) || 0 });
  }
  const daysElapsed = Math.floor(
    (new Date(clampedAsOf + "T00:00:00Z") - new Date(monthStart + "T00:00:00Z")) / 86400000,
  ) + 1;
  // Business planning follows the source Excel workbook: "remaining days"
  // includes the as-of date itself. This intentionally overlaps with
  // daysElapsed, which also includes the as-of date. For example, July 24 is
  // day 24 of 31 and has 8 planning days remaining (24..31), not 7.
  const daysRemaining = Math.max(totalDays - daysElapsed + 1, 0);

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
    dailyActuals,
  };
}

module.exports = {
  listSalesTargets,
  upsertSalesTargets,
  getSalesProgress,
  SALES_NET_SCOPE,
  SALES_NET_AMOUNT,
};
