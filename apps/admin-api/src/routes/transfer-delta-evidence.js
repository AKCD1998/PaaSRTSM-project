"use strict";

const crypto = require("node:crypto");
const express = require("express");

const { isActiveTransferBranch } = require("../services/transferDelta");
const { readTransferDeltaEvidence } = require("../services/transferDeltaEvidence");

const MIN_TOKEN_BYTES = 32;

function timingSafeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createTransferDeltaEvidenceRouter({ config, db }) {
  const router = express.Router();
  const expectedToken = String(config.transferDeltaEvidenceToken || "").trim();

  router.get("/:branchCode", async (req, res, next) => {
    if (config.featureTransferDeltaEvidenceApi !== true) {
      return res.status(404).json({ error: "Not found" });
    }
    if (Buffer.byteLength(expectedToken, "utf8") < MIN_TOKEN_BYTES) {
      return res.status(503).json({ error: "Transfer Delta evidence API is not configured." });
    }
    if (!timingSafeEqualStrings(req.get("x-internal-token"), expectedToken)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const branchCode = String(req.params.branchCode || "").trim();
    const branchEnabled = /^\d{3}$/.test(branchCode)
      && isActiveTransferBranch(branchCode)
      && config.transferDeltaBranches instanceof Set
      && config.transferDeltaBranches.has(branchCode);
    if (!branchEnabled) {
      return res.status(404).json({ error: "Not found" });
    }

    try {
      const evidence = await readTransferDeltaEvidence(db, branchCode);
      res.set("Cache-Control", "no-store");
      return res.json(evidence);
    } catch (error) {
      error.status = 503;
      return next(error);
    }
  });

  return router;
}

module.exports = {
  MIN_TOKEN_BYTES,
  createTransferDeltaEvidenceRouter,
  timingSafeEqualStrings,
};
