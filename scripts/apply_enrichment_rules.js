#!/usr/bin/env node
"use strict";

const { Client } = require("pg");

const VALID_STATUSES = new Set(["missing", "partial", "verified"]);
const RULE_UPDATE_COLUMNS = new Set([
  "generic_name",
  "strength_text",
  "form",
  "route",
  "product_kind",
  "enrichment_status",
  "enrichment_notes",
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/apply_enrichment_rules.js [--dry-run] [--commit] [--limit N] [--only-status missing|partial] [--force] --db-url <postgresUrl>",
    "",
    "Options:",
    "  --dry-run                 Plan only (default)",
    "  --commit                  Apply updates to DB",
    "  --limit <N>               Maximum SKU updates",
    "  --only-status <value>     Filter candidate SKUs by current status (missing|partial)",
    "  --force                   Allow overwrite and allow updating verified SKUs",
    "  --db-url <url>            PostgreSQL URL (or set DATABASE_URL)",
    "  --help                    Show help",
  ].join("\n");
}

function parseCliArgs(argv) {
  const args = {
    dryRun: true,
    commit: false,
    limit: null,
    onlyStatus: null,
    force: false,
    dbUrl: process.env.DATABASE_URL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
      args.commit = false;
    } else if (token === "--commit") {
      args.commit = true;
      args.dryRun = false;
    } else if (token === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = value;
    } else if (token === "--only-status") {
      const value = normalizeText(argv[++i]).toLowerCase();
      if (!["missing", "partial"].includes(value)) {
        throw new Error("--only-status must be one of: missing, partial");
      }
      args.onlyStatus = value;
    } else if (token === "--force") {
      args.force = true;
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
  return String(value == null ? "" : value).trim();
}

function hasText(value) {
  return normalizeText(value) !== "";
}

function compileRegex(pattern, fieldName) {
  const text = normalizeText(pattern);
  if (!text) {
    return null;
  }
  try {
    return new RegExp(text, "i");
  } catch (error) {
    throw new Error(`invalid ${fieldName}: ${error.message}`);
  }
}

function compileRuleMatchers(rule) {
  return {
    nameRegex: compileRegex(rule.match_name_regex, "match_name_regex"),
    categoryRegex: compileRegex(rule.match_category_regex, "match_category_regex"),
    supplierRegex: compileRegex(rule.match_supplier_regex, "match_supplier_regex"),
  };
}

function skuMatchesRule(sku, rule, precompiledMatchers = null) {
  const matchers = precompiledMatchers || compileRuleMatchers(rule);
  if (matchers.nameRegex && !matchers.nameRegex.test(normalizeText(sku.display_name))) {
    return false;
  }
  if (matchers.categoryRegex && !matchers.categoryRegex.test(normalizeText(sku.category_name))) {
    return false;
  }
  if (matchers.supplierRegex && !matchers.supplierRegex.test(normalizeText(sku.supplier_code))) {
    return false;
  }
  return true;
}

function planSkuUpdateFromRule(sku, rule, options = {}) {
  const force = Boolean(options.force);
  const currentStatus = normalizeText(sku.enrichment_status).toLowerCase() || "missing";

  if (!force && currentStatus === "verified") {
    return {
      shouldUpdate: false,
      reason: "status_verified_locked",
      updates: {},
      blockedByExisting: 0,
    };
  }

  const updates = {};
  let blockedByExisting = 0;

  function assignField(targetField, sourceField) {
    const incoming = normalizeText(rule[sourceField]);
    if (!incoming) {
      return;
    }
    const current = normalizeText(sku[targetField]);
    if (force || !current) {
      if (current !== incoming) {
        updates[targetField] = incoming;
      }
      return;
    }
    if (current !== incoming) {
      blockedByExisting += 1;
    }
  }

  assignField("generic_name", "set_generic_name");
  assignField("strength_text", "set_strength_text");
  assignField("form", "set_form");
  assignField("route", "set_route");
  assignField("product_kind", "set_product_kind");

  const targetStatus = normalizeText(rule.set_status).toLowerCase();
  if (targetStatus && VALID_STATUSES.has(targetStatus)) {
    if (force || currentStatus !== "verified") {
      if (currentStatus !== targetStatus) {
        updates.enrichment_status = targetStatus;
      }
    }
  }

  const note = normalizeText(rule.note);
  if (note) {
    const currentNote = normalizeText(sku.enrichment_notes);
    if (force || !currentNote) {
      if (currentNote !== note) {
        updates.enrichment_notes = note;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    return {
      shouldUpdate: true,
      reason: "",
      updates,
      blockedByExisting,
    };
  }

  return {
    shouldUpdate: false,
    reason: blockedByExisting > 0 ? "existing_data_locked" : "no_changes",
    updates: {},
    blockedByExisting,
  };
}

function matchesFilters(sku, options) {
  if (options.onlyStatus && normalizeText(sku.enrichment_status).toLowerCase() !== options.onlyStatus) {
    return false;
  }
  if (options.companyCodes && options.companyCodes.length > 0) {
    return options.companyCodes.includes(normalizeText(sku.company_code));
  }
  return true;
}

function simulateRuleApplication(rules, skus, options = {}) {
  const limit = options.limit || null;
  const force = Boolean(options.force);
  const filtered = skus
    .filter((sku) => matchesFilters(sku, options))
    .sort((a, b) => a.sku_id - b.sku_id)
    .map((sku) => ({ ...sku }));

  const stateBySkuId = new Map(filtered.map((sku) => [sku.sku_id, sku]));
  const actions = [];
  const ruleSummaries = [];
  const totals = {
    candidates: filtered.length,
    matched: 0,
    updated: 0,
    skipped: 0,
  };

  let stop = false;
  for (const rule of rules) {
    const ruleSummary = {
      rule_id: rule.rule_id,
      priority: rule.priority,
      note: normalizeText(rule.note),
      matched: 0,
      updated: 0,
      skipped: {},
      error: "",
    };

    let matchers = null;
    try {
      matchers = compileRuleMatchers(rule);
    } catch (error) {
      ruleSummary.error = error.message;
      ruleSummaries.push(ruleSummary);
      continue;
    }

    for (const sku of filtered) {
      if (limit && totals.updated >= limit) {
        stop = true;
        break;
      }

      const currentSku = stateBySkuId.get(sku.sku_id);
      if (!currentSku) {
        continue;
      }

      if (!skuMatchesRule(currentSku, rule, matchers)) {
        continue;
      }

      ruleSummary.matched += 1;
      totals.matched += 1;

      const plan = planSkuUpdateFromRule(currentSku, rule, { force });
      if (!plan.shouldUpdate) {
        const reason = plan.reason || "no_changes";
        ruleSummary.skipped[reason] = (ruleSummary.skipped[reason] || 0) + 1;
        totals.skipped += 1;
        continue;
      }

      actions.push({
        rule_id: rule.rule_id,
        sku_id: currentSku.sku_id,
        company_code: currentSku.company_code,
        updates: plan.updates,
      });

      Object.assign(currentSku, plan.updates);
      currentSku.enriched_by = "rules";

      ruleSummary.updated += 1;
      totals.updated += 1;
    }

    ruleSummaries.push(ruleSummary);
    if (stop) {
      break;
    }
  }

  return {
    ruleSummaries,
    totals,
    actions,
    limitReached: Boolean(limit && totals.updated >= limit),
  };
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

async function loadRules(client) {
  const query = `
    SELECT
      rule_id,
      is_enabled,
      priority,
      match_name_regex,
      match_category_regex,
      match_supplier_regex,
      set_generic_name,
      set_strength_text,
      set_form,
      set_route,
      set_product_kind,
      set_status,
      note
    FROM public.enrichment_rules
    WHERE is_enabled IS TRUE
    ORDER BY priority ASC, rule_id ASC
  `;
  const result = await client.query(query);
  return result.rows;
}

async function loadSkus(client, options = {}) {
  const clauses = [];
  const params = [];

  if (options.onlyStatus) {
    params.push(options.onlyStatus);
    clauses.push(`COALESCE(enrichment_status, 'missing') = $${params.length}`);
  }
  if (options.companyCodes && options.companyCodes.length > 0) {
    params.push(options.companyCodes);
    clauses.push(`company_code = ANY($${params.length}::text[])`);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const query = `
    SELECT
      sku_id,
      company_code,
      display_name,
      category_name,
      supplier_code,
      generic_name,
      strength_text,
      form,
      route,
      product_kind,
      enrichment_status,
      enrichment_notes
    FROM public.skus
    ${whereSql}
    ORDER BY sku_id ASC
  `;
  const result = await client.query(query, params);
  return result.rows;
}

function buildUpdateStatement(action) {
  const entries = Object.entries(action.updates).filter(([column]) => RULE_UPDATE_COLUMNS.has(column));
  if (entries.length === 0) {
    return null;
  }

  const assignments = [];
  const params = [];
  let index = 1;

  for (const [column, value] of entries) {
    assignments.push(`${column} = $${index}`);
    params.push(value);
    index += 1;
  }

  assignments.push("enriched_at = now()");
  assignments.push("enriched_by = 'rules'");
  assignments.push("updated_at = now()");

  params.push(action.sku_id);

  return {
    sql: `UPDATE public.skus SET ${assignments.join(", ")} WHERE sku_id = $${index}`,
    params,
  };
}

async function runRuleApplication(options) {
  if (!options.dbUrl) {
    throw new Error("Missing database URL. Use --db-url or set DATABASE_URL");
  }

  const client = new Client(dbConfigFromUrl(options.dbUrl));
  await client.connect();

  try {
    const rules = await loadRules(client);
    const skus = await loadSkus(client, options);

    const simulation = simulateRuleApplication(rules, skus, options);
    const summary = {
      mode: options.commit ? "commit" : "dry-run",
      rules_loaded: rules.length,
      ...simulation,
    };

    if (!options.commit) {
      return summary;
    }

    await client.query("BEGIN");
    try {
      for (const action of simulation.actions) {
        const statement = buildUpdateStatement(action);
        if (!statement) {
          continue;
        }
        await client.query(statement.sql, statement.params);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    return summary;
  } finally {
    await client.end();
  }
}

function printSummary(summary) {
  console.log(`Mode: ${summary.mode.toUpperCase()}`);
  console.log(`Rules loaded: ${summary.rules_loaded}`);
  console.log(`Candidate SKUs: ${summary.totals.candidates}`);
  console.log(`Matched SKUs: ${summary.totals.matched}`);
  console.log(`Updated SKUs: ${summary.totals.updated}`);
  console.log(`Skipped matches: ${summary.totals.skipped}`);
  if (summary.limitReached) {
    console.log("Limit reached: true");
  }

  console.log("Per-rule summary:");
  for (const row of summary.ruleSummaries) {
    const skipped = Object.entries(row.skipped || {})
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");
    const base = `  - rule ${row.rule_id} (priority ${row.priority}) matched=${row.matched} updated=${row.updated}`;
    if (row.error) {
      console.log(`${base} error=${row.error}`);
      continue;
    }
    console.log(skipped ? `${base} skipped: ${skipped}` : base);
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const summary = await runRuleApplication(args);
  printSummary(summary);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Rule application failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCliArgs,
  skuMatchesRule,
  planSkuUpdateFromRule,
  simulateRuleApplication,
  runRuleApplication,
  printSummary,
};
