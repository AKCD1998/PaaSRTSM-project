#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { parseAdaPosExcelDataOnly } = require("./import_adapos_excel_dataonly");

const PRICE_CURRENCY = "THB";
const SOURCE_TAG = "adapos_excel_dataonly";
const UNIT_TIER_MIN = 2;
const UNIT_TIER_MAX = 8;
const WHOLESALE_OPTIONAL_START = 2; // C..J => optional D..J, wholesale mapped from F..J
const WHOLESALE_TIERS = 5;
const PREVIEW_LIMIT = 20;

function usage() {
  return [
    "Usage:",
    "  node scripts/import_adapos_prices_from_excel_dataonly.js --file <xlsPath> [--commit] [--json-out <path>] [--limit N] [--check] [--db-url <url>]",
    "",
    "Behavior:",
    "  - Dry-run by default (no DB writes)",
    "  - --commit writes in one transaction",
    "  - Always writes logs/price_import_YYYYMMDD_HHMMSS.json",
  ].join("\n");
}

function parseCliArgs(argv) {
  const args = {
    file: "",
    commit: false,
    jsonOut: "",
    limit: null,
    check: false,
    dbUrl: process.env.DATABASE_URL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[++i] || "";
    } else if (token === "--commit") {
      args.commit = true;
    } else if (token === "--json-out") {
      args.jsonOut = argv[++i] || "";
    } else if (token === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = value;
    } else if (token === "--check") {
      args.check = true;
    } else if (token === "--db-url") {
      args.dbUrl = argv[++i] || "";
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function normalizeText(value) {
  return String(value == null ? "" : value)
    .replace(/\uFEFF/g, "")
    .trim();
}

function normalizeUnit(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function numberOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = normalizeText(value).replace(/,/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) {
    return null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function almostEqual(a, b) {
  return Number(a) === Number(b);
}

function unitHasImportablePrice(unitEntry) {
  const values = [
    numberOrNull(unitEntry.retail_tier_1),
    ...((unitEntry.retail_tiers_optional || []).map(numberOrNull)),
  ];
  const hasProvided = values.some((value) => value !== null);
  const hasNonZero = values.some((value) => value !== null && value !== 0);
  if (!hasProvided) {
    return false;
  }
  if (!hasNonZero) {
    return false;
  }
  return true;
}

function extractWholesaleTiers(unitEntry) {
  const optional = (unitEntry.retail_tiers_optional || []).map(numberOrNull);
  const source = optional.slice(WHOLESALE_OPTIONAL_START, WHOLESALE_OPTIONAL_START + WHOLESALE_TIERS);
  const tiers = [];
  for (let i = 0; i < WHOLESALE_TIERS; i += 1) {
    tiers.push({
      tier: i + 1,
      value: source[i] == null ? null : source[i],
    });
  }
  return tiers;
}

function extractUnitPriceTiers(unitEntry) {
  const optional = (unitEntry.retail_tiers_optional || []).map(numberOrNull);
  const tiers = [];
  for (let tier = UNIT_TIER_MIN; tier <= UNIT_TIER_MAX; tier += 1) {
    const idx = tier - UNIT_TIER_MIN;
    tiers.push({
      tier,
      value: optional[idx] == null ? null : optional[idx],
    });
  }
  return tiers;
}

function collectIncomingBarcodes(units) {
  const out = [];
  const seen = new Set();
  for (const unitEntry of units || []) {
    const unit = normalizeUnit(unitEntry.unit);
    for (const barcodeEntry of unitEntry.barcodes || []) {
      const barcode = normalizeText(barcodeEntry.barcode).replace(/\s+/g, "");
      if (!barcode || seen.has(barcode)) {
        continue;
      }
      seen.add(barcode);
      out.push({
        barcode,
        unit,
        primary_by_unit: Boolean(barcodeEntry.primary),
      });
    }
  }
  return out;
}

function buildProductPlan(product) {
  const incomingBarcodes = collectIncomingBarcodes(product.units || []);
  const pricedUnits = [];
  let skippedNoPriceUnits = 0;

  for (const unitEntry of product.units || []) {
    const unit = normalizeUnit(unitEntry.unit);
    if (!unit) {
      continue;
    }
    if (!unitHasImportablePrice(unitEntry)) {
      skippedNoPriceUnits += 1;
      continue;
    }
    pricedUnits.push({
      unit,
      retail_tier_1: numberOrNull(unitEntry.retail_tier_1),
      retail_tiers_optional: [...(unitEntry.retail_tiers_optional || [])].map(numberOrNull),
      unit_price_tiers: extractUnitPriceTiers(unitEntry),
      wholesale_tiers: extractWholesaleTiers(unitEntry),
    });
  }

  let price_skip_reason = "";
  if (pricedUnits.length === 0) {
    price_skip_reason = "no_price_data";
  }
  const legacy_selected_unit = pricedUnits[0] || null;

  return {
    product_code: normalizeText(product.product_code),
    product_name: normalizeText(product.product_name),
    category: normalizeText(product.category),
    avg_cost: numberOrNull(product.avg_cost),
    supplier_code: normalizeText(product.supplier_code),
    updated_at: product.updated_at || null,
    units_total: (product.units || []).length,
    units_with_price_data: pricedUnits.length,
    skipped_no_price_units: skippedNoPriceUnits,
    priced_units: pricedUnits,
    legacy_selected_unit,
    price_skip_reason,
    incoming_barcodes: incomingBarcodes,
  };
}

function planRetailChange(existingRetailPrice, incomingRetailPrice) {
  const incoming = numberOrNull(incomingRetailPrice);
  const existing = numberOrNull(existingRetailPrice);
  if (incoming === null) {
    return { action: "skip", old_price: existing, new_price: null };
  }
  if (existing === null) {
    return { action: "insert", old_price: null, new_price: incoming };
  }
  if (almostEqual(existing, incoming)) {
    return { action: "unchanged", old_price: existing, new_price: incoming };
  }
  return { action: "update", old_price: existing, new_price: incoming };
}

function planWholesaleChanges(existingTierMap, incomingWholesaleTiers) {
  const changes = [];
  const existing = existingTierMap || new Map();
  for (const entry of incomingWholesaleTiers || []) {
    if (entry.value === null) {
      continue;
    }
    const oldValue = existing.has(entry.tier) ? numberOrNull(existing.get(entry.tier)) : null;
    if (oldValue === null) {
      changes.push({ tier: entry.tier, action: "insert", old_price: null, new_price: entry.value });
    } else if (almostEqual(oldValue, entry.value)) {
      changes.push({ tier: entry.tier, action: "unchanged", old_price: oldValue, new_price: entry.value });
    } else {
      changes.push({ tier: entry.tier, action: "update", old_price: oldValue, new_price: entry.value });
    }
  }
  return changes;
}

function planUnitTierChanges(existingTierMap, incomingUnitTiers) {
  const changes = [];
  const existing = existingTierMap || new Map();
  for (const entry of incomingUnitTiers || []) {
    if (entry.value === null) {
      continue;
    }
    const oldValue = existing.has(entry.tier) ? numberOrNull(existing.get(entry.tier)) : null;
    if (oldValue === null) {
      changes.push({ tier: entry.tier, action: "insert", old_price: null, new_price: entry.value });
    } else if (almostEqual(oldValue, entry.value)) {
      changes.push({ tier: entry.tier, action: "unchanged", old_price: oldValue, new_price: entry.value });
    } else {
      changes.push({ tier: entry.tier, action: "update", old_price: oldValue, new_price: entry.value });
    }
  }
  return changes;
}

function planBarcodeChanges(currentSkuState, globalOwners, skuId, incomingBarcodes) {
  const skuState = currentSkuState || {
    by_barcode: new Set(),
    has_primary: false,
  };
  const owners = globalOwners || new Map();
  const result = {
    inserts: [],
    existing: [],
    conflicts: [],
    primary_to_set: "",
  };

  for (const entry of incomingBarcodes || []) {
    const owner = owners.get(entry.barcode);
    if (owner != null && Number(owner) !== Number(skuId)) {
      result.conflicts.push(entry);
      continue;
    }
    if (skuState.by_barcode.has(entry.barcode)) {
      result.existing.push(entry);
      continue;
    }
    result.inserts.push(entry);
  }

  const primaryCandidate = (incomingBarcodes || []).find((entry) => entry.primary_by_unit) || (incomingBarcodes || [])[0];
  if (!skuState.has_primary && primaryCandidate) {
    const owner = owners.get(primaryCandidate.barcode);
    if (owner == null || Number(owner) === Number(skuId)) {
      result.primary_to_set = primaryCandidate.barcode;
    }
  }

  return result;
}

function dbConfigFromUrl(dbUrl) {
  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (dbUrl.includes("sslmode=require") || sslMode === "require") {
    return {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    };
  }
  return { connectionString: dbUrl };
}

function ensureUnique(list) {
  return [...new Set(list.filter(Boolean))];
}

async function loadSkuMap(client, productCodes) {
  const codes = ensureUnique(productCodes);
  if (codes.length === 0) {
    return new Map();
  }
  const query = `
    SELECT sku_id, company_code
    FROM public.skus
    WHERE company_code = ANY($1::text[])
  `;
  const result = await client.query(query, [codes]);
  return new Map(result.rows.map((row) => [row.company_code, Number(row.sku_id)]));
}

async function loadActiveRetailMap(client, skuIds) {
  const ids = ensureUnique(skuIds);
  if (ids.length === 0) {
    return new Map();
  }
  const query = `
    SELECT DISTINCT ON (sku_id)
      sku_id,
      price_id,
      price
    FROM public.prices
    WHERE sku_id = ANY($1::int[])
      AND currency = $2
      AND effective_end IS NULL
    ORDER BY sku_id, effective_start DESC NULLS LAST, price_id DESC
  `;
  const result = await client.query(query, [ids, PRICE_CURRENCY]);
  const out = new Map();
  for (const row of result.rows) {
    out.set(Number(row.sku_id), {
      price_id: Number(row.price_id),
      price: numberOrNull(row.price),
    });
  }
  return out;
}

async function loadWholesaleTierMap(client, skuIds) {
  const ids = ensureUnique(skuIds);
  if (ids.length === 0) {
    return new Map();
  }
  const query = `
    SELECT sku_id, tier, price
    FROM public.sku_price_tiers
    WHERE sku_id = ANY($1::int[])
      AND price_kind = 'wholesale'
  `;
  const result = await client.query(query, [ids]);
  const out = new Map();
  for (const row of result.rows) {
    const skuId = Number(row.sku_id);
    if (!out.has(skuId)) {
      out.set(skuId, new Map());
    }
    out.get(skuId).set(Number(row.tier), numberOrNull(row.price));
  }
  return out;
}

async function loadUnitPriceState(client, skuIds) {
  const ids = ensureUnique(skuIds);
  if (ids.length === 0) {
    return new Map();
  }
  const query = `
    SELECT
      up.id AS sku_unit_price_id,
      up.sku_id,
      up.unit,
      up.retail_price,
      ut.tier,
      ut.price AS tier_price
    FROM public.sku_unit_prices up
    LEFT JOIN public.sku_unit_price_tiers ut
      ON ut.sku_unit_price_id = up.id
    WHERE up.sku_id = ANY($1::int[])
      AND up.currency = $2
      AND up.is_active = TRUE
  `;
  const result = await client.query(query, [ids, PRICE_CURRENCY]);
  const out = new Map();
  for (const row of result.rows) {
    const key = `${Number(row.sku_id)}|${normalizeUnit(row.unit)}`;
    if (!out.has(key)) {
      out.set(key, {
        sku_unit_price_id: Number(row.sku_unit_price_id),
        retail_price: numberOrNull(row.retail_price),
        tiers: new Map(),
      });
    }
    if (row.tier != null) {
      out.get(key).tiers.set(Number(row.tier), numberOrNull(row.tier_price));
    }
  }
  return out;
}

async function loadBarcodeState(client, skuIds, incomingBarcodes) {
  const ids = ensureUnique(skuIds);
  const barcodeList = ensureUnique(incomingBarcodes);

  const bySku = new Map();
  if (ids.length > 0) {
    const query = `
      SELECT sku_id, barcode, is_primary
      FROM public.barcodes
      WHERE sku_id = ANY($1::int[])
    `;
    const result = await client.query(query, [ids]);
    for (const row of result.rows) {
      const skuId = Number(row.sku_id);
      if (!bySku.has(skuId)) {
        bySku.set(skuId, {
          by_barcode: new Set(),
          has_primary: false,
        });
      }
      const state = bySku.get(skuId);
      state.by_barcode.add(String(row.barcode));
      if (row.is_primary === true) {
        state.has_primary = true;
      }
    }
  }

  const owners = new Map();
  if (barcodeList.length > 0) {
    const ownerQuery = `
      SELECT barcode, sku_id
      FROM public.barcodes
      WHERE barcode = ANY($1::text[])
    `;
    const ownerResult = await client.query(ownerQuery, [barcodeList]);
    for (const row of ownerResult.rows) {
      owners.set(String(row.barcode), Number(row.sku_id));
    }
  }

  return { bySku, owners };
}

function buildImportPlan(productPlans, dbState) {
  const skuMap = dbState.skuMap || new Map();
  const retailMap = dbState.retailMap || new Map();
  const wholesaleMap = dbState.wholesaleMap || new Map();
  const unitPriceStateMap = dbState.unitPriceState || new Map();
  const barcodeStateBySku = dbState.barcodeState?.bySku || new Map();
  const barcodeOwners = dbState.barcodeState?.owners || new Map();

  const summary = {
    products_processed: productPlans.length,
    sku_found: 0,
    missing_sku: 0,
    units_processed: 0,
    unit_price_rows_planned_updates: 0,
    unit_price_tiers_planned_updates: 0,
    legacy_price_rows_planned_updates: 0,
    legacy_wholesale_rows_planned_updates: 0,
    price_rows_planned_updates: 0,
    price_rows_applied_updates: 0,
    barcodes_new: 0,
    barcodes_existing: 0,
    barcodes_conflicts: 0,
    skipped_no_price: 0,
    skipped_ambiguous_unit_prices: 0,
    errors: 0,
  };

  const changes = [];

  for (const product of productPlans) {
    summary.units_processed += product.units_total;
    const skuId = skuMap.get(product.product_code) || null;
    if (!skuId) {
      summary.missing_sku += 1;
      changes.push({
        product_code: product.product_code,
        sku_id: null,
        unit: "-",
        status: "missing_sku",
        changed_tiers_count: 0,
      });
      continue;
    }
    summary.sku_found += 1;

    const retailState = retailMap.get(skuId) || { price_id: null, price: null };
    const wholesaleState = wholesaleMap.get(skuId) || new Map();
    const barcodeState = barcodeStateBySku.get(skuId) || {
      by_barcode: new Set(),
      has_primary: false,
    };
    const barcodePlan = planBarcodeChanges(barcodeState, barcodeOwners, skuId, product.incoming_barcodes);
    summary.barcodes_new += barcodePlan.inserts.length;
    summary.barcodes_existing += barcodePlan.existing.length;
    summary.barcodes_conflicts += barcodePlan.conflicts.length;

    if (product.price_skip_reason === "no_price_data") {
      summary.skipped_no_price += 1;
      changes.push({
        product_code: product.product_code,
        sku_id: skuId,
        unit: "-",
        status: "skipped_no_price",
        changed_tiers_count: 0,
        barcode_changes: {
          inserts: barcodePlan.inserts,
          existing: barcodePlan.existing.length,
          conflicts: barcodePlan.conflicts,
          primary_to_set: barcodePlan.primary_to_set || "",
        },
      });
      continue;
    }

    const unitChanges = [];
    let changedTierCount = 0;
    for (const pricedUnit of product.priced_units) {
      const unitStateKey = `${skuId}|${normalizeUnit(pricedUnit.unit)}`;
      const unitState = unitPriceStateMap.get(unitStateKey) || {
        sku_unit_price_id: null,
        retail_price: null,
        tiers: new Map(),
      };
      const unitRetailPlan = planRetailChange(unitState.retail_price, pricedUnit.retail_tier_1);
      const unitTierPlans = planUnitTierChanges(unitState.tiers, pricedUnit.unit_price_tiers);
      const changedUnitTiers = unitTierPlans.filter((entry) => entry.action === "insert" || entry.action === "update");
      const unitRetailChanged = unitRetailPlan.action === "insert" || unitRetailPlan.action === "update";
      if (unitRetailChanged) {
        summary.unit_price_rows_planned_updates += 1;
      }
      summary.unit_price_tiers_planned_updates += changedUnitTiers.length;
      changedTierCount += (unitRetailChanged ? 1 : 0) + changedUnitTiers.length;

      unitChanges.push({
        sku_unit_price_id: unitState.sku_unit_price_id,
        unit: pricedUnit.unit,
        retail: unitRetailPlan,
        tiers: unitTierPlans,
        source_updated_at: product.updated_at || null,
      });
    }

    const legacy = product.legacy_selected_unit || null;
    let legacyUpdate = null;
    if (legacy) {
      const retailPlan = planRetailChange(retailState.price, legacy.retail_tier_1);
      const wholesalePlans = planWholesaleChanges(wholesaleState, legacy.wholesale_tiers);
      const changedWholesale = wholesalePlans.filter((entry) => entry.action === "insert" || entry.action === "update");
      const legacyRetailChanged = retailPlan.action === "insert" || retailPlan.action === "update";
      if (legacyRetailChanged) {
        summary.legacy_price_rows_planned_updates += 1;
      }
      summary.legacy_wholesale_rows_planned_updates += changedWholesale.length;
      changedTierCount += (legacyRetailChanged ? 1 : 0) + changedWholesale.length;

      legacyUpdate = {
        unit: legacy.unit,
        retail: {
          ...retailPlan,
          price_id: retailState.price_id,
        },
        wholesale: wholesalePlans,
      };
    }

    summary.price_rows_planned_updates =
      summary.unit_price_rows_planned_updates +
      summary.unit_price_tiers_planned_updates +
      summary.legacy_price_rows_planned_updates +
      summary.legacy_wholesale_rows_planned_updates;

    const previewUnit = unitChanges[0] || null;

    changes.push({
      product_code: product.product_code,
      sku_id: skuId,
      unit: previewUnit ? previewUnit.unit : "-",
      status: "planned",
      retail: previewUnit ? previewUnit.retail : { action: "skip", old_price: null, new_price: null },
      wholesale: legacyUpdate ? legacyUpdate.wholesale : [],
      unit_changes: unitChanges,
      legacy_update: legacyUpdate,
      changed_tiers_count: changedTierCount,
      barcode_changes: {
        inserts: barcodePlan.inserts,
        existing: barcodePlan.existing.length,
        conflicts: barcodePlan.conflicts,
        primary_to_set: barcodePlan.primary_to_set || "",
      },
      source_updated_at: product.updated_at || null,
    });
  }

  return {
    summary,
    changes,
  };
}

async function applyChanges(client, plan) {
  let appliedRows = 0;
  for (const change of plan.changes) {
    if (change.status !== "planned") {
      continue;
    }

    const skuId = change.sku_id;

    for (const unitChange of change.unit_changes || []) {
      const upsertUnit = `
        INSERT INTO public.sku_unit_prices AS tgt (
          sku_id,
          unit,
          retail_price,
          currency,
          is_active,
          source,
          source_updated_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, TRUE, $5, $6, now())
        ON CONFLICT (sku_id, unit, currency)
        DO UPDATE SET
          retail_price = COALESCE(EXCLUDED.retail_price, tgt.retail_price),
          is_active = TRUE,
          source = EXCLUDED.source,
          source_updated_at = COALESCE(EXCLUDED.source_updated_at, tgt.source_updated_at),
          updated_at = now()
        RETURNING id
      `;
      const unitResult = await client.query(upsertUnit, [
        skuId,
        unitChange.unit,
        unitChange.retail.new_price,
        PRICE_CURRENCY,
        SOURCE_TAG,
        unitChange.source_updated_at,
      ]);
      const skuUnitPriceId = Number(unitResult.rows[0].id);
      const unitRetailChanged = unitChange.retail.action === "insert" || unitChange.retail.action === "update";
      if (unitRetailChanged) {
        appliedRows += 1;
      }

      for (const tierPlan of unitChange.tiers || []) {
        if (!(tierPlan.action === "insert" || tierPlan.action === "update")) {
          continue;
        }
        const upsertUnitTier = `
          INSERT INTO public.sku_unit_price_tiers (
            sku_unit_price_id, tier, price, is_active, updated_at
          )
          VALUES ($1, $2, $3, TRUE, now())
          ON CONFLICT (sku_unit_price_id, tier)
          DO UPDATE SET
            price = EXCLUDED.price,
            is_active = TRUE,
            updated_at = now()
        `;
        await client.query(upsertUnitTier, [skuUnitPriceId, tierPlan.tier, tierPlan.new_price]);
        appliedRows += 1;
      }
    }

    if (change.legacy_update) {
      const legacyRetail = change.legacy_update.retail;
      if (legacyRetail.action === "insert") {
        const insertRetail = `
          INSERT INTO public.prices (
            sku_id, price, currency, effective_start, effective_end, updated_at
          )
          VALUES ($1, $2, $3, now(), NULL, now())
        `;
        await client.query(insertRetail, [skuId, legacyRetail.new_price, PRICE_CURRENCY]);
        appliedRows += 1;
      } else if (legacyRetail.action === "update") {
        if (legacyRetail.price_id) {
          const updateById = `
            UPDATE public.prices
            SET
              price = $1,
              updated_at = now(),
              effective_start = COALESCE(effective_start, now()),
              effective_end = NULL
            WHERE price_id = $2
          `;
          await client.query(updateById, [legacyRetail.new_price, legacyRetail.price_id]);
        } else {
          const updateActive = `
            UPDATE public.prices
            SET
              price = $1,
              updated_at = now(),
              effective_start = COALESCE(effective_start, now()),
              effective_end = NULL
            WHERE sku_id = $2
              AND currency = $3
              AND effective_end IS NULL
          `;
          await client.query(updateActive, [legacyRetail.new_price, skuId, PRICE_CURRENCY]);
        }
        appliedRows += 1;
      }

      for (const tierPlan of change.legacy_update.wholesale || []) {
        if (!(tierPlan.action === "insert" || tierPlan.action === "update")) {
          continue;
        }
        const upsertTier = `
          INSERT INTO public.sku_price_tiers (
            sku_id, price_kind, tier, price, currency, is_active, updated_at
          )
          VALUES ($1, 'wholesale', $2, $3, $4, TRUE, now())
          ON CONFLICT (sku_id, price_kind, tier)
          DO UPDATE SET
            price = EXCLUDED.price,
            currency = EXCLUDED.currency,
            is_active = TRUE,
            updated_at = now()
        `;
        await client.query(upsertTier, [skuId, tierPlan.tier, tierPlan.new_price, PRICE_CURRENCY]);
        appliedRows += 1;
      }
    }

    for (const barcodeEntry of change.barcode_changes.inserts || []) {
      const isPrimary = change.barcode_changes.primary_to_set === barcodeEntry.barcode;
      const insertBarcode = `
        INSERT INTO public.barcodes (barcode, sku_id, is_primary, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (barcode) DO NOTHING
      `;
      await client.query(insertBarcode, [barcodeEntry.barcode, skuId, isPrimary]);
    }

    if (change.barcode_changes.primary_to_set) {
      const setPrimary = `
        UPDATE public.barcodes
        SET is_primary = TRUE, updated_at = now()
        WHERE sku_id = $1
          AND barcode = $2
      `;
      await client.query(setPrimary, [skuId, change.barcode_changes.primary_to_set]);
    }
  }

  return appliedRows;
}

function formatPriceArrow(oldPrice, newPrice) {
  const oldText = oldPrice == null ? "-" : String(oldPrice);
  const newText = newPrice == null ? "-" : String(newPrice);
  return `${oldText} -> ${newText}`;
}

function printDryRunPreview(plan) {
  console.log("Dry-run planned updates (top 20):");
  console.log("sku_code | unit | retail_tier_1 old->new | changed_tiers_count");
  let printed = 0;
  for (const change of plan.changes) {
    if (printed >= PREVIEW_LIMIT) {
      break;
    }
    if (change.status !== "planned") {
      continue;
    }
    console.log(
      `${change.product_code} | ${change.unit || "-"} | ${formatPriceArrow(change.retail.old_price, change.retail.new_price)} | ${change.changed_tiers_count}`,
    );
    printed += 1;
  }
  if (printed === 0) {
    console.log("(no price updates planned)");
  }
}

function makeTimestampForFile(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function ensureLogDir() {
  const dir = path.join(process.cwd(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeLogFile(payload) {
  const dir = ensureLogDir();
  const filePath = path.join(dir, `price_import_${makeTimestampForFile()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

async function loadDbState(client, productPlans) {
  const skuMap = await loadSkuMap(
    client,
    productPlans.map((plan) => plan.product_code),
  );
  const skuIds = [...skuMap.values()];
  const incomingBarcodes = productPlans.flatMap((plan) =>
    plan.incoming_barcodes.map((entry) => entry.barcode),
  );

  let retailMap = null;
  let wholesaleMap = null;
  let unitPriceState = null;
  let barcodeState = null;
  try {
    [retailMap, wholesaleMap, unitPriceState, barcodeState] = await Promise.all([
      loadActiveRetailMap(client, skuIds),
      loadWholesaleTierMap(client, skuIds),
      loadUnitPriceState(client, skuIds),
      loadBarcodeState(client, skuIds, incomingBarcodes),
    ]);
  } catch (error) {
    if (error && error.code === "42P01") {
      throw new Error(
        `Required unit-price tables are missing. Run migration migrations/011_add_sku_unit_prices.sql first. Original error: ${error.message}`,
      );
    }
    throw error;
  }

  return {
    skuMap,
    retailMap,
    wholesaleMap,
    unitPriceState,
    barcodeState,
  };
}

function buildCheckSummary(parsedResult) {
  return {
    products_processed: parsedResult.products.length,
    units_processed: parsedResult.products.reduce((sum, product) => sum + (product.units || []).length, 0),
    barcodes_processed: parsedResult.products.reduce(
      (sum, product) =>
        sum +
        (product.units || []).reduce((unitSum, unit) => unitSum + (unit.barcodes || []).length, 0),
      0,
    ),
    products_with_meta: parsedResult.products.filter(
      (product) => product.avg_cost !== null || product.supplier_code || product.updated_at,
    ).length,
  };
}

async function runImport(options) {
  if (!options.file) {
    throw new Error("Missing --file");
  }
  if (!fs.existsSync(options.file)) {
    throw new Error(`File not found: ${options.file}`);
  }

  const parsed = await parseAdaPosExcelDataOnly({
    file: options.file,
    limit: options.limit,
    strict: true,
  });

  const productPlans = parsed.products.map(buildProductPlan);

  if (options.check) {
    const checkSummary = buildCheckSummary(parsed);
    return {
      mode: "check",
      parser_summary: parsed.summary,
      summary: checkSummary,
      plan: { summary: checkSummary, changes: [] },
      product_plans: productPlans,
    };
  }

  if (!options.dbUrl) {
    throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");
  }

  const client = new Client(dbConfigFromUrl(options.dbUrl));
  await client.connect();

  try {
    const dbState = await loadDbState(client, productPlans);
    const plan = buildImportPlan(productPlans, dbState);

    if (options.commit) {
      await client.query("BEGIN");
      try {
        const appliedRows = await applyChanges(client, plan);
        await client.query("COMMIT");
        plan.summary.price_rows_applied_updates = appliedRows;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return {
      mode: options.commit ? "commit" : "dry-run",
      parser_summary: parsed.summary,
      summary: plan.summary,
      plan,
      product_plans: productPlans,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  let result = null;
  let errorMessage = "";
  try {
    result = await runImport(args);
  } catch (error) {
    errorMessage = error.message;
  }

  const payload = {
    run_at: new Date().toISOString(),
    source: SOURCE_TAG,
    mode: args.check ? "check" : args.commit ? "commit" : "dry-run",
    file: args.file,
    options: {
      limit: args.limit || null,
      commit: args.commit,
      check: args.check,
    },
    parser_summary: result ? result.parser_summary : null,
    summary: result ? result.summary : null,
    top_changes: result ? result.plan.changes.slice(0, PREVIEW_LIMIT) : [],
    changes: result ? result.plan.changes : [],
    error: errorMessage || null,
  };

  const logFile = writeLogFile(payload);
  if (args.jsonOut) {
    fs.writeFileSync(args.jsonOut, JSON.stringify(payload, null, 2));
  }

  if (errorMessage) {
    console.error(`Import failed: ${errorMessage}`);
    console.error(`Log file: ${logFile}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Mode: ${payload.mode.toUpperCase()}`);
  console.log(JSON.stringify(result.summary, null, 2));
  if (!args.check) {
    printDryRunPreview(result.plan);
  }
  console.log(`Log file: ${logFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  normalizeUnit,
  unitHasImportablePrice,
  extractWholesaleTiers,
  collectIncomingBarcodes,
  buildProductPlan,
  planRetailChange,
  planUnitTierChanges,
  planWholesaleChanges,
  planBarcodeChanges,
  buildImportPlan,
  runImport,
};
