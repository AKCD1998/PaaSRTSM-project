"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  skuMatchesRule,
  planSkuUpdateFromRule,
  simulateRuleApplication,
} = require("../scripts/apply_enrichment_rules");

test("rule matching uses regex across name/category/supplier", () => {
  const sku = {
    sku_id: 101,
    display_name: "Cetirizine 10 mg Tablet",
    category_name: "ยาลดน้ำมูก",
    supplier_code: "TT00001",
  };
  const rule = {
    match_name_regex: "cetirizine\\s*10",
    match_category_regex: "ยาลดน้ำมูก",
    match_supplier_regex: "^TT\\d+",
  };

  assert.equal(skuMatchesRule(sku, rule), true);
  assert.equal(
    skuMatchesRule(sku, {
      ...rule,
      match_category_regex: "วิตามิน",
    }),
    false,
  );
});

test("planSkuUpdateFromRule does not overwrite existing data unless force", () => {
  const sku = {
    sku_id: 202,
    generic_name: "cetirizine",
    strength_text: "10 mg",
    form: "tablet",
    route: "oral",
    product_kind: "medicine",
    enrichment_status: "partial",
    enrichment_notes: "",
  };
  const rule = {
    set_generic_name: "chlorpheniramine",
    set_strength_text: "4 mg",
    set_form: "tablet",
    set_route: "oral",
    set_product_kind: "medicine",
    set_status: "partial",
    note: "",
  };

  const noForce = planSkuUpdateFromRule(sku, rule, { force: false });
  assert.equal(noForce.shouldUpdate, false);
  assert.equal(noForce.reason, "existing_data_locked");

  const force = planSkuUpdateFromRule(sku, rule, { force: true });
  assert.equal(force.shouldUpdate, true);
  assert.equal(force.updates.generic_name, "chlorpheniramine");
  assert.equal(force.updates.strength_text, "4 mg");
});

test("dry-run simulation is deterministic", () => {
  const rules = [
    {
      rule_id: 1,
      priority: 10,
      match_name_regex: "cetirizine\\s*10",
      match_category_regex: "",
      match_supplier_regex: "",
      set_generic_name: "cetirizine",
      set_strength_text: "10 mg",
      set_form: "tablet",
      set_route: "oral",
      set_product_kind: "medicine",
      set_status: "partial",
      note: "rule-1",
    },
    {
      rule_id: 2,
      priority: 20,
      match_name_regex: "ORS|เกลือแร่",
      match_category_regex: "",
      match_supplier_regex: "",
      set_generic_name: "",
      set_strength_text: "",
      set_form: "powder",
      set_route: "oral",
      set_product_kind: "medical_food",
      set_status: "partial",
      note: "rule-2",
    },
  ];

  const skus = [
    {
      sku_id: 1001,
      company_code: "630010001",
      display_name: "Cetirizine 10 mg",
      category_name: "ยาแก้แพ้",
      supplier_code: "TT00001",
      generic_name: "",
      strength_text: "",
      form: "",
      route: "",
      product_kind: "",
      enrichment_status: "missing",
      enrichment_notes: "",
    },
    {
      sku_id: 1002,
      company_code: "630010003",
      display_name: "ผงเกลือแร่ ORS",
      category_name: "ผงชงดื่ม",
      supplier_code: "TT00002",
      generic_name: "",
      strength_text: "",
      form: "",
      route: "",
      product_kind: "",
      enrichment_status: "missing",
      enrichment_notes: "",
    },
  ];

  const simA = simulateRuleApplication(rules, skus, {
    force: false,
    limit: null,
    onlyStatus: null,
  });
  const simB = simulateRuleApplication(rules, skus, {
    force: false,
    limit: null,
    onlyStatus: null,
  });

  assert.deepEqual(simA, simB);
  assert.equal(simA.totals.updated, 2);
  assert.equal(simA.ruleSummaries[0].updated, 1);
  assert.equal(simA.ruleSummaries[1].updated, 1);
});
