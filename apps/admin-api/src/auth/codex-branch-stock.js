"use strict";

const { OAuth2Client } = require("google-auth-library");
const { getBearerToken } = require("./middleware");

function requireCodexBranchStock(identity = {}, googleAuth = new OAuth2Client()) {
  const { clientId, subject, email } = identity;
  return async function codexBranchStockAuth(req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!clientId || !subject || !email) {
      return res.status(404).json({ error: "Not found" });
    }

    const idToken = getBearerToken(req);
    let claims;
    if (idToken && idToken.length <= 4096 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(idToken)) {
      try {
        const ticket = await googleAuth.verifyIdToken({ idToken, audience: clientId });
        claims = ticket.getPayload();
      } catch {
        // Verification errors can include token contents. Keep them out of responses and logs.
      }
    }
    if (!Number.isFinite(claims?.exp) || claims.exp <= Date.now() / 1000) {
      res.set("WWW-Authenticate", 'Bearer realm="branch-stock"');
      return res.status(401).json({ error: "Valid Google ID token required" });
    }
    if (claims.sub !== subject || claims.email !== email || claims.email_verified !== true) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

module.exports = { requireCodexBranchStock };
