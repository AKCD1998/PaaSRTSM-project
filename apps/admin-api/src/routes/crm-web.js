"use strict";

const path = require("node:path");
const express = require("express");

// Public navigation only. Registration and staff authentication stay with the
// existing CRM services; this router has no database or credential dependency.
function createCrmWebRouter() {
  const router = express.Router();
  const publicDir = path.join(__dirname, "../../public/sccrm");

  router.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cache-Control": "no-cache",
    });
    next();
  });

  // Explicit files only: never expose arbitrary files from the repository.
  router.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  router.get("/styles.css", (_req, res) => res.sendFile(path.join(publicDir, "styles.css")));
  router.get("/icon.svg", (_req, res) => res.sendFile(path.join(publicDir, "icon.svg")));

  return router;
}

module.exports = { createCrmWebRouter };
