"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseExcelDataOnlyRows,
  classifyRow,
  buildUpdatedAt,
} = require("../scripts/import_adapos_excel_dataonly");

test("classifyRow follows header > detail > meta priority", () => {
  const header = classifyRow(["630010001", "สินค้า A", "เครื่องสำอางค์"]);
  assert.equal(header.kind, "header");
  assert.equal(header.product_code, "630010001");

  const detail = classifyRow(["8851743003658", "หลอด", "255", "245", "225"]);
  assert.equal(detail.kind, "detail");
  assert.equal(detail.barcode, "8851743003658");
  assert.equal(detail.unit, "หลอด");
  assert.equal(detail.retail_tier_1, 255);

  const meta = classifyRow(["192.93", "TT00001", "", "Admin", "45293", "14:06:38"]);
  assert.equal(meta.kind, "meta");
  assert.equal(meta.avg_cost, 192.93);
  assert.equal(meta.supplier_code, "TT00001");
});

test("parseExcelDataOnlyRows builds grouped structure with per-unit primary barcode", () => {
  const rows = [
    [],
    ["630010001", "สามัญ ฮีรูสการ์ซิลิโคนโปร 4 กรัม", ""],
    ["8851743003658", "หลอด", 255, 245, 225, 210, 210, 210, 210, 210],
    ["8851743004501", "ชิ้น", 255, 245, 225, 210, 210, 210, 210, 210],
    ["8851743009999", "ชิ้น", 255, 245, 225, 210, 210, 210, 210, 210],
    [192.93, "TT00001", "", "Admin", 45293, "14:06:38"],
    ["IC-000001", "ATK Test Kit", "อุปกรณ์การแพทย์"],
    ["8850099990001", "กล่อง", 39, 35, 34, 33, 33, 33, 33, 33],
    [95, "TT00001", "", "staff1", 45355, "18:08:54"],
  ];

  const parsed = parseExcelDataOnlyRows(rows, { strict: true });
  assert.equal(parsed.products.length, 2);

  const first = parsed.products[0];
  assert.equal(first.product_code, "630010001");
  assert.equal(first.product_name, "สามัญ ฮีรูสการ์ซิลิโคนโปร 4 กรัม");
  assert.equal(first.avg_cost, 192.93);
  assert.equal(first.supplier_code, "TT00001");
  assert.equal(first.updated_by, "Admin");
  assert.equal(first.updated_at, "2024-01-02T14:06:38+07:00");
  assert.equal(first.units.length, 2);

  const unitPiece = first.units.find((entry) => entry.unit === "ชิ้น");
  assert.ok(unitPiece);
  assert.equal(unitPiece.barcodes.length, 2);
  assert.deepEqual(unitPiece.barcodes[0], { barcode: "8851743004501", primary: true });
  assert.deepEqual(unitPiece.barcodes[1], { barcode: "8851743009999", primary: false });

  const second = parsed.products[1];
  assert.equal(second.product_code, "IC-000001");
  assert.equal(second.avg_cost, 95);
  assert.equal(second.supplier_code, "TT00001");
});

test("parseExcelDataOnlyRows throws on structure mismatch in strict mode", () => {
  const rows = [
    ["บริษัท เอสซี กรุ๊ป (1989) จำกัด"],
    ["รายงาน - รายละเอียดสินค้า"],
    ["จากรหัส : ถึงรหัส :"],
    [],
  ];

  assert.throws(
    () => parseExcelDataOnlyRows(rows, { strict: true }),
    /Structure mismatch:/,
  );
});

test("buildUpdatedAt converts excel serial + time to +07:00 timestamp", () => {
  assert.equal(buildUpdatedAt(45293, "14:06:38"), "2024-01-02T14:06:38+07:00");
  assert.equal(buildUpdatedAt(45293, ""), "2024-01-02T00:00:00+07:00");
  assert.equal(buildUpdatedAt("", "14:06:38"), null);
});

