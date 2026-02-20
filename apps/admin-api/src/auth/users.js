"use strict";

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveUserRole(userId, config) {
  const normalized = normalizeUserId(userId);
  if (!normalized) {
    return null;
  }
  if (config.adminUsers.has(normalized)) {
    return "admin";
  }
  if (config.staffUsers.has(normalized)) {
    return "staff";
  }
  return null;
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

module.exports = {
  normalizeUserId,
  resolveUserRole,
  getPasswordHashForRole,
};
