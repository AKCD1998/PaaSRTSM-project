"use strict";

// One-time bootstrap: insert an enrollment code directly into the DB
// for a branch that has no enrolled devices yet.
// Usage:
//   Set DATABASE_URL in the environment, then run:
//   node scripts/bootstrap_enroll_code.js 005
//
// Do not commit a real DATABASE_URL into this file.

const { Client } = require("pg");
const crypto = require("crypto");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required in the environment.");
  process.exit(1);
}

async function main() {
  const branchCode = process.argv[2];
  if (!branchCode) {
    console.error("Usage: node scripts/bootstrap_enroll_code.js <branch_code>");
    process.exit(1);
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const code = crypto.randomBytes(10).toString("base64url");
  const ttlSeconds = 300; // 5 minutes for bootstrap
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await client.query(
    `INSERT INTO ordering.enrollment_codes (code, branch_code, issued_by, expires_at)
     VALUES ($1, $2, 'bootstrap-script', $3)`,
    [code, branchCode, expiresAt],
  );

  await client.end();

  console.log(`\n✅ Enrollment code for branch ${branchCode}:`);
  console.log(`\n   ${code}\n`);
  console.log(`   Expires: ${expiresAt.toLocaleTimeString()} (5 minutes)`);
  console.log(`\n   กรอก code นี้ในแอปได้เลย\n`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
