"use strict";

const { randomBytes } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { parseArgs } = require("node:util");
const { OAuth2Client } = require("google-auth-library");

const endpoint = "https://paasrtsm-project.onrender.com/api/codex/v1/branch-stock";

function readCredentialFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("Could not read the credential JSON file.");
  }
}

async function login({ "client-file": clientFile, "credentials-file": credentialsFile, email }) {
  if (!clientFile || !credentialsFile || !email) {
    throw new Error("Login requires --client-file, --credentials-file and --email.");
  }
  const { installed } = readCredentialFile(clientFile);
  if (!installed?.client_id || !installed.client_secret) {
    throw new Error("Choose the JSON file for a Google OAuth Desktop app.");
  }

  const client = new OAuth2Client(installed.client_id, installed.client_secret);
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const server = createServer();
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Google sign-in timed out.")), 5 * 60 * 1000);
    server.on("close", () => clearTimeout(timer));
    server.once("error", reject);
    server.on("request", (req, res) => {
      const callback = new URL(req.url, "http://127.0.0.1");
      if (req.method !== "GET" || callback.pathname !== "/oauth/callback" ||
          callback.searchParams.get("state") !== state) {
        res.writeHead(400).end("Invalid sign-in request.");
        return;
      }
      const code = callback.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })
        .end("Return to the terminal to see the sign-in result.");
      if (code) resolve(code);
      else reject(new Error("Google sign-in was declined."));
    });
    server.listen(0, "127.0.0.1", () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
      client.redirectUri = redirectUri;
      console.log("Open this link in your browser to authorize the StockDay client:");
      console.log(client.generateAuthUrl({
        redirect_uri: redirectUri,
        scope: ["openid", "email"],
        access_type: "offline",
        prompt: "consent",
        login_hint: email,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
        state,
        nonce,
      }));
    });
  }).finally(() => server.close());

  const { tokens } = await client.getToken({ code, codeVerifier }).catch(() => {
    throw new Error("Google rejected the sign-in code. Restart login and check the Desktop app settings.");
  });
  if (!tokens.id_token || !tokens.refresh_token) {
    throw new Error("Google did not return both an ID token and an offline refresh token.");
  }
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: installed.client_id }).catch(() => {
    throw new Error("The Google ID token could not be verified.");
  });
  const claims = ticket.getPayload();
  if (claims.email !== email.toLowerCase() || claims.email_verified !== true || claims.nonce !== nonce) {
    throw new Error("Google did not verify the requested account.");
  }

  writeFileSync(credentialsFile, JSON.stringify({
    client_id: installed.client_id,
    client_secret: installed.client_secret,
    refresh_token: tokens.refresh_token,
  }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(`CODEX_BRANCH_STOCK_GOOGLE_CLIENT_ID=${installed.client_id}`);
  console.log(`CODEX_BRANCH_STOCK_GOOGLE_SUB=${claims.sub}`);
  console.log(`CODEX_BRANCH_STOCK_GOOGLE_EMAIL=${claims.email}`);
}

async function readStock({ "credentials-file": credentialsFile, search, limit, offset }) {
  const { client_id, client_secret, refresh_token } = credentialsFile
    ? readCredentialFile(credentialsFile)
    : {
        client_id: process.env.CODEX_BRANCH_STOCK_GOOGLE_CLIENT_ID,
        client_secret: process.env.CODEX_BRANCH_STOCK_GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.CODEX_BRANCH_STOCK_GOOGLE_REFRESH_TOKEN,
      };
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error("Supply the enrolled credentials file or the three Codex environment values.");
  }
  const client = new OAuth2Client(client_id, client_secret);
  client.setCredentials({ refresh_token });
  const { credentials } = await client.refreshAccessToken().catch(() => {
    throw new Error("Google token refresh failed. Check the network and whether the grant is still active.");
  });
  if (!credentials.id_token) throw new Error("Google did not return an ID token.");

  const url = new URL(endpoint);
  for (const [name, value] of Object.entries({ search, limit, offset })) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  const response = await client.transporter.request({
    url,
    headers: { Authorization: `Bearer ${credentials.id_token}` },
    redirect: "error",
    timeout: 75000,
    validateStatus: () => true,
  }).catch(() => {
    throw new Error("Could not reach the Branch Stock API.");
  });
  if (response.status !== 200) throw new Error(`Branch Stock API returned HTTP ${response.status}.`);
  console.log(JSON.stringify(response.data, null, 2));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const credentialsFile = { "credentials-file": { type: "string" } };
  if (command === "login") {
    return login(parseArgs({ args, options: {
      ...credentialsFile, "client-file": { type: "string" }, email: { type: "string" },
    } }).values);
  }
  if (command === "read") {
    return readStock(parseArgs({ args, options: {
      ...credentialsFile, search: { type: "string" }, limit: { type: "string" }, offset: { type: "string" },
    } }).values);
  }
  console.log("Usage: node scripts/codex_branch_stock.js login --client-file FILE --credentials-file FILE --email EMAIL");
  console.log("       node scripts/codex_branch_stock.js read [--credentials-file FILE] [--search TEXT] [--limit N] [--offset N]");
  process.exitCode = command ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
