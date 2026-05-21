"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAdaFoundationDerivation } = require("../apps/admin-api/src/services/ada-derivation");

function createFoundationDb() {
  const state = {
    nextItemId: 2,
    rawBranches: [
      {
        ada_branch_id: 1,
        branch_code: "000",
        branch_name: "HQ Old",
        branch_name_th: "สำนักงานใหญ่เดิม",
        branch_status: "1",
        source_system: "AdaAcc",
        source_table: "TCNMBranch",
        source_synced_at: "2026-05-20T00:00:00.000Z",
      },
      {
        ada_branch_id: 2,
        branch_code: "000",
        branch_name: "HQ Latest",
        branch_name_th: "สำนักงานใหญ่",
        branch_status: "1",
        source_system: "AdaAcc",
        source_table: "TCNMBranch",
        source_synced_at: "2026-05-21T00:00:00.000Z",
      },
      {
        ada_branch_id: 3,
        branch_code: "101",
        branch_name: "Branch 101",
        branch_name_th: "สาขา 101",
        branch_status: "0",
        source_system: "AdaAcc",
        source_table: "TCNMBranch",
        source_synced_at: "2026-05-21T00:00:00.000Z",
      },
    ],
    rawProducts: [
      {
        ada_product_id: 1,
        product_code: "P001",
        product_name: "Old Product",
        product_name_th: null,
        category_name: "Medicine",
        supplier_code: "SUP-OLD",
        unit_small: "BOX",
        min_stock: 1,
        max_stock: 10,
        lead_time_days: 3,
        is_active: "1",
        source_system: "AdaAcc",
        source_table: "TCNMPdt",
        source_synced_at: "2026-05-20T00:00:00.000Z",
      },
      {
        ada_product_id: 2,
        product_code: "P001",
        product_name: "New Product",
        product_name_th: null,
        category_name: "OTC",
        supplier_code: "SUP-NEW",
        unit_small: "TAB",
        min_stock: 2,
        max_stock: 20,
        lead_time_days: 5,
        is_active: "1",
        source_system: "AdaAcc",
        source_table: "TCNMPdt",
        source_synced_at: "2026-05-21T00:00:00.000Z",
      },
      {
        ada_product_id: 3,
        product_code: "P002",
        product_name: "Inserted Product",
        product_name_th: null,
        category_name: "Device",
        supplier_code: "SUP-02",
        unit_small: null,
        min_stock: null,
        max_stock: null,
        lead_time_days: null,
        is_active: "0",
        source_system: "AdaAcc",
        source_table: "TCNMPdt",
        source_synced_at: "2026-05-21T00:00:00.000Z",
      },
    ],
    rawBarcodes: [
      {
        ada_product_barcode_id: 1,
        product_code: "P001",
        barcode: "111",
        barcode_role: "primary",
        source_synced_at: "2026-05-21T00:00:00.000Z",
      },
      {
        ada_product_barcode_id: 2,
        product_code: "P001",
        barcode: "222",
        barcode_role: "secondary",
        source_synced_at: "2026-05-21T00:00:00.000Z",
      },
      {
        ada_product_barcode_id: 3,
        product_code: "P002",
        barcode: "333",
        barcode_role: "primary",
        source_synced_at: "2026-05-21T00:00:00.000Z",
      },
    ],
    coreBranches: new Map([
      [
        "000",
        {
          branch_code: "000",
          branch_name: "Outdated HQ",
          is_hq: true,
          is_active: true,
        },
      ],
    ]),
    items: new Map([
      [
        "P001",
        {
          item_id: 1,
          source_company_code: "P001",
          generic_name: "P001",
          display_name: "Stale Item",
          category_name: "Legacy",
          supplier_code: "SUP-OLD",
          product_kind: "medicine",
          is_active: true,
        },
      ],
    ]),
    skus: new Map([
      [
        "P001",
        {
          sku_id: 10,
          item_id: 1,
          company_code: "P001",
          display_name: "Stale SKU",
          uom: "EA",
          qty_in_base: 1,
          pack_level: "base",
          status: "0",
          category_name: "Legacy",
          supplier_code: "SUP-OLD",
          min_stock: 0,
          max_stock: 0,
          lead_time_days: 0,
        },
      ],
    ]),
    barcodes: new Map([
      ["111", { barcode: "111", sku_id: 999, is_primary: false }],
      ["stale", { barcode: "stale", sku_id: 10, is_primary: false }],
    ]),
  };

  return {
    state,
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
      if (!normalized.includes("from ada.refresh_foundations()")) {
        throw new Error(`Unhandled query in derivation test: ${normalized}`);
      }

      const latestBranches = new Map();
      for (const branch of [...state.rawBranches].sort(compareLatest("branch_code", "ada_branch_id"))) {
        if (!latestBranches.has(branch.branch_code)) {
          latestBranches.set(branch.branch_code, branch);
        }
      }

      for (const branch of latestBranches.values()) {
        state.coreBranches.set(branch.branch_code, {
          branch_code: branch.branch_code,
          branch_name: branch.branch_name || branch.branch_name_th || branch.branch_code,
          is_hq: branch.branch_code === "000",
          is_active: !["0", "false", "f", "n", "inactive", "disabled"].includes(
            String(branch.branch_status || "1").toLowerCase(),
          ),
          source_system: branch.source_system,
          source_table: branch.source_table,
          source_synced_at: branch.source_synced_at,
        });
      }

      const latestProducts = new Map();
      for (const product of [...state.rawProducts].sort(compareLatest("product_code", "ada_product_id"))) {
        if (!latestProducts.has(product.product_code)) {
          latestProducts.set(product.product_code, product);
        }
      }

      let updatedItems = 0;
      let insertedItems = 0;
      for (const product of latestProducts.values()) {
        const existing = state.items.get(product.product_code);
        if (existing) {
          updatedItems += 1;
          state.items.set(product.product_code, {
            ...existing,
            generic_name: product.product_code,
            display_name: product.product_name || product.product_name_th || product.product_code,
            category_name: product.category_name,
            supplier_code: product.supplier_code,
            product_kind: existing.product_kind || "device_or_general_goods",
            is_active: !["0", "false", "f", "n", "inactive", "disabled"].includes(
              String(product.is_active || "1").toLowerCase(),
            ),
            source_company_code: product.product_code,
            source_updated_at: product.source_synced_at,
            source_updated_by: "ada.refresh_products_into_public",
          });
          continue;
        }

        insertedItems += 1;
        state.items.set(product.product_code, {
          item_id: state.nextItemId,
          generic_name: product.product_code,
          display_name: product.product_name || product.product_name_th || product.product_code,
          category_name: product.category_name,
          supplier_code: product.supplier_code,
          product_kind: "device_or_general_goods",
          is_active: !["0", "false", "f", "n", "inactive", "disabled"].includes(
            String(product.is_active || "1").toLowerCase(),
          ),
          source_company_code: product.product_code,
          source_updated_at: product.source_synced_at,
          source_updated_by: "ada.refresh_products_into_public",
        });
        state.nextItemId += 1;
      }

      for (const product of latestProducts.values()) {
        const item = state.items.get(product.product_code);
        const existingSku = state.skus.get(product.product_code);
        state.skus.set(product.product_code, {
          sku_id: existingSku ? existingSku.sku_id : state.skus.size + 10,
          item_id: item.item_id,
          company_code: product.product_code,
          uom: product.unit_small || "EA",
          qty_in_base: 1,
          pack_level: "base",
          display_name: product.product_name || product.product_name_th || product.product_code,
          status: product.is_active,
          category_name: product.category_name,
          supplier_code: product.supplier_code,
          min_stock: product.min_stock || 0,
          max_stock: product.max_stock || 0,
          lead_time_days: product.lead_time_days || 0,
          source_updated_at: product.source_synced_at,
          source_updated_by: "ada.refresh_products_into_public",
        });
      }

      const latestBarcodes = new Map();
      for (const row of [...state.rawBarcodes].sort(compareLatest(["product_code", "barcode"], "ada_product_barcode_id"))) {
        const key = `${row.product_code}|${row.barcode}`;
        if (!latestBarcodes.has(key)) {
          latestBarcodes.set(key, row);
        }
      }

      const managedSkuIds = new Set([...latestProducts.keys()].map((code) => state.skus.get(code).sku_id));
      let deletedBarcodes = 0;
      for (const [barcode, row] of [...state.barcodes.entries()]) {
        if (!managedSkuIds.has(row.sku_id)) {
          continue;
        }
        const productCode = [...state.skus.values()].find((sku) => sku.sku_id === row.sku_id)?.company_code;
        if (!latestBarcodes.has(`${productCode}|${barcode}`)) {
          state.barcodes.delete(barcode);
          deletedBarcodes += 1;
        }
      }

      for (const row of latestBarcodes.values()) {
        const sku = state.skus.get(row.product_code);
        state.barcodes.set(row.barcode, {
          barcode: row.barcode,
          sku_id: sku.sku_id,
          is_primary: row.barcode_role === "primary",
        });
      }

      return {
        rowCount: 6,
        rows: [
          { stage: "core.branches_upserted", affected_rows: latestBranches.size },
          { stage: "public.items_updated", affected_rows: updatedItems },
          { stage: "public.items_inserted", affected_rows: insertedItems },
          { stage: "public.skus_upserted", affected_rows: latestProducts.size },
          { stage: "public.barcodes_deleted", affected_rows: deletedBarcodes },
          { stage: "public.barcodes_upserted", affected_rows: latestBarcodes.size },
        ],
      };
    },
  };
}

