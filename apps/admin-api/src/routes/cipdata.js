"use strict";

const express = require("express");

const DEFAULT_TIMEZONE = "Asia/Bangkok";
const LOOKUP_SELECT = [
  "encounter_id",
  "branch_no",
  "encounter_at",
  "followup_call",
  "patient_pid",
  "patient_name",
  "patient_phone",
  "symptom_no",
  "symptom_name",
  "th_answers",
  "meds_json",
  "meds_amed_th",
  "pharm_warning",
].join(",");
const MEDICATION_SELECT = [
  "barcode",
  "sku_id",
  "item_id",
  "qty",
  "unit_price",
  "line_total",
  "use_text",
  "directions_text",
  "use_text_agg",
  "amed_full_name",
  "amed_short_name",
  "verified_by",
].join(",");
const LOOKUP_SORT_FIELDS = new Set([
  "encounter_at",
  "patient_pid",
  "symptom_no",
  "followup_call",
  "branch_no",
]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeOptionalText(value) {
  return value == null ? "" : String(value).trim();
}

function normalizePage(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePageSize(value, fallback = 25, max = 200) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function normalizeSort(value) {
  const candidate = normalizeOptionalText(value);
  return LOOKUP_SORT_FIELDS.has(candidate) ? candidate : "encounter_at";
}

function normalizeDirection(value) {
  return String(value || "").trim().toUpperCase() === "ASC" ? "ASC" : "DESC";
}

function parseContentRangeTotal(headerValue) {
  const match = String(headerValue || "").match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") {
    return 0;
  }
  return Number(match[1]) || 0;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function bangkokNow() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: DEFAULT_TIMEZONE,
    }),
  );
}

function toBangkokDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toBangkokStartIso(dateText) {
  return `${dateText}T00:00:00+07:00`;
}

