"use strict";

const express = require("express");
const { requireAuth, requireRole } = require("../auth/middleware");
const devicePolicy = require("../data/pos-device-policy.json");
const { createPosReleaseCatalog } = require("../services/posReleaseCatalog");
const releaseCatalog = createPosReleaseCatalog();

function createPosDeviceAdminRouter({ config, policy = devicePolicy, catalog = releaseCatalog }) {
  const router = express.Router();
  router.use(requireAuth(config), requireRole("admin"));
  router.get("/", async (_req, res, next) => {
    // No direct access to AdaAcc, Tailnet credentials, or installer execution.
    // Eligibility is a reviewed snapshot, not a claim of live device availability.
    try {
      const releases = await catalog.get();
      res.set("Cache-Control", "private, no-store");
      res.json({
        policyVersion: policy.policyVersion,
        tailnet: policy.tailnet,
        auditedAt: policy.auditedAt,
        ...releases,
        devices: policy.devices.map(({ nodeId, hostname, ipv4, status, reason, adaVersion }) => ({
          nodeId, hostname, ipv4, status, reason, adaVersion: adaVersion || null,
        })),
      });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { createPosDeviceAdminRouter };
