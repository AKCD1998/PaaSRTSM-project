#!/usr/bin/env node
"use strict";

const { loadAgentConfig, runAdaSyncAgent } = require("./lib/ada_sync_agent");

async function main() {
  const config = loadAgentConfig(process.env, process.argv.slice(2));

  if (config.dryRun) {
    console.log("ADA sync agent running in dry-run mode.");
  } else {
    console.log("ADA sync agent running in execute mode.");
  }

  console.log(`Driver: ${config.driver}`);
  console.log(`Datasets: ${config.datasets.join(", ")}`);
  console.log(`Branch filter: ${config.branchCode || "none"}`);

  const result = await runAdaSyncAgent({ config });

  console.log(`Status: ${result.status}`);
  console.log(`Records read: ${result.recordsRead}`);
  console.log(`Records sent: ${result.recordsSent}`);
  for (const dataset of result.datasets) {
    console.log(
      `${dataset.dataset}: read=${dataset.recordsRead}, sent=${dataset.recordsSent}, dryRun=${dataset.dryRun}, watermarkTo=${dataset.watermarkTo || "-"}`,
    );
  }

  if (result.errors.length) {
    for (const error of result.errors) {
      console.error(`${error.dataset}: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`ADA sync agent failed: ${error.message}`);
  process.exitCode = 1;
});
