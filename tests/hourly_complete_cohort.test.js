"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const express = require("express"), request = require("supertest"), { Pool } = require("pg");
const { buildCohortCoverage } = require("../apps/admin-api/src/services/hourlyCohortCoverage");
const { payloadIdentity, parseCapturePayload } = require("../apps/admin-api/src/services/hourlyStockEvidence");
const { createHourlyStockEvidenceRouter } = require("../apps/admin-api/src/routes/hourly-stock-evidence");
const codes = count => Array.from({ length: count }, (_, i) => "SYNTHETIC-" + String(i).padStart(5, "0"));
const token = "synthetic-hourly-full-cohort-token".repeat(2);
let agentBuilders = null;
function capture(count, { expected = count, scope = "explicit", kind = "intraday", slot = "09:00", day = "2026-10-17", receipt = "1", complete = true } = {}) {
  const selected = codes(expected), rows = selected.slice(0, count).map(product_code => ({ product_code, qty: 10, latest_estimated_on_hand: 8 }));
  const observationKind = kind, capturedAt = new Date(`${day}T${slot}:30+07:00`).toISOString();
  const cohortCoverage = complete ? buildCohortCoverage({ expectedProductCodes: selected, rows, missingProductCodes: selected.slice(count), scope, observationKind,
    readBatchSize: kind === "intraday" ? 100 : 0, readBatchCount: kind === "intraday" ? Math.ceil(expected / 100) : 0, observationWindowMs: kind === "intraday" ? 50000 : 0 }) : null;
  const body = { contractVersion: "hourly-dual-stock-evidence-v1", datasetTag: "hourly_dual_stock_evidence", branchCode: "004", observationKind, plannedSlot: slot,
    capturedAt, sourceEventAt: null, records: rows.map(row => ({ productCode: row.product_code, retailOnHand: row.qty, latestEstimatedOnHand: row.latest_estimated_on_hand })),
    clientMeta: kind === "morning_anchor" ? { authoritativeSyncRunId: receipt } : {}, ...(cohortCoverage ? { cohortCoverage } : {}) };
  if (kind === "intraday" && complete) body.derivedObservation = { schemaVersion: "adapos-ordinary16-derived-v1", estimateBasis: "retail-plus-wholesale-plus-ordinary16",
    sampleCount: 2, consistency: "unverified", qualifying: false, businessCutoffAt: null,
    readStartedAt: new Date(Date.parse(capturedAt) - 50000).toISOString(), readCompletedAt: capturedAt,
    records: rows.map(row => ({ productCode: row.product_code, derivedOnHand: 8, reason: "observed-unverified" })) };
  if (agentBuilders) {
    const options = { branchCode: "004", observationKind, plannedSlot: slot, capturedAt, rows, clientMeta: body.clientMeta, cohortCoverage };
    return JSON.parse(body.derivedObservation ? agentBuilders.intraday(options, body.derivedObservation).body : agentBuilders.plain(options).body);
  }
  body.idempotencyKey = payloadIdentity(body);return body;
}
test("complete cohort parser is bounded, identity-bound, branch004-only, and keeps legacy 500 cap", () => {
  const full = capture(7042);assert.equal(parseCapturePayload(full).records.length, 7042);
  assert.throws(() => parseCapturePayload(capture(501, { complete: false })), /records/);
  assert.throws(() => capture(10001), /coverage/);
  assert.throws(() => parseCapturePayload({ ...full, branchCode: "001" }), /branch 004/);
  const changed = structuredClone(full);changed.cohortCoverage.scope = "web-all";assert.throws(() => parseCapturePayload(changed), /identity/);
  const overlap = structuredClone(full);overlap.cohortCoverage.expectedProductCount++;overlap.cohortCoverage.missingProductCodes.push(overlap.records[0].productCode);
  assert.throws(() => parseCapturePayload(overlap), /coverage/);
  const unsafe = structuredClone(full);unsafe.derivedObservation.records[0] = { ...unsafe.derivedObservation.records[0], reason: "changed-between-reads", derivedOnHand: 0 };
  assert.throws(() => parseCapturePayload(unsafe), /derived/);
});

