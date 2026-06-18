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

function resolveStaffBranchAllowlist(userId, config) {
  const allowlists = config?.staffBranchAllowlists;
  if (!allowlists || !(allowlists instanceof Map) || allowlists.size === 0) {
    return null;
  }
  const normalized = normalizeUserId(userId);
  if (!allowlists.has(normalized)) {
    return null;
  }
  return allowlists.get(normalized);
}

function buildPermissionsResponse(role, userId, config) {
  const canWrite = role === "admin";
  const canSelectBranchContext = role === "admin" || role === "staff";
  let allowedBranchCodes = null;
  if (role === "staff") {
    const allowlist = resolveStaffBranchAllowlist(userId, config);
    if (allowlist !== null) {
      allowedBranchCodes = [...allowlist].sort();
    }
  }
  return {
    can_edit_products: canWrite,
    can_run_imports: canWrite,
    can_apply_rules: canWrite,
    can_select_branch_context: canSelectBranchContext,
    allowed_branch_codes: allowedBranchCodes,
  };
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
  resolveStaffBranchAllowlist,
  buildPermissionsResponse,
  findBranchRecordByCode,
};
