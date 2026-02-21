"use strict";

function normalizeText(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
}

function pushLine(lines, label, value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return;
  }
  lines.push(`${label}: ${normalized}`);
}

function inferLanguage(text) {
  const value = normalizeText(text);
  if (!value) {
    return "unknown";
  }

  let hasThai = false;
  let hasLatin = false;

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x0e00 && code <= 0x0e7f) {
      hasThai = true;
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      hasLatin = true;
    }
    if (hasThai && hasLatin) {
      return "th-en";
    }
  }

  if (hasThai) {
    return "th";
  }
  if (hasLatin) {
    return "en";
  }
  return "unknown";
}

function buildSkuEmbeddingText(sku) {
  const lines = [];

  pushLine(lines, "Display Name", sku.display_name);
  pushLine(lines, "Generic Name", sku.generic_name || sku.item_generic_name);
  pushLine(lines, "Strength", sku.strength_text);
  pushLine(lines, "Form", sku.form);
  pushLine(lines, "Route", sku.route);
  pushLine(lines, "Category", sku.category_name);
  pushLine(lines, "Supplier Code", sku.supplier_code);
  pushLine(lines, "Product Type", sku.product_kind);
  pushLine(lines, "Pack Level", sku.pack_level);
  pushLine(lines, "UOM", sku.uom);

  const qtyInBase = Number(sku.qty_in_base);
  if (Number.isFinite(qtyInBase) && qtyInBase > 0) {
    lines.push(`Quantity In Base: ${qtyInBase}`);
  }

  pushLine(lines, "Company Code", sku.company_code);
  pushLine(lines, "Item Display Name", sku.item_display_name);

  return lines.join("\n");
}

function compactMetadata(metadata) {
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null) {
      continue;
    }
    const normalized = typeof value === "string" ? normalizeNullableText(value) : value;
    if (normalized == null) {
      continue;
    }
    out[key] = normalized;
  }
  return out;
}

function buildSkuEmbeddingMetadata(sku) {
  const baseText = [sku.display_name, sku.generic_name, sku.item_display_name].map(normalizeText).join(" ");
  return compactMetadata({
    source: "public.skus",
    lang: inferLanguage(baseText),
    company_code: sku.company_code,
    product_type: sku.product_kind,
    level: sku.pack_level,
    category_name: sku.category_name,
    supplier_code: sku.supplier_code,
    uom: sku.uom,
  });
}

module.exports = {
  normalizeText,
  normalizeNullableText,
  inferLanguage,
  buildSkuEmbeddingText,
  buildSkuEmbeddingMetadata,
};