test("complete collection permits the approved five-minute window while legacy derived reads retain ten seconds",()=>{
  const body=capture(7050);body.cohortCoverage.observationWindowMs=240000;
  body.derivedObservation.readStartedAt=new Date(Date.parse(body.capturedAt)-240000).toISOString();
  body.idempotencyKey=payloadIdentity(body);assert.equal(parseCapturePayload(body).records.length,7050);
  const tooLong=structuredClone(body);tooLong.cohortCoverage.observationWindowMs=300001;tooLong.idempotencyKey=payloadIdentity(tooLong);
  assert.throws(()=>parseCapturePayload(tooLong));
  const legacy=capture(50,{complete:false});legacy.derivedObservation={...body.derivedObservation,records:body.derivedObservation.records.slice(0,50)};
  legacy.idempotencyKey=payloadIdentity(legacy);assert.throws(()=>parseCapturePayload(legacy));
});
const databaseUrl = process.env.HOURLY_EVIDENCE_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
integration("REAL POSTGRES: complete cohort scale, one-slot reporting, catalog coverage, replay and OFF gates", async t => {
  // The owned local cross-repository harness sets this explicitly. CI also
  // exercises the backend's independent contract implementation below.
  if (process.env.HOURLY_COMPLETE_AGENT_SOURCE) {
    const source = path.resolve(process.env.HOURLY_COMPLETE_AGENT_SOURCE);
    const { pathToFileURL } = require("node:url");
    assert.equal(path.basename(source), "hourly-complete-cohort-agent");
    const plain = await import(pathToFileURL(path.join(source, "apps/adapos-sync/src/hourlyStockEvidenceClient.js")));
    const derived = await import(pathToFileURL(path.join(source, "apps/adapos-sync/src/hourlyDerivedObservation.js")));
    agentBuilders = { plain: plain.buildHourlyEvidencePayload, intraday: derived.buildHourlyIntradayPayload };
  }
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "::1", "[::1]"].includes(target.hostname), "refuse production or remote test database");
  assert.match(target.pathname, /^\/sc_hourly_evidence_test_[a-z0-9_]+$/);
  const db = new Pool({ connectionString: databaseUrl, max: 2 });
  const identity = await db.query("SELECT current_database() AS name");assert.match(identity.rows[0].name, /^sc_hourly_evidence_test_[a-z0-9_]+$/);
  t.after(async () => { await db.query("DROP SCHEMA IF EXISTS evidence CASCADE; DROP SCHEMA IF EXISTS ingest CASCADE; DROP TABLE IF EXISTS public.skus");await db.end(); });
  await db.query("DROP SCHEMA IF EXISTS evidence CASCADE; DROP SCHEMA IF EXISTS ingest CASCADE; DROP TABLE IF EXISTS public.skus");
  for (const file of ["074_add_hourly_dual_stock_evidence.sql", "075_allow_bounded_complete_hourly_cohorts.sql", "075_allow_bounded_complete_hourly_cohorts.sql"]) {
    await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", file), "utf8"));
  }
  await db.query("CREATE TABLE public.skus (company_code text PRIMARY KEY); CREATE SCHEMA ingest; CREATE TABLE ingest.sync_runs (sync_run_id bigint PRIMARY KEY, branch_code text, status text, snapshot_mode text, ingestion_mode text, apply_status text, finished_at timestamptz)");
  await db.query("INSERT INTO public.skus SELECT unnest($1::text[])", [codes(7042)]);
  await db.query("INSERT INTO ingest.sync_runs VALUES (1,'004','success','full','hybrid_v2','applied','2026-10-17T01:24:00Z'),(2,'004','success','full','hybrid_v2','applied','2026-10-18T01:24:00Z'),(3,'004','success','full','hybrid_v2','pending','2026-10-17T01:24:00Z')");
  const config = { featureHourlyStockEvidence: true, featureHourlyStockEvidenceCompleteCohort: true, featureHourlyStockEvidenceRetention: false,
    hourlyStockEvidenceBranchTokens: new Map([["004", token]]), hourlyStockEvidenceMaxSlotDelaySeconds: 300 };
  const app = express();app.use(express.json({ limit: "4mb" }));app.use("/evidence", createHourlyStockEvidenceRouter({ config, db,
    requireAuthMiddleware: (_q, _s, n) => n(), requireRoleMiddleware: () => (_q, _s, n) => n() }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: "test-handler-stopped" }));
  const send = value => request(app).post("/evidence/captures").set("x-branch-code", "004").set("x-hourly-evidence-token", token).send(value);
  await t.test("private catalog preparation requires branch identity and separate opt-in even while receiver is OFF", async () => {
    const get = () => request(app).get("/evidence/cohort?branchCode=004").set("x-branch-code","004").set("x-hourly-evidence-token",token);
    config.featureHourlyStockEvidence=false;const prepared=await get();assert.equal(prepared.status,200);assert.equal(prepared.body.productCodes.length,7042);assert.equal(prepared.headers["cache-control"],"no-store");
    assert.equal((await request(app).get("/evidence/cohort?branchCode=004")).status,401);
    assert.equal((await request(app).get("/evidence/cohort?branchCode=001").set("x-branch-code","004").set("x-hourly-evidence-token",token)).status,400);
    config.featureHourlyStockEvidenceCompleteCohort=false;assert.equal((await get()).status,503);
    config.featureHourlyStockEvidence=true;config.featureHourlyStockEvidenceCompleteCohort=true;
  });
  await t.test("sizes through the whole web and 10000 records persist exactly one capture each", async () => {
    for (const count of [50,100,200,500,501,1000,2000,5000,6827,7042,7050,10000]) {
      await db.query("TRUNCATE evidence.hourly_stock_capture_rows,evidence.hourly_stock_capture_runs RESTART IDENTITY");
      const response = await send(capture(count));assert.equal(response.status, 201);assert.equal(response.body.accepted, count);
      const stored = await db.query("SELECT (SELECT COUNT(*) FROM evidence.hourly_stock_capture_runs)::integer AS captures,(SELECT COUNT(*) FROM evidence.hourly_stock_capture_rows)::integer AS products");
      assert.deepEqual(stored.rows[0], { captures: 1, products: count });
    }
  });
  await t.test("all 13 slots of 7042 products remain complete and retries do not multiply captures", async () => {
    await db.query("TRUNCATE evidence.hourly_stock_capture_rows,evidence.hourly_stock_capture_runs RESTART IDENTITY");
    const slots = [capture(7042,{kind:"morning_anchor",slot:"08:20",scope:"web-all"}),
      ...Array.from({length:11},(_,i)=>capture(7042,{slot:String(i+9).padStart(2,"0")+":00",scope:"web-all"})),
      capture(7042,{kind:"morning_anchor",slot:"08:20",day:"2026-10-18",receipt:"2",scope:"web-all"})];
    for(const body of slots){const first=await send(body),duplicate=await send(body);assert.equal(first.status,201);assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);}
    const stored=await db.query("SELECT (SELECT COUNT(*) FROM evidence.hourly_stock_capture_runs)::integer AS captures,(SELECT COUNT(*) FROM evidence.hourly_stock_capture_rows)::integer AS products");
    assert.deepEqual(stored.rows[0],{captures:13,products:13*7042});
    const response=await request(app).get("/evidence/summary?branchCode=004&date=2026-10-17");assert.equal(response.status,200);
    assert.equal(response.body.dailyCompletenessStatus,"complete");assert.equal(response.body.slotEvidence.intraday.length,11);assert.equal(response.body.metrics.eligibleProducts,7042);
    assert.equal(response.body.slotEvidence.morning.captureCount,1);assert.equal(response.body.slotEvidence.nextMorning.captureCount,1);
    assert.ok(response.body.slotEvidence.intraday.every(slot=>slot.cohortCoverage.observedProducts===7042&&slot.captureCount===1&&slot.derivedObservationDiagnostics.observedProducts===7042));
    assert.equal(response.body.sourceFreshness.qualifying,false);const text=JSON.stringify(response.body);assert.ok(!text.includes("SYNTHETIC-"));assert.ok(!text.includes("cohortSha256"));
  });
  await t.test("215 missing source products stay explicit and never become zero rows or a coverage PASS", async () => {
    await db.query("TRUNCATE evidence.hourly_stock_capture_rows,evidence.hourly_stock_capture_runs RESTART IDENTITY");
    assert.equal((await send(capture(6827,{expected:7042,scope:"web-all",kind:"morning_anchor",slot:"08:20"}))).status,201);
    const response=await request(app).get("/evidence/summary?branchCode=004&date=2026-10-17");const coverage=response.body.slotEvidence.morning.cohortCoverage;
    assert.equal(coverage.expectedProducts,7042);assert.equal(coverage.observedProducts,6827);assert.equal(coverage.unavailableProducts,215);assert.equal(coverage.accountedProducts,7042);
    assert.equal(coverage.status,"incomplete-source");assert.equal(response.body.collectionQuality.qualifying,false);
    const count=await db.query("SELECT COUNT(*)::integer AS count FROM evidence.hourly_stock_capture_rows");assert.equal(count.rows[0].count,6827);
  });
  await t.test("catalog drift and non-APPLIED Full receipts roll back the entire capture", async () => {
    await db.query("TRUNCATE evidence.hourly_stock_capture_rows,evidence.hourly_stock_capture_runs RESTART IDENTITY");
    await db.query("INSERT INTO public.skus VALUES ('SYNTHETIC-NEW')");assert.equal((await send(capture(7042,{scope:"web-all"}))).status,409);
    await db.query("DELETE FROM public.skus WHERE company_code='SYNTHETIC-NEW'");
    assert.equal((await send(capture(7042,{kind:"morning_anchor",slot:"08:20",receipt:"3"}))).status,409);
    const count=await db.query("SELECT COUNT(*)::integer AS count FROM evidence.hourly_stock_capture_runs");assert.equal(count.rows[0].count,0);
  });
  await t.test("exact replay still acknowledges an already committed capture after catalog drift",async()=>{
    const body=capture(7042,{scope:"web-all"});assert.equal((await send(body)).status,201);
    await db.query("INSERT INTO public.skus VALUES ('SYNTHETIC-NEW')");
    const replay=await send(body);assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);
    await db.query("DELETE FROM public.skus WHERE company_code='SYNTHETIC-NEW'");
  });
  await t.test("aggregate source-read metadata scales with the capture and changed cohorts cannot qualify",async()=>{
    await db.query("TRUNCATE evidence.hourly_stock_capture_rows,evidence.hourly_stock_capture_runs RESTART IDENTITY");
    const morning=capture(7042,{kind:"morning_anchor",slot:"08:20"});
    assert.equal((await send(morning)).status,201);
    const intraday=capture(10000);
    const counters=["productCount","missingEstimateProducts","missingPendingProducts","missingRefreshProducts","invalidRefreshProducts","nonMasterProducts","nonzeroDayEndProducts","nonzeroPendingNowProducts","formulaMatchedProducts","formulaMismatchProducts","formulaUnknownProducts"];
    intraday.clientMeta.sourceRead={schemaVersion:"adapos-stored-stock-read-v1",estimateBasis:"stored-master-day-end",
      ...Object.fromEntries(counters.map(key=>[key,0])),productCount:10000,formulaMatchedProducts:10000,
      readAt:intraday.capturedAt,oldestRefreshAt:"2026-10-16T00:00:00.000Z",newestRefreshAt:"2026-10-16T00:00:00.000Z"};
    assert.equal((await send(intraday)).status,201);
    const response=await request(app).get("/evidence/summary?branchCode=004&date=2026-10-17");
    assert.equal(response.status,200);assert.equal(response.body.slotEvidence.intraday[0].sourceReadDiagnostics.sourceRead.productCount,10000);
    assert.equal(response.body.slotEvidence.intraday[0].sourceReadDiagnostics.qualifying,false);
    assert.equal(response.body.collectionQuality.qualifying,false);assert.ok(response.body.collectionQuality.reasons.includes("cohort-changed-between-slots"));
  });
  await t.test("complete-cohort opt-in is OFF by default and separate from legacy capture ingestion", async () => {
    config.featureHourlyStockEvidenceCompleteCohort=false;assert.equal((await send(capture(7042))).status,503);
    assert.equal((await send(capture(50,{complete:false}))).status,201);config.featureHourlyStockEvidence=false;
    assert.equal((await send(capture(50,{complete:false}))).status,503);config.featureHourlyStockEvidence=true;config.featureHourlyStockEvidenceCompleteCohort=true;
  });
  await t.test("large bodies remain bounded and oversized legacy records cannot bypass their limit", async () => {
    const response=await request(app).post("/evidence/captures").set("x-branch-code","004").set("x-hourly-evidence-token",token).send({padding:"x".repeat(4*1024*1024)});
    assert.equal(response.status,413);const invalid=capture(501);delete invalid.cohortCoverage;invalid.idempotencyKey=payloadIdentity(invalid);assert.equal((await send(invalid)).status,400);
  });
});
