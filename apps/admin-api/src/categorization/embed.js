"use strict";

const https = require("node:https");
const crypto = require("node:crypto");

const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 20; // OpenAI allows up to 2048 inputs; 20 keeps requests small and retryable
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 1500;

/**
 * Build the embedding input text for a product.
 * Uses ONLY the Thai and English product names — no identifiers, codes, or
 * structured metadata — so the vector captures semantic meaning, not identity.
 */
function buildEmbeddingText(productNameThai, productNameEng) {
  const parts = [productNameThai, productNameEng].filter((s) => s && String(s).trim());
  return parts.map((s) => String(s).trim()).join(" | ") || null;
}

function contentHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Call OpenAI embeddings API for a batch of texts.
 * Returns array of Float32Array (one per input, in order).
 */
function callOpenAiEmbeddings(apiKey, texts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, input: texts, encoding_format: "float" });

    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/embeddings",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(raw);
            if (json.error) return reject(new Error(`OpenAI: ${json.error.message}`));
            // Sort by index in case the API reorders (spec says it may)
            const sorted = json.data.sort((a, b) => a.index - b.index);
            resolve(sorted.map((d) => d.embedding));
          } catch (e) {
            reject(new Error(`OpenAI parse error: ${e.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function callWithRetry(apiKey, texts, attempt = 1) {
  try {
    return await callOpenAiEmbeddings(apiKey, texts);
  } catch (err) {
    if (attempt >= RETRY_LIMIT) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    return callWithRetry(apiKey, texts, attempt + 1);
  }
}

/**
 * Generate and upsert embeddings for a list of products.
 *
 * products: [{ product_code, product_name_thai, product_name_eng }]
 * Writes to ada.product_category_embeddings.
 * Skips products whose text hasn't changed (same content_hash).
 * Returns { embedded, skipped }.
 */
async function upsertCategoryEmbeddings(db, apiKey, products, { force = false } = {}) {
  if (!products || products.length === 0) return { embedded: 0, skipped: 0 };

  // Build texts and filter empties
  const prepared = products
    .map((p) => ({
      product_code: p.product_code,
      text: buildEmbeddingText(p.product_name_thai, p.product_name_eng),
    }))
    .filter((p) => p.text);

  if (prepared.length === 0) return { embedded: 0, skipped: products.length };

  // Load existing hashes to skip unchanged rows
  let skipSet = new Set();
  if (!force) {
    const { rows } = await db.query(
      `SELECT product_code, content_hash
       FROM ada.product_category_embeddings
       WHERE product_code = ANY($1)`,
      [prepared.map((p) => p.product_code)],
    );
    for (const row of rows) {
      const existing = prepared.find((p) => p.product_code === row.product_code);
      if (existing && contentHash(existing.text) === row.content_hash) {
        skipSet.add(row.product_code);
      }
    }
  }

  const toEmbed = prepared.filter((p) => !skipSet.has(p.product_code));
  if (toEmbed.length === 0) return { embedded: 0, skipped: prepared.length };

  // Process in batches
  let embedded = 0;
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const chunk = toEmbed.slice(i, i + BATCH_SIZE);
    const texts = chunk.map((p) => p.text);
    const vectors = await callWithRetry(apiKey, texts);

    // Bulk upsert this chunk
    const productCodes  = chunk.map((p) => p.product_code);
    const textUseds     = chunk.map((p) => p.text);
    const hashes        = chunk.map((p) => contentHash(p.text));
    const embeddingStrs = vectors.map((v) => `[${v.join(",")}]`);

    await db.query(
      `INSERT INTO ada.product_category_embeddings
         (product_code, embedding, embedding_model, text_used, content_hash, embedded_at, updated_at)
       SELECT
         unnest($1::text[]),
         unnest($2::vector[]),
         $3,
         unnest($4::text[]),
         unnest($5::text[]),
         now(),
         now()
       ON CONFLICT (product_code) DO UPDATE SET
         embedding      = EXCLUDED.embedding,
         embedding_model= EXCLUDED.embedding_model,
         text_used      = EXCLUDED.text_used,
         content_hash   = EXCLUDED.content_hash,
         updated_at     = now()`,
      [productCodes, embeddingStrs, MODEL, textUseds, hashes],
    );

    embedded += chunk.length;
    process.stdout.write(`\r  embedded ${embedded}/${toEmbed.length}...`);
  }
  if (toEmbed.length > 0) process.stdout.write("\n");

  return { embedded, skipped: skipSet.size + (prepared.length - toEmbed.length - skipSet.size) };
}

module.exports = { upsertCategoryEmbeddings, buildEmbeddingText };
