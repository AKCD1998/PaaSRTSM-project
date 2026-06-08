"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseStrength,
  scanProduct,
  classify,
  computeConfidence,
} = require("../scripts/backfill_product_ingredient_proposals");

const { normalizeLatin } = require("../scripts/ingredient_discovery_coverage");

function syn(ingredientId, displayName, synonymText) {
  const normalized = normalizeLatin(synonymText).trim();
  return { ingredientId, displayName, synonymText, normalized, matchString: ` ${normalized} `, length: normalized.length };
}

test("parseStrength extracts value+unit after the synonym, else null", () => {
  assert.deepEqual(parseStrength("paracetamol 500 mg 10 s", "paracetamol"), { value: 500, unit: "mg", raw: "paracetamol 500 mg" });
  assert.deepEqual(parseStrength("amlodipine5mg tablet", "amlodipine"), { value: 5, unit: "mg", raw: "amlodipine5mg" });
  assert.equal(parseStrength("paracetamol tablets", "paracetamol"), null);
  assert.equal(parseStrength("vitamin c 1000 something", "vitamin c"), null); // unit not recognized
});

test("parseStrength normalizes gm/gram to g", () => {
  assert.deepEqual(parseStrength("calcium 1 gm", "calcium"), { value: 1, unit: "g", raw: "calcium 1 gm" });
});

test("scanProduct keeps the longest synonym per ingredient and one row per ingredient", () => {
  const synonyms = [
    syn(1, "Amoxicillin", "amoxicillin"),
    syn(1, "Amoxicillin", "amoxicillin trihydrate"),
    syn(2, "Clavulanic Acid", "clavulanic acid"),
  ].sort((a, b) => b.length - a.length);

  const scan = scanProduct(
    { productCode: "P1", nameEng: "AUGMENTIN AMOXICILLIN TRIHYDRATE 875 MG CLAVULANIC ACID 125 MG" },
    synonyms,
  );

  const byIngredient = new Map(scan.candidates.map((c) => [c.ingredientId, c]));
  assert.equal(scan.candidates.length, 2);
  // longest synonym wins for ingredient 1
  assert.equal(byIngredient.get(1).synonymText, "amoxicillin trihydrate");
  assert.equal(byIngredient.get(1).strengthValue, 875);
  assert.equal(byIngredient.get(2).strengthValue, 125);
});

test("scanProduct does not match substrings inside other words", () => {
  // 'ace' must not match inside 'paracetamol'
  const synonyms = [syn(9, "Acetic", "ace")];
  const scan = scanProduct({ productCode: "P2", nameEng: "PARACETAMOL 500 MG" }, synonyms);
  assert.equal(scan.candidates.length, 0);
});

test("scanProduct flags ambiguous token mapping to multiple ingredients", () => {
  const synonyms = [syn(1, "Ing One", "shared"), syn(2, "Ing Two", "shared")];
  const scan = scanProduct({ productCode: "P3", nameEng: "BRAND SHARED 10 MG" }, synonyms);
  assert.equal(scan.ambiguousTokens, 1);
  assert.equal(scan.candidates.length, 2);
});

test("computeConfidence rewards multiword synonyms and strength", () => {
  assert.equal(computeConfidence("amoxicillin", false), 0.6);
  assert.equal(computeConfidence("amoxicillin trihydrate", false), 0.8);
  assert.equal(computeConfidence("amoxicillin trihydrate", true), 0.9);
});

test("classify respects existing row status and source", () => {
  const cand = { rawText: "x", confidence: 0.6, strengthValue: null };
  assert.equal(classify(undefined, cand, false).action, "insert");
  assert.equal(classify({ status: "confirmed" }, cand, false).action, "skip");
  assert.equal(classify({ status: "needs_review" }, cand, false).action, "skip");
  assert.equal(classify({ status: "rejected" }, cand, false).action, "skip");
  assert.equal(classify({ status: "rejected" }, cand, true).action, "update");
  assert.equal(classify({ status: "proposed", source: "seed_manual_test" }, cand, false).action, "skip");
  assert.equal(
    classify({ status: "proposed", source: "dictionary_backfill", raw_text: "x", confidence: 0.6, strength_value: null }, cand, false).action,
    "skip",
  ); // unchanged
  assert.equal(
    classify({ status: "proposed", source: "dictionary_backfill", raw_text: "old", confidence: 0.6, strength_value: null }, cand, false).action,
    "update",
  ); // changed
});
