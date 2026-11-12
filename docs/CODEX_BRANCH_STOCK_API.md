# Branch Stock for Codex

`GET https://paasrtsm-project.onrender.com/api/codex/v1/branch-stock` reads the current Branch Stock page as JSON. It uses the same stock display as the web page, including the branch 004 Shopee projection when available. Each response includes `records`, `pagination`, and any available projection status. Use `search` for product code, barcode, or product name, `limit` for page size (1–200, default 25), and `offset` for pagination (default 0). Inspect the projection status before treating a missing branch 004 quantity as zero.

The API verifies a Google-signed ID token from one OAuth client and requires both the configured Google account ID (`sub`) and its verified email. This credential only authorizes the stock listing route.

## First-time Google setup

1. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), select a project you control. Configure the app name, support email and contact email if prompted. Choose an external audience for a personal Gmail account.
2. Open **Clients**, create a **Desktop app** client named **SC StockDay Codex**, and download its JSON. Use a dedicated client for this integration. The login helper requests only `openid email`. See [Google's Desktop OAuth guide](https://developers.google.com/identity/protocols/oauth2/native-app).
3. From this repository on your local machine, run `npm ci` and then the command below. Replace the paths and the placeholder email. Use a private directory outside the repository for the generated credentials. Open the sign-in link printed in the terminal and choose the allowed Google account.

   ```powershell
   node scripts/codex_branch_stock.js login --client-file "C:\private\google-client.json" --credentials-file "C:\private\stockday-credentials.json" --email "YOUR_ALLOWED_GOOGLE_EMAIL"
   ```

   The helper prints the public OAuth client ID, Google account ID, and verified email for the Render configuration. It writes the refresh token to the credentials file. Keep the two JSON files out of source control and chat.

## Enable on Render

In **Environment** for the `paasrtsm-project` service, add the three values printed by the helper.

- `CODEX_BRANCH_STOCK_GOOGLE_CLIENT_ID`
- `CODEX_BRANCH_STOCK_GOOGLE_SUB`
- `CODEX_BRANCH_STOCK_GOOGLE_EMAIL`

Use **Save only**, then manually deploy the backend commit containing this API. The route responds with `404` if any of the three values is missing, `401` without a valid Google token, and `403` for a different account. Confirm `401` with an unauthenticated request and `200` with the authorized helper before using the API from Cloud.

## Use from local Codex

Use the credentials file you created during setup. The helper refreshes the Google grant and requests stock without opening the web page.

```powershell
node scripts/codex_branch_stock.js read --credentials-file "C:\private\stockday-credentials.json" --search "PRODUCT_CODE" --limit 10
```

## Use from Codex Cloud

1. Use a private Cloud environment with access to this repository and install dependencies with `npm ci`. Allow HTTPS requests to `oauth2.googleapis.com` and `paasrtsm-project.onrender.com`. Allow npm registry access during setup if needed.
2. Request three personal **Environment variable** values in that environment. In **Settings → Codex Cloud → Personal vault**, store `client_id` as `CODEX_BRANCH_STOCK_GOOGLE_CLIENT_ID`, `client_secret` as `CODEX_BRANCH_STOCK_GOOGLE_CLIENT_SECRET`, and `refresh_token` as `CODEX_BRANCH_STOCK_GOOGLE_REFRESH_TOKEN`. Scope the values to this environment. Programs in that task can read direct environment variables, so reserve this environment for trusted tasks. See [Codex Cloud personal values](https://learn.chatgpt.com/docs/environments/cloud-environments#configure-environment-variables-and-network-secrets).
3. Run the same helper without the credentials file.

   ```bash
   node scripts/codex_branch_stock.js read --search "PRODUCT_CODE" --limit 10
   ```

Other HTTPS clients can refresh the grant at Google's token endpoint, then send the returned `id_token` in the `Authorization: Bearer` header. Use only this integration's credential. To disable the API, remove one of the three Render configuration values and redeploy. To stop renewal, revoke the grant in the allowed Google account and remove the saved credential.
