"use strict";

const express = require("express");

function createHealthRouter() {
  const router = express.Router();

  router.get("/", (req, res) => {
    res.json({
      ok: true,
      service: "admin-api",
      request_id: req.requestId,
      now: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = {
  createHealthRouter,
};
