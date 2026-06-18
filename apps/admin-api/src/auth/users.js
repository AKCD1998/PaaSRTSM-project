"use strict";

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeBranchCode(value, options = {}) {
  const allowTrim = options.allowTrim !== false;
  const raw = String(value || "");
  const normalized = allowTrim ? raw.trim() : raw;
  if (!/^\d{3}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function resolveConfiguredUserAccount(userId, config) {
  const normalized = normalizeUserId(userId);
  if (!normalized) {
    return null;
  }

  if (config.adminUsers?.has(normalized)) {
    return {
      userId: normalized,
      role: "admin",
      passwordHash: config.adminPasswordHash || "",
      branchCode: null,
    };
  }

  if (config.staffUsers?.has(normalized)) {
    return {
      userId: normalized,
      role: "staff",
      passwordHash: config.staffPasswordHash || "",
      branchCode: null,
    };
  }

  if (config.branchUsers?.has(normalized)) {
    const assignedBranchCode = normalizeBranchCode(config.branchUserBranches?.get(normalized));
    const passwordHash = String(config.branchUserPasswordHashes?.get(normalized) || "").trim();
    if (!assignedBranchCode || !passwordHash) {
      return null;
    }
    return {
      userId: normalized,
      role: "branch",
      passwordHash,
      branchCode: assignedBranchCode,
    };
  }

  return null;
}

function resolveUserRole(userId, config) {
  return resolveConfiguredUserAccount(userId, config)?.role || null;
}

function getPasswordHashForRole(role, config) {
  if (role === "admin") {
    return config.adminPasswordHash || "";
  }
  if (role === "staff") {
    return config.staffPasswordHash || "";
  }
  return "";
}

async function findBranchRecordByCode(db, branchCode) {
  const normalized = normalizeBranchCode(branchCode);
  if (!normalized || !db || typeof db.query !== "function") {
    return null;
  }

  const result = await db.query(
    `
      SELECT branch_code, branch_name, is_active, is_hq
      FROM core.branches
      WHERE branch_code = $1
      LIMIT 1
    `,
    [normalized],
  );

  if (!result.rows[0]) {
    return null;
  }

  return {
    branchCode: normalizeBranchCode(result.rows[0].branch_code),
    branchName: result.rows[0].branch_name || null,
    isActive: Boolean(result.rows[0].is_active),
    isHq: Boolean(result.rows[0].is_hq),
  };
}

module.exports = {
  normalizeUserId,
  normalizeBranchCode,
  resolveConfiguredUserAccount,
  resolveUserRole,
  getPasswordHashForRole,
  findBranchRecordByCode,
};
