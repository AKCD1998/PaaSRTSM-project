"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth/middleware");
const devicePolicy = require("../data/pos-device-policy.json");

function createPosDeviceAdminRouter({ config, policy = devicePolicy }) {
  const router = express.Router();
  router.use(requireAuth(config), requireRole("admin"));
  router.get("/", (_req, res) => {
    // No direct access to AdaAcc, Tailnet credentials, or installer execution.
    // Eligibility is a reviewed snapshot, not a claim of live device availability.
    res.set("Cache-Control", "private, no-store");
    res.json({
      policyVersion: policy.policyVersion,
      tailnet: policy.tailnet,
      auditedAt: policy.auditedAt,
      installer: policy.installer,
      devices: policy.devices.map(({ nodeId, hostname, ipv4, status, reason, adaVersion }) => ({
        nodeId, hostname, ipv4, status, reason, adaVersion: adaVersion || null,
      })),
    });
  });
  return router;
}

module.exports = { createPosDeviceAdminRouter };
