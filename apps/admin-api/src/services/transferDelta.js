"use strict";

const { createHash, randomUUID } = require("node:crypto");

const CONTRACT_VERSION = "transfer-delta-v1";
const DATASET = "transfers";
const ACTIVE_TRANSFER_BRANCHES = new Set(["000", "001", "003", "004", "005"]);

function isActiveTransferBranch(branchCode) {
  return ACTIVE_TRANSFER_BRANCHES.has(String(branchCode || "").trim());
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function nullable(value) {
  return normalizeText(value) || null;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value) {
  return nullable(value)?.slice(0, 10) || null;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function deltaError(message, status = 400, code = "TRANSFER_DELTA_INVALID") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function calculateContentHash(body) {
  return sha256(JSON.stringify({
    branchCode: String(body.branchCode),
    contractVersion: String(body.contractVersion),
    baseCheckpointToken: body.baseCheckpointToken ?? null,
    baseStateHash: body.baseStateHash,
    nextStateHash: body.nextStateHash,
    headers: body.headers,
    lines: body.lines,
    tombstones: body.tombstones,
  }));
}

function validateEnvelope(body, headers, lines) {
  if (!body || body.contractVersion !== CONTRACT_VERSION) {
    throw deltaError("Unsupported Transfer Delta contract.", 409, "TRANSFER_DELTA_CONTRACT");
  }
  const branchCode = nullable(body.branchCode);
  if (!branchCode || !/^\d{3}$/.test(branchCode)) {
    throw deltaError("Transfer Delta branchCode must be three digits.");
  }
  if (!Array.isArray(body.tombstones)) {
    throw deltaError("Transfer Delta payload requires tombstones[].");
  }
  if (!/^[a-f0-9]{64}$/.test(String(body.idempotencyKey || ""))) {
    throw deltaError("Transfer Delta idempotencyKey must be SHA-256 hex.");
  }
  if (!/^[a-f0-9]{64}$/.test(String(body.contentHash || ""))) {
    throw deltaError("Transfer Delta contentHash must be SHA-256 hex.");
  }
  if (!/^[a-f0-9]{64}$/.test(String(body.baseStateHash || ""))
    || !/^[a-f0-9]{64}$/.test(String(body.nextStateHash || ""))) {
    throw deltaError("Transfer Delta requires SHA-256 baseStateHash and nextStateHash.");
  }
  const calculatedHash = calculateContentHash(body);
  if (calculatedHash !== body.contentHash) {
    throw deltaError("Transfer Delta content hash mismatch.", 409, "TRANSFER_DELTA_HASH_MISMATCH");
  }
  const expectedIdempotencyKey = sha256(JSON.stringify([
    branchCode,
    CONTRACT_VERSION,
    body.baseCheckpointToken ?? null,
    body.baseStateHash,
    body.nextStateHash,
    calculatedHash,
  ]));
  if (expectedIdempotencyKey !== body.idempotencyKey) {
    throw deltaError("Transfer Delta idempotency key is not bound to this state transition.", 409,
      "TRANSFER_DELTA_IDEMPOTENCY_CONFLICT");
  }

  const headerKeys = new Set();
  for (const header of headers) {
    if (normalizeText(header.branchCode) !== branchCode) {
      throw deltaError("Transfer Delta cannot mix branch codes.");
    }
    const key = JSON.stringify([normalizeText(header.branchCode), normalizeText(header.docType), normalizeText(header.docNo)]);
    if (headerKeys.has(key)) throw deltaError("Transfer Delta contains a duplicate document header.");
    headerKeys.add(key);
  }
  for (const line of lines) {
    const key = JSON.stringify([normalizeText(line.branchCode), normalizeText(line.docType), normalizeText(line.docNo)]);
    if (!headerKeys.has(key)) throw deltaError("Every Transfer Delta line requires its complete document header.");
  }
  for (const tombstone of body.tombstones) {
    if (
      nullable(tombstone.branchCode) !== branchCode
      || !nullable(tombstone.docType)
      || !nullable(tombstone.docNo)
      || tombstone.evidenceType !== "source-hard-delete"
      || !nullable(tombstone.evidenceId)
    ) {
      throw deltaError("Hard tombstones require branch/doc identity and explicit source-hard-delete evidence.");
    }
    const key = JSON.stringify([branchCode, normalizeText(tombstone.docType), normalizeText(tombstone.docNo)]);
    if (headerKeys.has(key)) throw deltaError("A document cannot be replaced and tombstoned in one Delta request.");
  }
  return { branchCode, calculatedHash };
}

function headerWrite(body, record) {
  return {
    docNo: nullable(record.docNo), docType: nullable(record.docType), branchCode: nullable(record.branchCode),
    docStatus: nullable(record.FTPthStaDoc ?? record.docStatus),
    processStatus: nullable(record.FTPthStaPrcDoc ?? record.processStatus),
    branchCodeTo: nullable(record.branchCodeTo), warehouseCode: nullable(record.warehouseCode),
    warehouseCodeTo: nullable(record.FTWahCodeTo ?? record.warehouseCodeTo ?? record.whTo),
    docDate: dateOnly(record.docDate), docTime: nullable(record.FTPthDocTime ?? record.docTime),
    approvedAt: nullable(record.FDPthApprove ?? record.approvedAt),
    processedAt: nullable(record.FDPthPrcDate ?? record.processedAt),
    createdBy: nullable(record.createdBy), approvedBy: nullable(record.approvedBy),
    remark: nullable(record.FTPthRmk ?? record.remark),
    referenceDocNo: nullable(record.FTPthRefDoc ?? record.referenceDocNo),
    referenceDocType: nullable(record.FTPthRefType ?? record.referenceDocType),
    sourceSystem: nullable(body.sourceSystem) || "adapos",
    sourceTable: nullable(record.sourceTable) || "TCNTPdtTnfHD",
    sourceSyncedAt: nullable(body.syncedAt) || new Date().toISOString(),
    rawPayload: JSON.stringify(record.__rawPayload || record),
  };
}

function lineWrite(body, record) {
  return {
    docNo: nullable(record.docNo), docType: nullable(record.docType), branchCode: nullable(record.branchCode),
    lineNo: Number(record.lineNo), productCode: nullable(record.productCode),
    barcode: nullable(record.FTPtdBarCode ?? record.barcode), unitCode: nullable(record.unitCode),
    unitName: nullable(record.unitName), qty: numberOrNull(record.qty), qtyBase: numberOrNull(record.qtyBase),
    stockFactor: numberOrNull(record.stockFactor), lotNo: nullable(record.FTPtdLotNo ?? record.lotNo),
    expiryDate: dateOnly(record.FDPtdExpired ?? record.expiryDate), warehouseCode: nullable(record.warehouseCode),
    referenceDocNo: nullable(record.FTPthRefDoc ?? record.referenceDocNo),
    referenceLineNo: nullable(record.FNPtdRefSeqNo ?? record.referenceLineNo),
    sourceSystem: nullable(body.sourceSystem) || "adapos",
    sourceTable: nullable(record.sourceTable) || "TCNTPdtTnfDT",
    sourceSyncedAt: nullable(body.syncedAt) || new Date().toISOString(),
    rawPayload: JSON.stringify(record.__rawPayload || record),
  };
}

async function replaceDocument(client, body, header, documentLines) {
  const h = headerWrite(body, header);
  await client.query(
    `INSERT INTO ada.transfer_headers
      (doc_no, doc_type, doc_status, process_status, branch_code, branch_code_to,
       warehouse_code, warehouse_code_to, doc_date, doc_time, approved_at, processed_at,
       created_by, approved_by, remark, reference_doc_no, reference_doc_type,
       source_system, source_table, source_synced_at, raw_payload, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,now())
     ON CONFLICT (doc_no, doc_type, branch_code) DO UPDATE SET
       doc_status=EXCLUDED.doc_status, process_status=EXCLUDED.process_status,
       branch_code_to=EXCLUDED.branch_code_to, warehouse_code=EXCLUDED.warehouse_code,
       warehouse_code_to=EXCLUDED.warehouse_code_to, doc_date=EXCLUDED.doc_date,
       doc_time=EXCLUDED.doc_time, approved_at=EXCLUDED.approved_at, processed_at=EXCLUDED.processed_at,
       created_by=EXCLUDED.created_by, approved_by=EXCLUDED.approved_by, remark=EXCLUDED.remark,
       reference_doc_no=EXCLUDED.reference_doc_no, reference_doc_type=EXCLUDED.reference_doc_type,
       source_system=EXCLUDED.source_system, source_table=EXCLUDED.source_table,
       source_synced_at=EXCLUDED.source_synced_at, raw_payload=EXCLUDED.raw_payload, updated_at=now()`,
    [h.docNo,h.docType,h.docStatus,h.processStatus,h.branchCode,h.branchCodeTo,h.warehouseCode,h.warehouseCodeTo,
      h.docDate,h.docTime,h.approvedAt,h.processedAt,h.createdBy,h.approvedBy,h.remark,h.referenceDocNo,
      h.referenceDocType,h.sourceSystem,h.sourceTable,h.sourceSyncedAt,h.rawPayload],
  );

  // The payload contains the full current line set for this changed document.
  // Deleting only this document's previous lines inside the same transaction
  // makes removed-line handling explicit without inferring document deletion.
  await client.query(
    "DELETE FROM ada.transfer_lines WHERE branch_code=$1 AND doc_type=$2 AND doc_no=$3",
    [h.branchCode, h.docType, h.docNo],
  );
  if (documentLines.length) {
    const rows = documentLines.map((record) => lineWrite(body, record));
    await client.query(
      `INSERT INTO ada.transfer_lines
        (doc_no,doc_type,branch_code,line_no,product_code,barcode,unit_code,unit_name,qty,qty_base,
         stock_factor,lot_no,expiry_date,warehouse_code,reference_doc_no,reference_line_no,
         source_system,source_table,source_synced_at,raw_payload,updated_at)
       SELECT u.doc_no,u.doc_type,u.branch_code,u.line_no,u.product_code,u.barcode,u.unit_code,u.unit_name,
              u.qty,u.qty_base,u.stock_factor,u.lot_no,u.expiry_date,u.warehouse_code,u.reference_doc_no,
              u.reference_line_no,u.source_system,u.source_table,u.source_synced_at,u.raw_payload::jsonb,now()
       FROM UNNEST($1::text[],$2::text[],$3::text[],$4::integer[],$5::text[],$6::text[],$7::text[],$8::text[],
                   $9::numeric[],$10::numeric[],$11::numeric[],$12::text[],$13::date[],$14::text[],
                   $15::text[],$16::text[],$17::text[],$18::text[],$19::timestamptz[],$20::text[])
       AS u(doc_no,doc_type,branch_code,line_no,product_code,barcode,unit_code,unit_name,qty,qty_base,
            stock_factor,lot_no,expiry_date,warehouse_code,reference_doc_no,reference_line_no,
            source_system,source_table,source_synced_at,raw_payload)`,
      [rows.map((r)=>r.docNo),rows.map((r)=>r.docType),rows.map((r)=>r.branchCode),rows.map((r)=>r.lineNo),
        rows.map((r)=>r.productCode),rows.map((r)=>r.barcode),rows.map((r)=>r.unitCode),rows.map((r)=>r.unitName),
        rows.map((r)=>r.qty),rows.map((r)=>r.qtyBase),rows.map((r)=>r.stockFactor),rows.map((r)=>r.lotNo),
        rows.map((r)=>r.expiryDate),rows.map((r)=>r.warehouseCode),rows.map((r)=>r.referenceDocNo),
        rows.map((r)=>r.referenceLineNo),rows.map((r)=>r.sourceSystem),rows.map((r)=>r.sourceTable),
        rows.map((r)=>r.sourceSyncedAt),rows.map((r)=>r.rawPayload)],
    );
  }
}

async function readCapability(db, config, branchCode, contractVersion) {
  const allowed = config.featureTransferDeltaApply === true
    && config.transferDeltaBranches instanceof Set
    && config.transferDeltaBranches.has(branchCode)
    && isActiveTransferBranch(branchCode);
  if (!allowed || contractVersion !== CONTRACT_VERSION) {
    return { enabled: false, mode: "full", contractVersion: CONTRACT_VERSION, checkpointToken: null };
  }
  const result = await db.query(
    `SELECT checkpoint_sequence,checkpoint_token,state_hash FROM ada.transfer_delta_checkpoints
     WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3`,
    [branchCode, DATASET, CONTRACT_VERSION],
  );
  return {
    enabled: true,
    mode: "delta_apply",
    contractVersion: CONTRACT_VERSION,
    checkpointToken: result.rows[0]?.checkpoint_token ?? null,
    checkpointSequence: Number(result.rows[0]?.checkpoint_sequence ?? 0),
    stateHash: result.rows[0]?.state_hash ?? null,
    hardTombstones: config.featureTransferDeltaHardTombstones === true
      ? "explicit-source-evidence-only" : "disabled",
  };
}

async function applyTransferDelta(client, body, headers, lines, options = {}) {
  const { branchCode, calculatedHash } = validateEnvelope(body, headers, lines);
  if (body.tombstones.length && options.allowHardTombstones !== true) {
    throw deltaError("Transfer Delta hard tombstones are disabled.", 409, "TRANSFER_DELTA_TOMBSTONES_DISABLED");
  }
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO ada.transfer_delta_checkpoints
        (branch_code,dataset,contract_version,checkpoint_sequence,checkpoint_token)
       VALUES ($1,$2,$3,0,NULL)
       ON CONFLICT (branch_code,dataset,contract_version) DO NOTHING`,
      [branchCode, DATASET, CONTRACT_VERSION],
    );
    const checkpointResult = await client.query(
      `SELECT checkpoint_sequence,checkpoint_token,state_hash FROM ada.transfer_delta_checkpoints
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3 FOR UPDATE`,
      [branchCode, DATASET, CONTRACT_VERSION],
    );
    const checkpoint = checkpointResult.rows[0];
    const replayResult = await client.query(
      `SELECT content_hash,response_payload,status FROM ada.transfer_delta_requests
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3 AND idempotency_key=$4`,
      [branchCode, DATASET, CONTRACT_VERSION, body.idempotencyKey],
    );
    if (replayResult.rows.length) {
      const replay = replayResult.rows[0];
      if (replay.content_hash !== calculatedHash) {
        throw deltaError("Idempotency key already exists with a different content hash.", 409, "TRANSFER_DELTA_IDEMPOTENCY_CONFLICT");
      }
      if (replay.status !== "applied" || !replay.response_payload) {
        throw deltaError("Prior request is not terminal.", 409, "TRANSFER_DELTA_NOT_TERMINAL");
      }
      if (replay.response_payload.checkpointToken !== checkpoint.checkpoint_token
        || Number(replay.response_payload.checkpointSequence) !== Number(checkpoint.checkpoint_sequence)) {
        throw deltaError("Replayed Transfer Delta acknowledgement is no longer current.", 409, "TRANSFER_DELTA_REPLAY_STALE");
      }
      await client.query("COMMIT");
      return { ...replay.response_payload, replayed: true };
    }

    const suppliedBase = body.baseCheckpointToken == null ? null : String(body.baseCheckpointToken);
    if (suppliedBase !== (checkpoint.checkpoint_token ?? null)) {
      throw deltaError("Transfer Delta base checkpoint is stale or out of order.", 409, "TRANSFER_DELTA_CHECKPOINT_CONFLICT");
    }
    if (body.baseStateHash !== (checkpoint.state_hash ?? null)) {
      throw deltaError("Transfer Delta base state hash does not match the durable checkpoint.", 409, "TRANSFER_DELTA_STATE_CONFLICT");
    }
    const nextSequence = Number(checkpoint.checkpoint_sequence) + 1;
    const nextToken = randomUUID();
    const requestInsert = await client.query(
      `INSERT INTO ada.transfer_delta_requests
        (branch_code,dataset,contract_version,operation,idempotency_key,content_hash,base_checkpoint_token,
         base_state_hash,next_state_hash,checkpoint_sequence,checkpoint_token,status,header_count,line_count,tombstone_count)
       VALUES ($1,$2,$3,'apply',$4,$5,$6,$7,$8,$9,$10,'applying',$11,$12,$13)
       RETURNING transfer_delta_request_id`,
      [branchCode,DATASET,CONTRACT_VERSION,body.idempotencyKey,calculatedHash,suppliedBase,
        body.baseStateHash,body.nextStateHash,nextSequence,nextToken,
        headers.length,lines.length,body.tombstones.length],
    );
    const requestId = requestInsert.rows[0].transfer_delta_request_id;
    const linesByDocument = new Map();
    for (const line of lines) {
      const key = JSON.stringify([normalizeText(line.branchCode),normalizeText(line.docType),normalizeText(line.docNo)]);
      if (!linesByDocument.has(key)) linesByDocument.set(key, []);
      linesByDocument.get(key).push(line);
    }
    for (const header of headers) {
      const key = JSON.stringify([normalizeText(header.branchCode),normalizeText(header.docType),normalizeText(header.docNo)]);
      // eslint-disable-next-line no-await-in-loop
      await replaceDocument(client, body, header, linesByDocument.get(key) || []);
    }
    for (const tombstone of body.tombstones) {
      const params = [branchCode,normalizeText(tombstone.docType),normalizeText(tombstone.docNo)];
      // eslint-disable-next-line no-await-in-loop
      await client.query("DELETE FROM ada.transfer_lines WHERE branch_code=$1 AND doc_type=$2 AND doc_no=$3", params);
      // eslint-disable-next-line no-await-in-loop
      await client.query("DELETE FROM ada.transfer_headers WHERE branch_code=$1 AND doc_type=$2 AND doc_no=$3", params);
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO ada.transfer_delta_tombstone_audit
          (transfer_delta_request_id,branch_code,doc_type,doc_no,evidence_type,evidence_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [requestId,...params,tombstone.evidenceType,normalizeText(tombstone.evidenceId)],
      );
    }
    const response = {
      ok: true,
      contractVersion: CONTRACT_VERSION,
      idempotencyKey: body.idempotencyKey,
      contentHash: calculatedHash,
      checkpointToken: nextToken,
      checkpointSequence: nextSequence,
      stateHash: body.nextStateHash,
      acceptedHeaders: headers.length,
      acceptedLines: lines.length,
      acceptedTombstones: body.tombstones.length,
      replayed: false,
    };
    await client.query(
      `UPDATE ada.transfer_delta_requests SET status='applied',response_payload=$2::jsonb,applied_at=now()
       WHERE transfer_delta_request_id=$1`,
      [requestId, JSON.stringify(response)],
    );
    await client.query(
      `UPDATE ada.transfer_delta_checkpoints
       SET checkpoint_sequence=$4,checkpoint_token=$5,state_hash=$6,updated_at=now()
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3`,
      [branchCode,DATASET,CONTRACT_VERSION,nextSequence,nextToken,body.nextStateHash],
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function rebaselineTransferDelta(client, body) {
  const branchCode = nullable(body?.branchCode);
  if (!branchCode || !/^\d{3}$/.test(branchCode) || body?.contractVersion !== CONTRACT_VERSION
    || !/^[a-f0-9]{64}$/.test(String(body?.stateHash || ""))
    || !/^[a-f0-9]{64}$/.test(String(body?.idempotencyKey || ""))) {
    throw deltaError("Invalid Transfer Delta rebaseline payload.");
  }
  const expectedIdempotencyKey = sha256(JSON.stringify([
    branchCode,
    CONTRACT_VERSION,
    "rebaseline",
    body.baseCheckpointToken ?? null,
    body.stateHash,
  ]));
  if (body.idempotencyKey !== expectedIdempotencyKey) {
    throw deltaError("Transfer Delta rebaseline idempotency key is not bound to this checkpoint.", 409,
      "TRANSFER_DELTA_IDEMPOTENCY_CONFLICT");
  }
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO ada.transfer_delta_checkpoints
        (branch_code,dataset,contract_version,checkpoint_sequence,checkpoint_token,state_hash)
       VALUES ($1,$2,$3,0,NULL,NULL)
       ON CONFLICT (branch_code,dataset,contract_version) DO NOTHING`,
      [branchCode,DATASET,CONTRACT_VERSION],
    );
    const checkpointResult = await client.query(
      `SELECT checkpoint_sequence,checkpoint_token FROM ada.transfer_delta_checkpoints
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3 FOR UPDATE`,
      [branchCode,DATASET,CONTRACT_VERSION],
    );
    const replayResult = await client.query(
      `SELECT content_hash,response_payload,status FROM ada.transfer_delta_requests
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3 AND idempotency_key=$4`,
      [branchCode,DATASET,CONTRACT_VERSION,body.idempotencyKey],
    );
    if (replayResult.rows.length) {
      const replay = replayResult.rows[0];
      if (replay.content_hash !== body.stateHash) {
        throw deltaError("Rebaseline idempotency key conflicts with another state.",409,"TRANSFER_DELTA_IDEMPOTENCY_CONFLICT");
      }
      if (replay.status !== "applied" || !replay.response_payload) {
        throw deltaError("Prior rebaseline request is not terminal.",409,"TRANSFER_DELTA_NOT_TERMINAL");
      }
      const currentCheckpoint = checkpointResult.rows[0];
      if (replay.response_payload.checkpointToken !== currentCheckpoint.checkpoint_token
        || Number(replay.response_payload.checkpointSequence) !== Number(currentCheckpoint.checkpoint_sequence)) {
        throw deltaError("Replayed rebaseline acknowledgement is no longer current.",409,"TRANSFER_DELTA_REPLAY_STALE");
      }
      await client.query("COMMIT");
      return { ...replay.response_payload, replayed: true };
    }
    const checkpoint = checkpointResult.rows[0];
    const suppliedBase = body.baseCheckpointToken == null ? null : String(body.baseCheckpointToken);
    if (suppliedBase !== (checkpoint.checkpoint_token ?? null)) {
      throw deltaError("Transfer Delta rebaseline checkpoint is stale.",409,"TRANSFER_DELTA_CHECKPOINT_CONFLICT");
    }
    const nextSequence = Number(checkpoint.checkpoint_sequence) + 1;
    const nextToken = randomUUID();
    const response = { ok:true,contractVersion:CONTRACT_VERSION,idempotencyKey:body.idempotencyKey,
      stateHash:body.stateHash,checkpointToken:nextToken,checkpointSequence:nextSequence,replayed:false };
    await client.query(
      `INSERT INTO ada.transfer_delta_requests
        (branch_code,dataset,contract_version,operation,idempotency_key,content_hash,base_checkpoint_token,
         base_state_hash,next_state_hash,checkpoint_sequence,checkpoint_token,status,response_payload,applied_at)
       VALUES ($1,$2,$3,'rebaseline',$4,$5,$6,NULL,$5,$7,$8,'applied',$9::jsonb,now())`,
      [branchCode,DATASET,CONTRACT_VERSION,body.idempotencyKey,body.stateHash,suppliedBase,
        nextSequence,nextToken,JSON.stringify(response)],
    );
    await client.query(
      `UPDATE ada.transfer_delta_checkpoints SET checkpoint_sequence=$4,checkpoint_token=$5,state_hash=$6,updated_at=now()
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3`,
      [branchCode,DATASET,CONTRACT_VERSION,nextSequence,nextToken,body.stateHash],
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

module.exports = {
  CONTRACT_VERSION,
  applyTransferDelta,
  calculateContentHash,
  isActiveTransferBranch,
  readCapability,
  rebaselineTransferDelta,
  validateEnvelope,
};