function compareLatest(groupKeys, idKey) {
  const keys = Array.isArray(groupKeys) ? groupKeys : [groupKeys];
  return (a, b) => {
    for (const key of keys) {
      if (a[key] < b[key]) {
        return -1;
      }
      if (a[key] > b[key]) {
        return 1;
      }
    }
    if (a.source_synced_at > b.source_synced_at) {
      return -1;
    }
    if (a.source_synced_at < b.source_synced_at) {
      return 1;
    }
    return b[idKey] - a[idKey];
  };
}

test("runAdaFoundationDerivation rebuilds derived ADA foundations from the latest raw records", async () => {
  const db = createFoundationDb();

  const rows = await runAdaFoundationDerivation(db);

  assert.deepEqual(rows, [
    { stage: "core.branches_upserted", affectedRows: 2 },
    { stage: "public.items_updated", affectedRows: 1 },
    { stage: "public.items_inserted", affectedRows: 1 },
    { stage: "public.skus_upserted", affectedRows: 2 },
    { stage: "public.barcodes_deleted", affectedRows: 1 },
    { stage: "public.barcodes_upserted", affectedRows: 3 },
  ]);

  assert.equal(db.state.coreBranches.get("000").branch_name, "HQ Latest");
  assert.equal(db.state.coreBranches.get("101").is_active, false);

  assert.equal(db.state.items.get("P001").display_name, "New Product");
  assert.equal(db.state.items.get("P001").product_kind, "medicine");
  assert.equal(db.state.items.get("P002").product_kind, "device_or_general_goods");

  assert.equal(db.state.skus.get("P001").uom, "TAB");
  assert.equal(db.state.skus.get("P002").uom, "EA");

  assert.equal(db.state.barcodes.has("stale"), false);
  assert.equal(db.state.barcodes.get("111").sku_id, db.state.skus.get("P001").sku_id);
  assert.equal(db.state.barcodes.get("333").sku_id, db.state.skus.get("P002").sku_id);
});
