"use strict";

const express = require("express");

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function toNumber(value, fallback = null) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 10);
}

function parseTimestamp(value, fallback = null) {
  const normalized = normalizeNullableText(value);
  return normalized || fallback;
}

function parseApiRecords(body) {
  if (!body || !Array.isArray(body.records)) {
    return { error: "Payload must include a records array." };
  }
  return { records: body.records };
}

function parseTransferPayload(body) {
  if (!body || !Array.isArray(body.headers) || !Array.isArray(body.lines)) {
    return { error: "Payload must include headers and lines arrays." };
  }
  return { headers: body.headers, lines: body.lines };
}

function parseRequiredApiKey(config, req) {
  if (!config.posApiKeys || config.posApiKeys.size === 0) {
    return null;
  }
  const incoming = normalizeText(req.headers["x-api-key"]);
  if (!incoming || !config.posApiKeys.has(incoming)) {
    return "Invalid API key.";
  }
  return null;
}

function getSourceSystem(body) {
  return normalizeText(body?.sourceSystem) || "AdaAcc";
}

function getSourceSyncedAt(body) {
  return parseTimestamp(body?.sourceSyncedAt, new Date().toISOString());
}

function getSyncRunId(body) {
  const n = Number(body?.syncRunId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function getRawPayload(record) {
  return JSON.stringify(record || {});
}

function buildStockSnapshotKey(snapshotAt, branchCode, warehouseCode, productCode, lotNo, expiryDate) {
  return [
    snapshotAt || "",
    branchCode || "",
    warehouseCode || "",
    productCode || "",
    lotNo || "",
    expiryDate || "",
  ].join("|");
}

function pick(record, keys, fallback = null) {
  for (const key of keys) {
    if (record[key] != null && record[key] !== "") {
      return record[key];
    }
  }
  return fallback;
}

async function upsertBranch(client, body, record) {
  const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
  if (!branchCode) {
    throw new Error("Each branch record requires branchCode/FTBchCode.");
  }
  await client.query(
    `
      INSERT INTO ada.branches
        (branch_code, branch_name, branch_name_th, branch_status, source_system, source_table, source_synced_at, raw_payload, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
      ON CONFLICT (branch_code) DO UPDATE SET
        branch_name = EXCLUDED.branch_name,
        branch_name_th = EXCLUDED.branch_name_th,
        branch_status = EXCLUDED.branch_status,
        source_system = EXCLUDED.source_system,
        source_table = EXCLUDED.source_table,
        source_synced_at = EXCLUDED.source_synced_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
    `,
    [
      branchCode,
      normalizeNullableText(pick(record, ["FTBchName", "branchName"])),
      normalizeNullableText(pick(record, ["FTBchNameTH", "branchNameTh"])),
      normalizeNullableText(pick(record, ["FTBchStaActive", "branchStatus", "status"])),
      getSourceSystem(body),
      normalizeText(pick(record, ["sourceTable"], "TCNMBranch")),
      getSourceSyncedAt(body),
      getRawPayload(record),
    ],
  );
}

async function upsertProduct(client, body, record) {
  const productCode = normalizeNullableText(pick(record, ["FTPdtCode", "productCode"]));
  if (!productCode) {
    throw new Error("Each product record requires productCode/FTPdtCode.");
  }

  await client.query(
    `
      INSERT INTO ada.products
        (
          product_code,
          product_name,
          product_name_th,
          supplier_code,
          category_code,
          category_name,
          unit_small,
          factor_small,
          unit_medium,
          factor_medium,
          unit_large,
          factor_large,
          stock_current,
          stock_retail,
          stock_warehouse,
          min_stock,
          max_stock,
          lead_time_days,
          is_active,
          source_system,
          source_table,
          source_synced_at,
          raw_payload,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, now())
      ON CONFLICT (product_code) DO UPDATE SET
        product_name = EXCLUDED.product_name,
        product_name_th = EXCLUDED.product_name_th,
        supplier_code = EXCLUDED.supplier_code,
        category_code = EXCLUDED.category_code,
        category_name = EXCLUDED.category_name,
        unit_small = EXCLUDED.unit_small,
        factor_small = EXCLUDED.factor_small,
        unit_medium = EXCLUDED.unit_medium,
        factor_medium = EXCLUDED.factor_medium,
        unit_large = EXCLUDED.unit_large,
        factor_large = EXCLUDED.factor_large,
        stock_current = EXCLUDED.stock_current,
        stock_retail = EXCLUDED.stock_retail,
        stock_warehouse = EXCLUDED.stock_warehouse,
        min_stock = EXCLUDED.min_stock,
        max_stock = EXCLUDED.max_stock,
        lead_time_days = EXCLUDED.lead_time_days,
        is_active = EXCLUDED.is_active,
        source_system = EXCLUDED.source_system,
        source_table = EXCLUDED.source_table,
        source_synced_at = EXCLUDED.source_synced_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
    `,
    [
      productCode,
      normalizeNullableText(pick(record, ["FTPdtName", "productName"])),
      normalizeNullableText(pick(record, ["FTPdtNameTH", "productNameTh"])),
      normalizeNullableText(pick(record, ["FTSplCode", "supplierCode"])),
      normalizeNullableText(pick(record, ["FTPdtGrpCode", "categoryCode"])),
      normalizeNullableText(pick(record, ["FTPdtGrpName", "categoryName"])),
      normalizeNullableText(pick(record, ["FTPdtSUnit", "unitSmall"])),
      toNumber(pick(record, ["FCPdtSFactor", "factorSmall"])),
      normalizeNullableText(pick(record, ["FTPdtMUnit", "unitMedium"])),
      toNumber(pick(record, ["FCPdtMFactor", "factorMedium"])),
      normalizeNullableText(pick(record, ["FTPdtLUnit", "unitLarge"])),
      toNumber(pick(record, ["FCPdtLFactor", "factorLarge"])),
      toNumber(pick(record, ["FCPdtQtyNow", "stockCurrent"])),
      toNumber(pick(record, ["FCPdtQtyRet", "stockRetail"])),
      toNumber(pick(record, ["FCPdtQtyWhs", "stockWarehouse"])),
      toNumber(pick(record, ["FCPdtMin", "minStock"])),
      toNumber(pick(record, ["FCPdtMax", "maxStock"])),
      toNumber(pick(record, ["FCPdtLeadTime", "leadTimeDays"])),
      normalizeNullableText(pick(record, ["FTPdtStaActive", "isActive", "status"])),
      getSourceSystem(body),
      normalizeText(pick(record, ["sourceTable"], "TCNMPdt")),
      getSourceSyncedAt(body),
      getRawPayload(record),
    ],
  );

  const barcodeFields = [
    ["FTPdtBarCode1", "barcode1", "primary"],
    ["FTPdtBarCode2", "barcode2", "secondary"],
    ["FTPdtBarCode3", "barcode3", "secondary"],
  ];

  for (const [sourceKey, aliasKey, role] of barcodeFields) {
    const barcode = normalizeNullableText(pick(record, [sourceKey, aliasKey]));
    if (!barcode) {
      continue;
    }
    await client.query(
      `
        INSERT INTO ada.product_barcodes
          (product_code, barcode, barcode_role, source_system, source_table, source_synced_at, raw_payload, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
        ON CONFLICT (product_code, barcode) DO UPDATE SET
          barcode_role = EXCLUDED.barcode_role,
          source_system = EXCLUDED.source_system,
          source_table = EXCLUDED.source_table,
          source_synced_at = EXCLUDED.source_synced_at,
          raw_payload = EXCLUDED.raw_payload,
          updated_at = now()
      `,
      [
        productCode,
        barcode,
        role,
        getSourceSystem(body),
        normalizeText(pick(record, ["sourceTable"], "TCNMPdt")),
        getSourceSyncedAt(body),
        getRawPayload(record),
      ],
    );
  }
}

async function upsertTransferHeader(client, body, record) {
  const docNo = normalizeNullableText(pick(record, ["FTPthDocNo", "docNo"]));
  const docType = normalizeNullableText(pick(record, ["FTPthDocType", "docType"]));
  const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
  if (!docNo || !docType || !branchCode) {
    throw new Error("Each transfer header requires FTPthDocNo, FTPthDocType, and FTBchCode.");
  }

  await client.query(
    `
      INSERT INTO ada.transfer_headers
        (
          doc_no,
          doc_type,
          doc_status,
          process_status,
          branch_code,
          branch_code_to,
          warehouse_code,
          warehouse_code_to,
          doc_date,
          doc_time,
          approved_at,
          processed_at,
          created_by,
          approved_by,
          remark,
          reference_doc_no,
          reference_doc_type,
          source_system,
          source_table,
          source_synced_at,
          raw_payload,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, now())
      ON CONFLICT (doc_no, doc_type, branch_code) DO UPDATE SET
        doc_status = EXCLUDED.doc_status,
        process_status = EXCLUDED.process_status,
        branch_code_to = EXCLUDED.branch_code_to,
        warehouse_code = EXCLUDED.warehouse_code,
        warehouse_code_to = EXCLUDED.warehouse_code_to,
        doc_date = EXCLUDED.doc_date,
        doc_time = EXCLUDED.doc_time,
        approved_at = EXCLUDED.approved_at,
        processed_at = EXCLUDED.processed_at,
        created_by = EXCLUDED.created_by,
        approved_by = EXCLUDED.approved_by,
        remark = EXCLUDED.remark,
        reference_doc_no = EXCLUDED.reference_doc_no,
        reference_doc_type = EXCLUDED.reference_doc_type,
        source_system = EXCLUDED.source_system,
        source_table = EXCLUDED.source_table,
        source_synced_at = EXCLUDED.source_synced_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
    `,
    [
      docNo,
      docType,
      normalizeNullableText(pick(record, ["FTPthStaDoc", "docStatus"])),
      normalizeNullableText(pick(record, ["FTPthStaPrcDoc", "processStatus"])),
      branchCode,
      normalizeNullableText(pick(record, ["FTBchCodeTo", "branchCodeTo"])),
      normalizeNullableText(pick(record, ["FTWahCode", "warehouseCode"])),
      normalizeNullableText(pick(record, ["FTWahCodeTo", "warehouseCodeTo"])),
      parseDate(pick(record, ["FDPthDocDate", "docDate"])),
      normalizeNullableText(pick(record, ["FTPthDocTime", "docTime"])),
      parseTimestamp(pick(record, ["FDPthApprove", "approvedAt"])),
      parseTimestamp(pick(record, ["FDPthPrcDate", "processedAt"])),
      normalizeNullableText(pick(record, ["FTPthUsrName", "createdBy"])),
      normalizeNullableText(pick(record, ["FTPthApvCode", "approvedBy"])),
      normalizeNullableText(pick(record, ["FTPthRmk", "remark"])),
      normalizeNullableText(pick(record, ["FTPthRefDoc", "referenceDocNo"])),
      normalizeNullableText(pick(record, ["FTPthRefType", "referenceDocType"])),
      getSourceSystem(body),
      normalizeText(pick(record, ["sourceTable"], "TCNTPdtTnfHD")),
      getSourceSyncedAt(body),
      getRawPayload(record),
    ],
  );
}

async function upsertTransferLine(client, body, record) {
  const docNo = normalizeNullableText(pick(record, ["FTPthDocNo", "docNo"]));
  const docType = normalizeNullableText(pick(record, ["FTPthDocType", "docType"]));
  const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
  const lineNo = Number(pick(record, ["FNPtdSeqNo", "lineNo"], 0));
  const productCode = normalizeNullableText(pick(record, ["FTPtdPdtCode", "productCode"]));
  if (!docNo || !docType || !branchCode || !Number.isInteger(lineNo) || lineNo <= 0 || !productCode) {
    throw new Error("Each transfer line requires doc keys, positive lineNo, and FTPtdPdtCode.");
  }

  await client.query(
    `
      INSERT INTO ada.transfer_lines
        (
          doc_no,
          doc_type,
          branch_code,
          line_no,
          product_code,
          barcode,
          unit_code,
          unit_name,
          qty,
          qty_base,
          stock_factor,
          lot_no,
          expiry_date,
          warehouse_code,
          reference_doc_no,
          reference_line_no,
          source_system,
          source_table,
          source_synced_at,
          raw_payload,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, now())
      ON CONFLICT (doc_no, doc_type, branch_code, line_no, product_code) DO UPDATE SET
        barcode = EXCLUDED.barcode,
        unit_code = EXCLUDED.unit_code,
        unit_name = EXCLUDED.unit_name,
        qty = EXCLUDED.qty,
        qty_base = EXCLUDED.qty_base,
        stock_factor = EXCLUDED.stock_factor,
        lot_no = EXCLUDED.lot_no,
        expiry_date = EXCLUDED.expiry_date,
        warehouse_code = EXCLUDED.warehouse_code,
        reference_doc_no = EXCLUDED.reference_doc_no,
        reference_line_no = EXCLUDED.reference_line_no,
        source_system = EXCLUDED.source_system,
        source_table = EXCLUDED.source_table,
        source_synced_at = EXCLUDED.source_synced_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
    `,
    [
      docNo,
      docType,
      branchCode,
      lineNo,
      productCode,
      normalizeNullableText(pick(record, ["FTPtdBarCode", "barcode"])),
      normalizeNullableText(pick(record, ["FTPunCode", "unitCode"])),
      normalizeNullableText(pick(record, ["FTPunName", "unitName"])),
      toNumber(pick(record, ["FCPtdQtyAll", "qty"])),
      toNumber(pick(record, ["FCPtdQtyBase", "qtyBase"])),
      toNumber(pick(record, ["FCPtdStkFac", "stockFactor"])),
      normalizeNullableText(pick(record, ["FTPtdLotNo", "lotNo"])),
      parseDate(pick(record, ["FDPtdExpired", "expiryDate"])),
      normalizeNullableText(pick(record, ["FTWahCode", "warehouseCode"])),
      normalizeNullableText(pick(record, ["FTPthRefDoc", "referenceDocNo"])),
      normalizeNullableText(pick(record, ["FNPtdRefSeqNo", "referenceLineNo"])),
      getSourceSystem(body),
      normalizeText(pick(record, ["sourceTable"], "TCNTPdtTnfDT")),
      getSourceSyncedAt(body),
      getRawPayload(record),
    ],
  );
}

function createHeaderLineUpsert(tableName, naturalKeyMessage, mapValuesFn, conflictClause) {
  return async function upsertRecord(client, body, record) {
    const mapped = mapValuesFn(body, record);
    if (mapped.error) {
      throw new Error(mapped.error || naturalKeyMessage);
    }
    await client.query(
      mapped.sql || `
        INSERT INTO ${tableName} (${mapped.columns.join(", ")})
        VALUES (${mapped.columns.map((_, index) => `$${index + 1}`).join(", ")})
        ON CONFLICT ${conflictClause} DO UPDATE SET
          ${mapped.updateAssignments.join(", ")},
          updated_at = now()
      `,
      mapped.values,
    );
  };
}

const upsertSalesHeader = createHeaderLineUpsert(
  "ada.sales_headers",
  "Each sales header requires branch_code and doc_no.",
  (body, record) => {
    const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
    const docNo = normalizeNullableText(pick(record, ["FTShdDocNo", "docNo"]));
    if (!branchCode || !docNo) {
      return { error: "Each sales header requires FTBchCode and FTShdDocNo." };
    }
    const columns = [
      "branch_code",
      "doc_no",
      "doc_date",
      "doc_time",
      "customer_code",
      "paid_status",
      "grand_amount",
      "net_amount",
      "vat_amount",
      "cashier_code",
      "terminal_code",
      "reference_doc_no",
      "source_system",
      "source_table",
      "source_synced_at",
      "raw_payload",
      "updated_at",
    ];
    return {
      columns,
      values: [
        branchCode,
        docNo,
        parseDate(pick(record, ["FDShdDocDate", "docDate"])),
        normalizeNullableText(pick(record, ["FTShdDocTime", "docTime"])),
        normalizeNullableText(pick(record, ["FTCstCode", "customerCode"])),
        normalizeNullableText(pick(record, ["FTShdStaPaid", "paidStatus"])),
        toNumber(pick(record, ["FCShdGndAmt", "grandAmount"])),
        toNumber(pick(record, ["FCShdNet", "netAmount"])),
        toNumber(pick(record, ["FCShdVatable", "vatAmount"])),
        normalizeNullableText(pick(record, ["FTUsrCode", "cashierCode"])),
        normalizeNullableText(pick(record, ["FTPosCode", "terminalCode"])),
        normalizeNullableText(pick(record, ["FTXshRefDocNo", "referenceDocNo"])),
        getSourceSystem(body),
        normalizeText(pick(record, ["sourceTable"], "TPSTSalHD")),
        getSourceSyncedAt(body),
        getRawPayload(record),
        new Date().toISOString(),
      ],
      updateAssignments: columns
        .filter((column) => !["branch_code", "doc_no", "updated_at"].includes(column))
        .map((column) => `${column} = EXCLUDED.${column}`),
    };
  },
  "(branch_code, doc_no)",
);

const upsertSalesLine = createHeaderLineUpsert(
  "ada.sales_lines",
  "Each sales line requires branch_code, doc_no, positive line_no, and product_code.",
  (body, record) => {
    const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
    const docNo = normalizeNullableText(pick(record, ["FTShdDocNo", "docNo"]));
    const lineNo = Number(pick(record, ["FNSdtSeqNo", "lineNo"], 0));
    const productCode = normalizeNullableText(pick(record, ["FTPdtCode", "productCode"]));
    if (!branchCode || !docNo || !Number.isInteger(lineNo) || lineNo <= 0 || !productCode) {
      return { error: "Each sales line requires FTBchCode, FTShdDocNo, positive lineNo, and FTPdtCode." };
    }
    const columns = [
      "branch_code",
      "doc_no",
      "line_no",
      "product_code",
      "barcode",
      "qty",
      "unit_price",
      "discount_amount",
      "line_amount",
      "stock_factor",
      "qty_base",
      "lot_no",
      "expiry_date",
      "source_system",
      "source_table",
      "source_synced_at",
      "raw_payload",
      "updated_at",
    ];
    return {
      columns,
      values: [
        branchCode,
        docNo,
        lineNo,
        productCode,
        normalizeNullableText(pick(record, ["FTSdtBarCode", "barcode"])),
        toNumber(pick(record, ["FCSdtQty", "qty"])),
        toNumber(pick(record, ["FCSdtSetPrice", "unitPrice"])),
        toNumber(pick(record, ["FCSdtDis", "discountAmount"])),
        toNumber(pick(record, ["FCSdtNetAfHD", "lineAmount"])),
        toNumber(pick(record, ["FCSdtStkFac", "stockFactor"])),
        toNumber(pick(record, ["qtyBase"])),
        normalizeNullableText(pick(record, ["FTSdtLotNo", "lotNo"])),
        parseDate(pick(record, ["FDSdtExpired", "expiryDate"])),
        getSourceSystem(body),
        normalizeText(pick(record, ["sourceTable"], "TPSTSalDT")),
        getSourceSyncedAt(body),
        getRawPayload(record),
        new Date().toISOString(),
      ],
      updateAssignments: columns
        .filter((column) => !["branch_code", "doc_no", "line_no", "product_code", "updated_at"].includes(column))
        .map((column) => `${column} = EXCLUDED.${column}`),
    };
  },
  "(branch_code, doc_no, line_no, product_code)",
);

const upsertPurchaseHeader = createHeaderLineUpsert(
  "ada.purchase_headers",
  "Each purchase header requires branch_code and doc_no.",
  (body, record) => {
    const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
    const docNo = normalizeNullableText(pick(record, ["FTXihDocNo", "docNo"]));
    if (!branchCode || !docNo) {
      return { error: "Each purchase header requires FTBchCode and FTXihDocNo." };
    }
    const columns = [
      "branch_code",
      "doc_no",
      "doc_date",
      "supplier_code",
      "doc_status",
      "remark",
      "source_system",
      "source_table",
      "source_synced_at",
      "raw_payload",
      "updated_at",
    ];
    return {
      columns,
      values: [
        branchCode,
        docNo,
        parseDate(pick(record, ["FDXihDocDate", "docDate"])),
        normalizeNullableText(pick(record, ["FTSplCode", "supplierCode"])),
        normalizeNullableText(pick(record, ["FTXihStaDoc", "docStatus"])),
        normalizeNullableText(pick(record, ["FTXihRmk", "remark"])),
        getSourceSystem(body),
        normalizeText(pick(record, ["sourceTable"], "TACTPiHD")),
        getSourceSyncedAt(body),
        getRawPayload(record),
        new Date().toISOString(),
      ],
      updateAssignments: columns
        .filter((column) => !["branch_code", "doc_no", "updated_at"].includes(column))
        .map((column) => `${column} = EXCLUDED.${column}`),
    };
  },
  "(branch_code, doc_no)",
);

const upsertPurchaseLine = createHeaderLineUpsert(
  "ada.purchase_lines",
  "Each purchase line requires branch_code, doc_no, positive line_no, and product_code.",
  (body, record) => {
    const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
    const docNo = normalizeNullableText(pick(record, ["FTXihDocNo", "docNo"]));
    const lineNo = Number(pick(record, ["FNXidSeqNo", "lineNo"], 0));
    const productCode = normalizeNullableText(pick(record, ["FTPdtCode", "productCode"]));
    if (!branchCode || !docNo || !Number.isInteger(lineNo) || lineNo <= 0 || !productCode) {
      return { error: "Each purchase line requires FTBchCode, FTXihDocNo, positive lineNo, and FTPdtCode." };
    }
    const columns = [
      "branch_code",
      "doc_no",
      "line_no",
      "product_code",
      "barcode",
      "qty",
      "qty_base",
      "stock_factor",
      "unit_code",
      "lot_no",
      "expiry_date",
      "source_system",
      "source_table",
      "source_synced_at",
      "raw_payload",
      "updated_at",
    ];
    return {
      columns,
      values: [
        branchCode,
        docNo,
        lineNo,
        productCode,
        normalizeNullableText(pick(record, ["FTXidBarCode", "barcode"])),
        toNumber(pick(record, ["FCXidQty", "qty"])),
        toNumber(pick(record, ["qtyBase"])),
        toNumber(pick(record, ["FCXidStkFac", "stockFactor"])),
        normalizeNullableText(pick(record, ["FTPunCode", "unitCode"])),
        normalizeNullableText(pick(record, ["FTXidLotNo", "lotNo"])),
        parseDate(pick(record, ["FDXidExpired", "expiryDate"])),
        getSourceSystem(body),
        normalizeText(pick(record, ["sourceTable"], "TACTPiDT")),
        getSourceSyncedAt(body),
        getRawPayload(record),
        new Date().toISOString(),
      ],
      updateAssignments: columns
        .filter((column) => !["branch_code", "doc_no", "line_no", "product_code", "updated_at"].includes(column))
        .map((column) => `${column} = EXCLUDED.${column}`),
    };
  },
  "(branch_code, doc_no, line_no, product_code)",
);

const upsertStockAdjustmentHeader = createHeaderLineUpsert(
  "ada.stock_adjustment_headers",
  "Each stock adjustment header requires branch_code and doc_no.",
  (body, record) => {
    const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
    const docNo = normalizeNullableText(pick(record, ["FTAjhDocNo", "docNo"]));
    if (!branchCode || !docNo) {
      return { error: "Each stock adjustment header requires FTBchCode and FTAjhDocNo." };
    }
    const columns = [
      "branch_code",
      "doc_no",
      "doc_date",
      "doc_type",
      "remark",
      "created_by",
      "approved_by",
      "source_system",
      "source_table",
      "source_synced_at",
      "raw_payload",
      "updated_at",
    ];
    return {
      columns,
      values: [
        branchCode,
        docNo,
        parseDate(pick(record, ["FDAjhDocDate", "docDate"])),
        normalizeNullableText(pick(record, ["FTAjhDocType", "docType"])),
        normalizeNullableText(pick(record, ["FTAjhRmk", "remark"])),
        normalizeNullableText(pick(record, ["FTAjhUsrName", "createdBy"])),
        normalizeNullableText(pick(record, ["FTAjhApvCode", "approvedBy"])),
        getSourceSystem(body),
        normalizeText(pick(record, ["sourceTable"], "TCNTPdtAjsHD")),
        getSourceSyncedAt(body),
        getRawPayload(record),
        new Date().toISOString(),
      ],
      updateAssignments: columns
        .filter((column) => !["branch_code", "doc_no", "updated_at"].includes(column))
        .map((column) => `${column} = EXCLUDED.${column}`),
    };
  },
  "(branch_code, doc_no)",
);

const upsertStockAdjustmentLine = createHeaderLineUpsert(
  "ada.stock_adjustment_lines",
  "Each stock adjustment line requires branch_code, doc_no, positive line_no, and product_code.",
  (body, record) => {
    const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
    const docNo = normalizeNullableText(pick(record, ["FTAjhDocNo", "docNo"]));
    const lineNo = Number(pick(record, ["FNAjdSeqNo", "lineNo"], 0));
    const productCode = normalizeNullableText(pick(record, ["FTPdtCode", "productCode"]));
    if (!branchCode || !docNo || !Number.isInteger(lineNo) || lineNo <= 0 || !productCode) {
      return { error: "Each stock adjustment line requires FTBchCode, FTAjhDocNo, positive lineNo, and FTPdtCode." };
    }
    const columns = [
      "branch_code",
      "doc_no",
      "line_no",
      "product_code",
      "barcode",
      "qty",
      "qty_base",
      "stock_factor",
      "unit_code",
      "lot_no",
      "expiry_date",
      "reason_code",
      "reference_doc_no",
      "source_system",
      "source_table",
      "source_synced_at",
      "raw_payload",
      "updated_at",
    ];
    return {
      columns,
      values: [
        branchCode,
        docNo,
        lineNo,
        productCode,
        normalizeNullableText(pick(record, ["FTAjdBarCode", "barcode"])),
        toNumber(pick(record, ["FCAjdQty", "qty"])),
        toNumber(pick(record, ["qtyBase"])),
        toNumber(pick(record, ["FCAjdStkFac", "stockFactor"])),
        normalizeNullableText(pick(record, ["FTPunCode", "unitCode"])),
        normalizeNullableText(pick(record, ["FTAjdLotNo", "lotNo"])),
        parseDate(pick(record, ["FDAjdExpired", "expiryDate"])),
        normalizeNullableText(pick(record, ["FTAjdRsnCode", "reasonCode"])),
        normalizeNullableText(pick(record, ["FTAjdRefDocNo", "referenceDocNo"])),
        getSourceSystem(body),
        normalizeText(pick(record, ["sourceTable"], "TCNTPdtAjsDT")),
        getSourceSyncedAt(body),
        getRawPayload(record),
        new Date().toISOString(),
      ],
      updateAssignments: columns
        .filter((column) => !["branch_code", "doc_no", "line_no", "product_code", "updated_at"].includes(column))
        .map((column) => `${column} = EXCLUDED.${column}`),
    };
  },
  "(branch_code, doc_no, line_no, product_code)",
);

async function upsertStockSnapshot(client, body, record) {
  const productCode = normalizeNullableText(pick(record, ["FTPdtCode", "productCode"]));
  const snapshotAt = parseTimestamp(pick(record, ["snapshotAt", "sourceSnapshotAt"]), getSourceSyncedAt(body));
  if (!productCode || !snapshotAt) {
    throw new Error("Each stock snapshot requires productCode/FTPdtCode and snapshotAt.");
  }
  const branchCode = normalizeNullableText(pick(record, ["FTBchCode", "branchCode"]));
  const warehouseCode = normalizeNullableText(pick(record, ["FTWahCode", "warehouseCode"]));
  const lotNo = normalizeNullableText(pick(record, ["FTLotNo", "lotNo"]));
  const expiryDate = parseDate(pick(record, ["FDExpired", "expiryDate"]));
  const snapshotKey = buildStockSnapshotKey(snapshotAt, branchCode, warehouseCode, productCode, lotNo, expiryDate);
  await client.query(
    `
      INSERT INTO ada.stock_snapshots
        (
          snapshot_key,
          snapshot_at,
          branch_code,
          warehouse_code,
          product_code,
          barcode,
          lot_no,
          expiry_date,
          qty_on_hand,
          qty_reserved,
          unit_code,
          qty_base,
          source_system,
          source_table,
          source_synced_at,
          raw_payload,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, now())
      ON CONFLICT (snapshot_key) DO UPDATE SET
        snapshot_at = EXCLUDED.snapshot_at,
        branch_code = EXCLUDED.branch_code,
        warehouse_code = EXCLUDED.warehouse_code,
        product_code = EXCLUDED.product_code,
        barcode = EXCLUDED.barcode,
        lot_no = EXCLUDED.lot_no,
        expiry_date = EXCLUDED.expiry_date,
        qty_on_hand = EXCLUDED.qty_on_hand,
        qty_reserved = EXCLUDED.qty_reserved,
        unit_code = EXCLUDED.unit_code,
        qty_base = EXCLUDED.qty_base,
        source_system = EXCLUDED.source_system,
        source_table = EXCLUDED.source_table,
        source_synced_at = EXCLUDED.source_synced_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
    `,
    [
      snapshotKey,
      snapshotAt,
      branchCode,
      warehouseCode,
      productCode,
      normalizeNullableText(pick(record, ["FTPdtBarCode", "barcode"])),
      lotNo,
      expiryDate,
      toNumber(pick(record, ["FCPdtQty", "qtyOnHand", "stockCurrent"])),
      toNumber(pick(record, ["FCPdtQtyRsv", "qtyReserved"])),
      normalizeNullableText(pick(record, ["FTPunCode", "unitCode"])),
      toNumber(pick(record, ["qtyBase"])),
      getSourceSystem(body),
      normalizeText(pick(record, ["sourceTable"], "TCNTPdtStkCard")),
      getSourceSyncedAt(body),
      getRawPayload(record),
    ],
  );
}

async function insertRunLog(db, body) {
  const result = await db.query(
    `
      INSERT INTO ada.sync_runs
        (
          source_system,
          source_location,
          agent_name,
          agent_version,
          sync_type,
          started_at,
          finished_at,
          status,
          records_read,
          records_sent,
          watermark_from,
          watermark_to,
          message,
          meta
        )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      RETURNING sync_run_id
    `,
    [
      getSourceSystem(body),
      normalizeNullableText(body?.sourceLocation),
      normalizeNullableText(body?.agentName),
      normalizeNullableText(body?.agentVersion),
      normalizeText(body?.syncType) || "manual",
      parseTimestamp(body?.startedAt, new Date().toISOString()),
      parseTimestamp(body?.finishedAt),
      normalizeText(body?.status) || "success",
      Math.max(0, Math.floor(toNumber(body?.recordsRead, 0) || 0)),
      Math.max(0, Math.floor(toNumber(body?.recordsSent, 0) || 0)),
      normalizeNullableText(body?.watermarkFrom),
      normalizeNullableText(body?.watermarkTo),
      normalizeNullableText(body?.message),
      JSON.stringify(body?.meta || {}),
    ],
  );

  if (String(body?.status || "").toLowerCase() === "failed") {
    await db.query(
      `
        INSERT INTO ada.sync_errors
          (sync_run_id, source_system, source_table, error_code, error_message, error_details)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        result.rows[0].sync_run_id,
        getSourceSystem(body),
        normalizeNullableText(body?.sourceTable),
        normalizeNullableText(body?.errorCode),
        normalizeText(body?.message) || "Sync failed.",
        JSON.stringify(body?.errorDetails || {}),
      ],
    );
  }

  return { accepted: 1, id: String(result.rows[0].sync_run_id) };
}

function createAdaSyncRouter(deps) {
  const { config, db } = deps;
  const router = express.Router();

  router.use((req, res, next) => {
    const apiKeyError = parseRequiredApiKey(config, req);
    if (apiKeyError) {
      return res.status(401).json({ message: apiKeyError });
    }
    return next();
  });

  function createRecordsHandler(upsertFn) {
    return async (req, res, next) => {
      const { error, records } = parseApiRecords(req.body);
      if (error) {
        return res.status(400).json({ message: error });
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        for (const record of records) {
          // eslint-disable-next-line no-await-in-loop
          await upsertFn(client, req.body, record);
        }
        await client.query("COMMIT");
        return res.json({ accepted: records.length, syncRunId: getSyncRunId(req.body) });
      } catch (e) {
        await client.query("ROLLBACK");
        return next(e);
      } finally {
        client.release();
      }
    };
  }

  router.post("/branches", createRecordsHandler(upsertBranch));
  router.post("/products", createRecordsHandler(upsertProduct));
  router.post("/sales", async (req, res, next) => {
    if (!req.body || !Array.isArray(req.body.headers) || !Array.isArray(req.body.lines)) {
      return res.status(400).json({ message: "Payload must include headers and lines arrays." });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of req.body.headers) {
        // eslint-disable-next-line no-await-in-loop
        await upsertSalesHeader(client, req.body, record);
      }
      for (const record of req.body.lines) {
        // eslint-disable-next-line no-await-in-loop
        await upsertSalesLine(client, req.body, record);
      }
      await client.query("COMMIT");
      return res.json({ acceptedHeaders: req.body.headers.length, acceptedLines: req.body.lines.length });
    } catch (e) {
      await client.query("ROLLBACK");
      return next(e);
    } finally {
      client.release();
    }
  });
  router.post("/purchases", async (req, res, next) => {
    if (!req.body || !Array.isArray(req.body.headers) || !Array.isArray(req.body.lines)) {
      return res.status(400).json({ message: "Payload must include headers and lines arrays." });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of req.body.headers) {
        // eslint-disable-next-line no-await-in-loop
        await upsertPurchaseHeader(client, req.body, record);
      }
      for (const record of req.body.lines) {
        // eslint-disable-next-line no-await-in-loop
        await upsertPurchaseLine(client, req.body, record);
      }
      await client.query("COMMIT");
      return res.json({ acceptedHeaders: req.body.headers.length, acceptedLines: req.body.lines.length });
    } catch (e) {
      await client.query("ROLLBACK");
      return next(e);
    } finally {
      client.release();
    }
  });
  router.post("/stock-adjustments", async (req, res, next) => {
    if (!req.body || !Array.isArray(req.body.headers) || !Array.isArray(req.body.lines)) {
      return res.status(400).json({ message: "Payload must include headers and lines arrays." });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of req.body.headers) {
        // eslint-disable-next-line no-await-in-loop
        await upsertStockAdjustmentHeader(client, req.body, record);
      }
      for (const record of req.body.lines) {
        // eslint-disable-next-line no-await-in-loop
        await upsertStockAdjustmentLine(client, req.body, record);
      }
      await client.query("COMMIT");
      return res.json({ acceptedHeaders: req.body.headers.length, acceptedLines: req.body.lines.length });
    } catch (e) {
      await client.query("ROLLBACK");
      return next(e);
    } finally {
      client.release();
    }
  });
  router.post("/stock-snapshots", createRecordsHandler(upsertStockSnapshot));
  router.post("/transfers", async (req, res, next) => {
    const { error, headers, lines } = parseTransferPayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const record of headers) {
        // eslint-disable-next-line no-await-in-loop
        await upsertTransferHeader(client, req.body, record);
      }
      for (const record of lines) {
        // eslint-disable-next-line no-await-in-loop
        await upsertTransferLine(client, req.body, record);
      }
      await client.query("COMMIT");
      return res.json({ acceptedHeaders: headers.length, acceptedLines: lines.length });
    } catch (e) {
      await client.query("ROLLBACK");
      return next(e);
    } finally {
      client.release();
    }
  });

  router.post("/run-log", async (req, res, next) => {
    try {
      return res.json(await insertRunLog(db, req.body || {}));
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = {
  createAdaSyncRouter,
};
