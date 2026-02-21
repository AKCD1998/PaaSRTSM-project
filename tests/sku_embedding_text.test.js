"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSkuEmbeddingText,
  buildSkuEmbeddingMetadata,
} = require("../apps/admin-api/src/embeddings/sku-text");

test("buildSkuEmbeddingText returns stable ordered content", () => {
  const sku = {
    display_name: "Amoxicillin 500 mg Capsule",
    generic_name: "Amoxicillin",
    strength_text: "500 mg",
    form: "capsule",
    route: "oral",
    category_name: "ยาฆ่าเชื้อ",
    supplier_code: "TT00001",
    product_kind: "medicine",
    pack_level: "blister",
    uom: "TAB",
    qty_in_base: 10,
    company_code: "630010001",
    item_display_name: "Amoxicillin",
  };

  const text = buildSkuEmbeddingText(sku);
  assert.equal(
    text,
    [
      "Display Name: Amoxicillin 500 mg Capsule",
      "Generic Name: Amoxicillin",
      "Strength: 500 mg",
      "Form: capsule",
      "Route: oral",
      "Category: ยาฆ่าเชื้อ",
      "Supplier Code: TT00001",
      "Product Type: medicine",
      "Pack Level: blister",
      "UOM: TAB",
      "Quantity In Base: 10",
      "Company Code: 630010001",
      "Item Display Name: Amoxicillin",
    ].join("\n"),
  );
});

test("buildSkuEmbeddingMetadata infers mixed language and key filters", () => {
  const metadata = buildSkuEmbeddingMetadata({
    display_name: "ยา Amoxicillin",
    generic_name: "Amoxicillin",
    product_kind: "medicine",
    pack_level: "base",
    category_name: "ยาฆ่าเชื้อ",
    supplier_code: "TT00001",
    company_code: "630010001",
    uom: "TAB",
  });

  assert.equal(metadata.lang, "th-en");
  assert.equal(metadata.product_type, "medicine");
  assert.equal(metadata.level, "base");
  assert.equal(metadata.company_code, "630010001");
});