function toBangkokEndIso(dateText) {
  return `${dateText}T23:59:59+07:00`;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function computeRemainingDays(today) {
  const tomorrow = addDays(today, 1);
  tomorrow.setHours(0, 0, 0, 0);

  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  endOfMonth.setHours(0, 0, 0, 0);

  const diff = endOfMonth.getTime() - tomorrow.getTime();
  if (diff < 0) {
    return 0;
  }
  return Math.ceil(diff / (24 * 60 * 60 * 1000)) + 1;
}

function assertCipdataConfigured(config) {
  if (!config.cipdataSupabaseUrl || !config.cipdataSupabaseServiceRoleKey) {
    throw createHttpError(
      503,
      "CiPData is not configured. Set CIPDATA_SUPABASE_URL and CIPDATA_SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
}

function createHeadersAccessor(headers) {
  if (headers && typeof headers.get === "function") {
    return headers;
  }
  return {
    get(name) {
      if (!headers || typeof headers !== "object") {
        return null;
      }
      const key = Object.keys(headers).find(
        (candidate) => candidate.toLowerCase() === String(name || "").toLowerCase(),
      );
      return key ? headers[key] : null;
    },
  };
}

function createSupabaseClient({ config, fetchImpl }) {
  const fetcher = fetchImpl || global.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("A fetch implementation is required for CiPData routes.");
  }

  async function fetchSupabase(resourcePath, options = {}) {
    assertCipdataConfigured(config);

    const params = options.params || null;
    const method = options.method || "GET";
    const headers = options.headers || {};
    const body = options.body;

    const url = new URL(`/rest/v1/${resourcePath}`, config.cipdataSupabaseUrl);
    if (params) {
      url.search = params.toString();
    }

    const response = await fetcher(url.toString(), {
      method,
      headers: {
        apikey: config.cipdataSupabaseServiceRoleKey,
        Authorization: `Bearer ${config.cipdataSupabaseServiceRoleKey}`,
        Accept: "application/json",
        ...headers,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw createHttpError(502, `CiPData Supabase request failed (${response.status}): ${text}`);
    }

    return {
      ok: response.ok,
      status: response.status,
      headers: createHeadersAccessor(response.headers),
      json: () => response.json(),
      text: () => response.text(),
    };
  }

  async function fetchSupabaseJson(resourcePath, options = {}) {
    const response = await fetchSupabase(resourcePath, options);
    if (options.method === "HEAD") {
      return null;
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  async function fetchSupabaseRpc(functionName, args) {
    assertCipdataConfigured(config);

    const response = await fetcher(
      new URL(`/rest/v1/rpc/${functionName}`, config.cipdataSupabaseUrl).toString(),
      {
        method: "POST",
        headers: {
          apikey: config.cipdataSupabaseServiceRoleKey,
          Authorization: `Bearer ${config.cipdataSupabaseServiceRoleKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args || {}),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw createHttpError(502, `CiPData Supabase RPC failed (${response.status}): ${text}`);
    }

    return response.status === 204 ? null : response.json();
  }

  return {
    fetchSupabase,
    fetchSupabaseJson,
    fetchSupabaseRpc,
  };
}

function applyLookupFilters(params, filters) {
  const search = normalizeOptionalText(filters.search);
  const branchCode = normalizeOptionalText(filters.branchCode);
  const dateFrom = normalizeOptionalText(filters.dateFrom);
  const dateTo = normalizeOptionalText(filters.dateTo);
  const patientPid = normalizeOptionalText(filters.patientPid);
  const symptom = normalizeOptionalText(filters.symptom);
  const drug = normalizeOptionalText(filters.drug);

  if (search) {
    params.set(
      "or",
      [
        `patient_pid.ilike.%${search}%`,
        `patient_name.ilike.%${search}%`,
        `patient_phone.ilike.%${search}%`,
        `symptom_name.ilike.%${search}%`,
      ].join(","),
    );
  }

  if (branchCode) {
    params.set("branch_no", `eq.${branchCode}`);
  }

  if (dateFrom) {
    params.set("encounter_at", `gte.${toBangkokStartIso(dateFrom)}`);
  }

  if (dateTo) {
    params.append("encounter_at", `lte.${toBangkokEndIso(dateTo)}`);
  }

  if (patientPid) {
    params.set("patient_pid", `ilike.%${patientPid}%`);
  }

  if (symptom) {
    if (/^\d+$/.test(symptom)) {
      params.set("symptom_no", `eq.${symptom}`);
    } else {
      params.set("symptom_name", `ilike.%${symptom}%`);
    }
  }

  if (drug) {
    params.set("meds_amed_th", `ilike.%${drug}%`);
  }
}

function normalizeEncounterRecord(row) {
  return {
    encounterId: row.encounter_id,
    branchNo: row.branch_no || "",
    encounterAt: row.encounter_at || null,
    followupCall: row.followup_call || null,
    patientPid: row.patient_pid || "",
    patientName: row.patient_name || "",
    patientPhone: row.patient_phone || "",
    symptomNo: row.symptom_no == null ? null : Number(row.symptom_no),
    symptomName: row.symptom_name || "",
    answersText: row.th_answers || "",
    medsJson: row.meds_json || null,
    medsAmedTh: row.meds_amed_th || "",
    warningNote: row.pharm_warning || "",
  };
}

function normalizeMedicationRecord(row) {
  return {
    barcode: row.barcode || "",
    skuId: row.sku_id == null ? null : Number(row.sku_id),
    itemId: row.item_id == null ? null : Number(row.item_id),
    quantity: Number(row.qty || 0),
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    lineTotal: row.line_total == null ? null : Number(row.line_total),
    directionsText: row.directions_text || row.use_text || "",
    aggregateDirections: row.use_text_agg || "",
    amedFullName: row.amed_full_name || "",
    amedShortName: row.amed_short_name || "",
    verifiedBy: row.verified_by || "",
  };
}

function normalizeSummaryRecord(row) {
  const qtyInBase = Number(row.qty_in_base || 1);
  const totalQty = Number(row.total_qty || 0);

  return {
    skuId: row.sku_id || "",
    companyCode: row.company_code || "",
    skuName: row.sku_name || "",
    uom: row.uom || "",
    qtyInBase,
    totalQty,
    totalQtyBase: totalQty * qtyInBase,
    orders: Number(row.orders || 0),
    lastSold: row.last_sold || null,
  };
}

function buildReportHeading(reportType, dateLabel, branchLabel) {
  const typeLabels = {
    range: "ช่วงวันที่",
    followup_today: "ติดตามอาการ",
    yesterday: "สรุปเคสเมื่อวาน",
    week: "รายสัปดาห์",
    month: "รายเดือน",
  };

  return {
    reportType,
    title: `รายงาน CiPData (${typeLabels[reportType] || "รายงาน"})`,
    subtitle: [dateLabel, branchLabel].filter(Boolean).join(" • "),
  };
}

async function listAllRows(fetchSupabase, resourcePath, params) {
  const rows = [];
  const pageSize = 1000;
  let start = 0;

  while (true) {
    const response = await fetchSupabase(resourcePath, {
      params,
      headers: {
        Range: `${start}-${start + pageSize - 1}`,
        "Range-Unit": "items",
      },
    });
    const chunk = await response.json();
    rows.push(...chunk);
    if (chunk.length < pageSize) {
      break;
    }
    start += pageSize;
  }

  return rows;
}

function resolveReportRange(reportType, query) {
  const today = bangkokNow();
  const todayText = toBangkokDateString(today);

  if (reportType === "yesterday") {
    const yesterday = toBangkokDateString(addDays(today, -1));
    return { dateFrom: yesterday, dateTo: yesterday, mode: "encounter" };
  }

  if (reportType === "week") {
    return {
      dateFrom: toBangkokDateString(addDays(today, -6)),
      dateTo: todayText,
      mode: "encounter",
    };
  }

  if (reportType === "month") {
    return {
      dateFrom: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`,
      dateTo: todayText,
      mode: "encounter",
    };
  }

  if (reportType === "followup_today") {
    return {
      dateFrom: todayText,
      dateTo: todayText,
      mode: "followup",
    };
  }

  return {
    dateFrom: normalizeOptionalText(query.dateFrom) || todayText,
    dateTo: normalizeOptionalText(query.dateTo) || todayText,
    mode: "encounter",
  };
}

function createCipdataRouter({ config, fetchImpl } = {}) {
  const router = express.Router();
  const { fetchSupabase, fetchSupabaseJson, fetchSupabaseRpc } = createSupabaseClient({
    config,
    fetchImpl,
  });

  router.use((req, res, next) => {
    if (!config.cipdataSupabaseUrl || !config.cipdataSupabaseServiceRoleKey) {
      return res.status(503).json({
        error: "CiPData is not configured. Set CIPDATA_SUPABASE_URL and CIPDATA_SUPABASE_SERVICE_ROLE_KEY.",
        request_id: req.requestId || null,
      });
    }
    return next();
  });

  router.get(
    "/branches",
    asyncHandler(async (_req, res) => {
      const params = new URLSearchParams({
        select: "branch_no",
        order: "branch_no.asc",
        branch_no: "not.is.null",
      });

      const rows = await listAllRows(fetchSupabase, "v_encounters_lookup_ui", params);
      const uniqueBranchCodes = [...new Set(rows.map((row) => String(row.branch_no || "").trim()).filter(Boolean))];

      res.json({
        branches: uniqueBranchCodes.map((branchCode) => ({
          branchCode,
          branchName: "",
        })),
      });
    }),
  );

  router.get(
    "/encounters",
    asyncHandler(async (req, res) => {
      const page = normalizePage(req.query.page, 1);
      const pageSize = normalizePageSize(req.query.pageSize, 25, 100);
      const sort = normalizeSort(req.query.sort);
      const dir = normalizeDirection(req.query.dir);

      const params = new URLSearchParams({
        select: LOOKUP_SELECT,
        order: `${sort}.${dir.toLowerCase()}`,
      });
      applyLookupFilters(params, req.query);

      const start = (page - 1) * pageSize;
      const response = await fetchSupabase("v_encounters_lookup_ui", {
        params,
        headers: {
          Prefer: "count=exact",
          Range: `${start}-${start + pageSize - 1}`,
          "Range-Unit": "items",
        },
      });

      const rows = await response.json();
      res.json({
        records: rows.map(normalizeEncounterRecord),
        total: parseContentRangeTotal(response.headers.get("content-range")),
        page,
        pageSize,
      });
    }),
  );

  router.get(
    "/encounters/:encounterId",
    asyncHandler(async (req, res) => {
      const encounterId = normalizeOptionalText(req.params.encounterId);
      if (!encounterId) {
        return res.status(400).json({ error: "encounterId is required" });
      }

      const params = new URLSearchParams({
        select: LOOKUP_SELECT,
        encounter_id: `eq.${encounterId}`,
        limit: "1",
      });

      const rows = await fetchSupabaseJson("v_encounters_lookup_ui", { params });
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(404).json({ error: "Encounter not found" });
      }

      return res.json(normalizeEncounterRecord(rows[0]));
    }),
  );

  router.get(
    "/encounters/:encounterId/medications",
    asyncHandler(async (req, res) => {
      const encounterId = normalizeOptionalText(req.params.encounterId);
      if (!encounterId) {
        return res.status(400).json({ error: "encounterId is required" });
      }

      const params = new URLSearchParams({
        select: MEDICATION_SELECT,
        encounter_id: `eq.${encounterId}`,
      });

      const rows = await fetchSupabaseJson("v_encounter_meds_min", { params });
      return res.json({
        records: Array.isArray(rows) ? rows.map(normalizeMedicationRecord) : [],
      });
    }),
  );

  router.get(
    "/kpis",
    asyncHandler(async (req, res) => {
      const branchCode = normalizeOptionalText(req.query.branchCode);
      const accumMode = normalizeOptionalText(req.query.accumMode) === "custom" ? "custom" : "monthStart";
      const accumStart = normalizeOptionalText(req.query.accumStart);
      const accumEnd = normalizeOptionalText(req.query.accumEnd);
      const monthlyTarget = Math.max(1, Number(req.query.monthlyTarget || 300));
      const today = bangkokNow();
      const todayText = toBangkokDateString(today);

      const todayParams = new URLSearchParams({
        select: "encounter_id",
        order: "encounter_at.desc",
      });
      if (branchCode) {
        todayParams.set("branch_no", `eq.${branchCode}`);
      }
      todayParams.set("encounter_at", `gte.${toBangkokStartIso(todayText)}`);
      todayParams.append("encounter_at", `lte.${toBangkokEndIso(todayText)}`);

      const todayResponse = await fetchSupabase("v_encounters_lookup_ui", {
        params: todayParams,
        headers: {
          Prefer: "count=exact",
          Range: "0-0",
          "Range-Unit": "items",
        },
      });
      const todayCount = parseContentRangeTotal(todayResponse.headers.get("content-range"));

      let accumFrom = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
      let accumTo = todayText;
      if (accumMode === "custom" && accumStart && accumEnd) {
        accumFrom = accumStart;
        accumTo = accumEnd;
      }

      const accumParams = new URLSearchParams({
        select: "encounter_id",
        order: "encounter_at.desc",
      });
      if (branchCode) {
        accumParams.set("branch_no", `eq.${branchCode}`);
      }
      accumParams.set("encounter_at", `gte.${toBangkokStartIso(accumFrom)}`);
      accumParams.append("encounter_at", `lte.${toBangkokEndIso(accumTo)}`);

      const accumResponse = await fetchSupabase("v_encounters_lookup_ui", {
        params: accumParams,
        headers: {
          Prefer: "count=exact",
          Range: "0-0",
          "Range-Unit": "items",
        },
      });
      const accumCount = parseContentRangeTotal(accumResponse.headers.get("content-range"));
      const remaining = Math.max(0, monthlyTarget - accumCount);
      const remainingDays = computeRemainingDays(today);

      return res.json({
        todayDate: toBangkokStartIso(todayText),
        todayCount,
        accumCount,
        accumLabel:
          accumMode === "custom" && accumStart && accumEnd
            ? `ช่วง ${accumStart} ถึง ${accumEnd}`
            : `ตั้งแต่ ${accumFrom} ถึง ${accumTo}`,
        target: monthlyTarget,
        remaining,
        perDay: remainingDays > 0 ? Math.ceil(remaining / remainingDays) : remaining,
        remainingDays,
      });
    }),
  );

  router.get(
    "/summary",
    asyncHandler(async (req, res) => {
      const dateFrom = normalizeOptionalText(req.query.dateFrom);
      const dateTo = normalizeOptionalText(req.query.dateTo);
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ error: "dateFrom and dateTo are required" });
      }

      const branchCode = normalizeOptionalText(req.query.branchCode);
      const search = normalizeOptionalText(req.query.search).toLowerCase();
      const hideZero = String(req.query.hideZero || "").trim().toLowerCase() === "true";

      let rows = await fetchSupabaseRpc("sku_qty_summary", {
        p_from: toBangkokStartIso(dateFrom),
        p_to: toBangkokEndIso(dateTo),
        p_branch: branchCode || null,
      });
      rows = Array.isArray(rows) ? rows.map(normalizeSummaryRecord) : [];

      if (hideZero) {
        rows = rows.filter((row) => row.totalQtyBase > 0);
      }

      if (search) {
        rows = rows.filter((row) =>
          `${row.skuName} ${row.companyCode} ${row.skuId}`.toLowerCase().includes(search),
        );
      }

      const totals = rows.reduce(
        (accumulator, row) => {
          accumulator.totalQtyBase += row.totalQtyBase;
          accumulator.totalOrders += row.orders;
          return accumulator;
        },
        { totalQtyBase: 0, totalOrders: 0 },
      );

      return res.json({
        records: rows,
        totals,
        filters: {
          dateFrom,
          dateTo,
          branchCode,
          search,
          hideZero,
        },
      });
    }),
  );

  router.get(
    "/followups",
    asyncHandler(async (req, res) => {
      const page = normalizePage(req.query.page, 1);
      const pageSize = normalizePageSize(req.query.pageSize, 50, 100);
      const date = normalizeOptionalText(req.query.date) || toBangkokDateString(bangkokNow());
      const branchCode = normalizeOptionalText(req.query.branchCode);

      const params = new URLSearchParams({
        select: LOOKUP_SELECT,
        order: "followup_call.asc,encounter_at.desc",
        followup_call: `gte.${toBangkokStartIso(date)}`,
      });
      params.append("followup_call", `lte.${toBangkokEndIso(date)}`);
      if (branchCode) {
        params.set("branch_no", `eq.${branchCode}`);
      }

      const start = (page - 1) * pageSize;
      const response = await fetchSupabase("v_encounters_lookup_ui", {
        params,
        headers: {
          Prefer: "count=exact",
          Range: `${start}-${start + pageSize - 1}`,
          "Range-Unit": "items",
        },
      });

      const rows = await response.json();
      return res.json({
        records: rows.map(normalizeEncounterRecord),
        total: parseContentRangeTotal(response.headers.get("content-range")),
        page,
        pageSize,
        date,
      });
    }),
  );

  router.get(
    "/report-preview",
    asyncHandler(async (req, res) => {
      const reportType = normalizeOptionalText(req.query.reportType) || "range";
      const branchCode = normalizeOptionalText(req.query.branchCode);
      const patientPid = normalizeOptionalText(req.query.patientPid);
      const symptom = normalizeOptionalText(req.query.symptom);
      const drug = normalizeOptionalText(req.query.drug);
      const range = resolveReportRange(reportType, req.query);

      const params = new URLSearchParams({
        select: LOOKUP_SELECT,
        order:
          range.mode === "followup" ? "followup_call.asc,encounter_at.desc" : "encounter_at.desc",
      });

      if (range.mode === "followup") {
        params.set("followup_call", `gte.${toBangkokStartIso(range.dateFrom)}`);
        params.append("followup_call", `lte.${toBangkokEndIso(range.dateTo)}`);
      } else {
        params.set("encounter_at", `gte.${toBangkokStartIso(range.dateFrom)}`);
        params.append("encounter_at", `lte.${toBangkokEndIso(range.dateTo)}`);
      }

      applyLookupFilters(params, {
        branchCode,
        patientPid,
        symptom,
        drug,
      });

      const rows = await listAllRows(fetchSupabase, "v_encounters_lookup_ui", params);
      const branchLabel = branchCode ? `สาขา ${branchCode}` : "";
      const dateLabel =
        range.dateFrom === range.dateTo
          ? `วันที่ ${range.dateFrom}`
          : `ช่วง ${range.dateFrom} ถึง ${range.dateTo}`;

      return res.json({
        meta: {
          ...buildReportHeading(reportType, dateLabel, branchLabel),
          generatedAt: new Date().toISOString(),
        },
        filters: {
          reportType,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          branchCode,
          patientPid,
          symptom,
          drug,
        },
        records: rows.map((row) => {
          const normalized = normalizeEncounterRecord(row);
          return {
            encounterId: normalized.encounterId,
            branchNo: normalized.branchNo,
            encounterAt: normalized.encounterAt,
            followupCall: normalized.followupCall,
            patientPid: normalized.patientPid,
            patientName: normalized.patientName,
            symptomNo: normalized.symptomNo,
            symptomName: normalized.symptomName,
            answersText: normalized.answersText,
            medications: normalized.medsAmedTh,
            warningNote: normalized.warningNote,
          };
        }),
      });
    }),
  );

  return router;
}

module.exports = {
  createCipdataRouter,
};
