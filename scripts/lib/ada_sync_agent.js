"use strict";

const fs = require("fs/promises");
const path = require("path");

const DEFAULT_DATASETS = ["branches", "products", "transfers"];
const DEFAULT_WATERMARK_FILE = path.resolve(__dirname, "..", ".ada_sync_watermarks.json");
const DEFAULT_FIXTURE_FILE = path.resolve(__dirname, "..", "fixtures", "ada_sync_simulation.json");
const DEFAULT_AGENT_VERSION = "0.1.0";

function parseBool(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseCsv(value, fallback = []) {
  if (!value) {
    return fallback.slice();
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    dryRun: null,
    datasets: null,
    branchCode: null,
    driver: null,
    fixturePath: null,
    watermarkFile: null,
    apiBaseUrl: null,
    apiKey: null,
    sourceLocation: null,
    agentName: null,
    agentVersion: null,
  };

  for (const arg of argv) {
    if (arg === "--execute") {
      args.dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const equalsIndex = arg.indexOf("=");
    const key = equalsIndex >= 0 ? arg.slice(2, equalsIndex) : arg.slice(2);
    const value = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : "";

    switch (key) {
      case "datasets":
        args.datasets = parseCsv(value, []);
        break;
      case "branch":
        args.branchCode = value || null;
        break;
      case "driver":
        args.driver = value || null;
        break;
      case "fixture":
        args.fixturePath = value || null;
        break;
      case "watermark-file":
        args.watermarkFile = value || null;
        break;
      case "api-base-url":
        args.apiBaseUrl = value || null;
        break;
      case "api-key":
        args.apiKey = value || null;
        break;
      case "source-location":
        args.sourceLocation = value || null;
        break;
      case "agent-name":
        args.agentName = value || null;
        break;
      case "agent-version":
        args.agentVersion = value || null;
        break;
      default:
        break;
    }
  }

  return args;
}

function loadAgentConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dryRun = args.dryRun != null ? args.dryRun : parseBool(env.ADAPOS_SYNC_DRY_RUN, true);
  const datasets = args.datasets && args.datasets.length ? args.datasets : parseCsv(env.ADAPOS_SYNC_DATASETS, DEFAULT_DATASETS);

  return {
    dryRun,
    datasets,
    branchCode: String(args.branchCode || env.ADAPOS_SYNC_BRANCH_CODE || "").trim() || null,
    driver: String(args.driver || env.ADAPOS_SYNC_DRIVER || "simulation").trim().toLowerCase(),
    fixturePath: path.resolve(args.fixturePath || env.ADAPOS_SYNC_FIXTURE_PATH || DEFAULT_FIXTURE_FILE),
    watermarkFile: path.resolve(args.watermarkFile || env.ADAPOS_SYNC_WATERMARK_FILE || DEFAULT_WATERMARK_FILE),
    apiBaseUrl: String(args.apiBaseUrl || env.ADAPOS_SYNC_API_BASE_URL || "").trim().replace(/\/+$/g, ""),
    apiKey: String(args.apiKey || env.POS_API_KEYS || "").split(",").map((entry) => entry.trim()).find(Boolean) || "",
    sourceLocation: String(args.sourceLocation || env.ADAPOS_SQLSERVER_HOST || env.ADAPOS_SYNC_SOURCE_LOCATION || "mother-pc").trim(),
    agentName: String(args.agentName || env.ADAPOS_SYNC_AGENT_NAME || "adapos-sync").trim(),
    agentVersion: String(args.agentVersion || env.ADAPOS_SYNC_AGENT_VERSION || DEFAULT_AGENT_VERSION).trim(),
    sqlserver: {
      host: String(env.ADAPOS_SQLSERVER_HOST || "").trim(),
      port: Number(env.ADAPOS_SQLSERVER_PORT || 1433),
      user: String(env.ADAPOS_SQLSERVER_USER || "").trim(),
      password: String(env.ADAPOS_SQLSERVER_PASSWORD || ""),
      database: String(env.ADAPOS_SQLSERVER_DATABASE || "AdaAcc").trim(),
      encrypt: parseBool(env.ADAPOS_SQLSERVER_ENCRYPT, false),
      trustServerCertificate: parseBool(env.ADAPOS_SQLSERVER_TRUST_SERVER_CERTIFICATE, true),
      requestTimeoutMs: Number(env.ADAPOS_SQLSERVER_REQUEST_TIMEOUT_MS || 30000),
    },
  };
}

async function loadWatermarks(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveWatermarks(filePath, watermarks) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(watermarks, null, 2)}\n`, "utf8");
}

function buildApiUrl(baseUrl, pathname) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl}${normalizedPath}`;
}

async function postJson(baseUrl, apiKey, pathname, body, fetchImpl = global.fetch) {
  if (!baseUrl) {
    throw new Error("ADAPOS_SYNC_API_BASE_URL is required when posting sync payloads");
  }
  if (!apiKey) {
    throw new Error("POS_API_KEYS or --api-key is required when posting sync payloads");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is not available in this Node runtime");
  }

  const response = await fetchImpl(buildApiUrl(baseUrl, pathname), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(`${pathname}: ${message}`);
  }
  return payload;
}

async function createSimulationExtractor(fixturePath) {
  const text = await fs.readFile(fixturePath, "utf8");
  const parsed = JSON.parse(text);
  return {
    async extractDataset(datasetName, watermarkFrom, options = {}) {
      const dataset = parsed?.datasets?.[datasetName];
      if (!dataset) {
        return { recordsRead: 0, payload: null, watermarkTo: watermarkFrom || null };
      }
      const clone = JSON.parse(JSON.stringify(dataset.payload || {}));
      const branchCode = String(options.branchCode || "").trim();

      if (branchCode && datasetName === "branches" && Array.isArray(clone.records)) {
        clone.records = clone.records.filter((record) => {
          const code = String(record.FTBchCode || record.branchCode || "").trim();
          return code === branchCode || code === "000";
        });
      }

      if (branchCode && datasetName === "transfers") {
        const filteredHeaders = Array.isArray(clone.headers)
          ? clone.headers.filter((record) => {
              const fromCode = String(record.FTBchCode || record.branchCode || "").trim();
              const toCode = String(record.FTBchCodeTo || record.branchCodeTo || "").trim();
              return fromCode === branchCode || toCode === branchCode;
            })
          : [];
        const allowedDocKeys = new Set(
          filteredHeaders.map((record) => [
            String(record.FTPthDocNo || record.docNo || "").trim(),
            String(record.FTPthDocType || record.docType || "").trim(),
            String(record.FTBchCode || record.branchCode || "").trim(),
          ].join("|")),
        );
        clone.headers = filteredHeaders;
        clone.lines = Array.isArray(clone.lines)
          ? clone.lines.filter((record) => {
              const key = [
                String(record.FTPthDocNo || record.docNo || "").trim(),
                String(record.FTPthDocType || record.docType || "").trim(),
                String(record.FTBchCode || record.branchCode || "").trim(),
              ].join("|");
              return allowedDocKeys.has(key);
            })
          : [];
      }

      return {
        recordsRead:
          Array.isArray(clone.records) ? clone.records.length
            : (Array.isArray(clone.headers) ? clone.headers.length : 0) + (Array.isArray(clone.lines) ? clone.lines.length : 0),
        payload: clone,
        watermarkTo: dataset.watermarkTo || clone.sourceSyncedAt || watermarkFrom || null,
        sourceTable: dataset.sourceTable || null,
      };
    },
  };
}

function getDatasetSql(datasetName, branchCode = null) {
  switch (datasetName) {
    case "branches":
      return `
        SELECT
          FTBchCode,
          FTBchName,
          FTBchNameTH,
          FTBchStaActive,
          CONVERT(varchar(33), GETUTCDATE(), 127) AS sourceSyncedAt
        FROM dbo.TCNMBranch
        ${branchCode ? "WHERE FTBchCode = @branchCode OR FTBchCode = '000'" : ""}
        ORDER BY FTBchCode ASC
      `;
    case "products":
      return `
        SELECT
          FTPdtCode,
          FTPdtName,
          FTSplCode,
          FTPdtGrpCode,
          FTPdtGrpName,
          FTPdtSUnit,
          FCPdtSFactor,
          FTPdtMUnit,
          FCPdtMFactor,
          FTPdtLUnit,
          FCPdtLFactor,
          FCPdtQtyNow,
          FCPdtQtyRet,
          FCPdtQtyWhs,
          FCPdtMin,
          FCPdtMax,
          FCPdtLeadTime,
          FTPdtStaActive,
          FTPdtBarCode1,
          FTPdtBarCode2,
          FTPdtBarCode3,
          CONVERT(varchar(33), GETUTCDATE(), 127) AS sourceSyncedAt
        FROM dbo.TCNMPdt
        ORDER BY FTPdtCode ASC
      `;
    case "transfers":
      return {
        headers: `
          SELECT
            FTPthDocNo,
            FTPthDocType,
            FTPthStaDoc,
            FTPthStaPrcDoc,
            FTBchCode,
            FTBchCodeTo,
            FTWahCode,
            FTWahCodeTo,
            FDPthDocDate,
            FTPthDocTime,
            FTPthApvCode,
            FTPthRmk,
            FTPthRefInt AS FTPthRefDoc,
            CONVERT(varchar(33), GETUTCDATE(), 127) AS sourceSyncedAt
          FROM dbo.TCNTPdtTnfHD
          WHERE (@watermarkFrom IS NULL OR FDPthDocDate >= @watermarkFrom)
            ${branchCode ? "AND (FTBchCode = @branchCode OR FTBchCodeTo = @branchCode)" : ""}
          ORDER BY FDPthDocDate ASC, FTPthDocNo ASC
        `,
        lines: `
          SELECT
            FTPthDocNo,
            FTPthDocType,
            FTBchCode,
            FNPtdSeqNo,
            FTPtdPdtCode,
            FTPtdBarCode,
            FTPunCode,
            FTPunName,
            FCPtdQtyAll,
            FCPtdQtyBase,
            FCPtdFactor AS FCPtdStkFac,
            FTPtdLotNo,
            FDPtdExpired,
            FTWahCode,
            FTPthRefInt AS FTPthRefDoc,
            FNPtdRefSeqNo,
            CONVERT(varchar(33), GETUTCDATE(), 127) AS sourceSyncedAt
          FROM dbo.TCNTPdtTnfDT
          WHERE EXISTS (
            SELECT 1
            FROM dbo.TCNTPdtTnfHD
            WHERE TCNTPdtTnfHD.FTPthDocNo = TCNTPdtTnfDT.FTPthDocNo
              AND TCNTPdtTnfHD.FTPthDocType = TCNTPdtTnfDT.FTPthDocType
              AND TCNTPdtTnfHD.FTBchCode = TCNTPdtTnfDT.FTBchCode
              AND (@watermarkFrom IS NULL OR FDPthDocDate >= @watermarkFrom)
              ${branchCode ? "AND (TCNTPdtTnfHD.FTBchCode = @branchCode OR TCNTPdtTnfHD.FTBchCodeTo = @branchCode)" : ""}
          )
          ORDER BY FTPthDocNo ASC, FNPtdSeqNo ASC
        `,
      };
    default:
      return null;
  }
}

async function createSqlServerExtractor(config, sqlLib = null) {
  let sql = sqlLib;
  if (!sql) {
    try {
      // Optional dependency on the mother-PC only.
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      sql = require("mssql");
    } catch (_error) {
      throw new Error("Live SQL Server sync requires the optional 'mssql' package to be installed on the mother-PC");
    }
  }

  const pool = new sql.ConnectionPool({
    server: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    options: {
      encrypt: Boolean(config.encrypt),
      trustServerCertificate: Boolean(config.trustServerCertificate),
    },
    requestTimeout: config.requestTimeoutMs,
  });

  await pool.connect();

  function ensureReadOnlySql(sqlText) {
    const normalized = String(sqlText).trim().toUpperCase();
    if (!(normalized.startsWith("SELECT") || normalized.startsWith("WITH"))) {
      throw new Error("AdaAcc extractor SQL must be read-only SELECT/WITH statements only");
    }
  }

  return {
    async extractDataset(datasetName, watermarkFrom) {
      const definition = getDatasetSql(datasetName, config.branchCode);
      if (!definition) {
        return { recordsRead: 0, payload: null, watermarkTo: watermarkFrom || null };
      }

      if (datasetName === "transfers") {
        ensureReadOnlySql(definition.headers);
        ensureReadOnlySql(definition.lines);

        const headerReq = pool.request();
        headerReq.input("watermarkFrom", sql.DateTime, watermarkFrom ? new Date(watermarkFrom) : null);
        if (config.branchCode) {
          headerReq.input("branchCode", sql.VarChar, config.branchCode);
        }
        const lineReq = pool.request();
        lineReq.input("watermarkFrom", sql.DateTime, watermarkFrom ? new Date(watermarkFrom) : null);
        if (config.branchCode) {
          lineReq.input("branchCode", sql.VarChar, config.branchCode);
        }

        const [headerResult, lineResult] = await Promise.all([
          headerReq.query(definition.headers),
          lineReq.query(definition.lines),
        ]);
        const headers = headerResult.recordset || [];
        const lines = lineResult.recordset || [];
        const lastHeader = headers[headers.length - 1] || null;

        return {
          recordsRead: headers.length + lines.length,
          payload: headers.length || lines.length ? {
            sourceSystem: "AdaAcc",
            sourceSyncedAt: lastHeader?.sourceSyncedAt || new Date().toISOString(),
            headers,
            lines,
          } : null,
          watermarkTo: lastHeader?.FDPthDocDate || lastHeader?.sourceSyncedAt || watermarkFrom || null,
          sourceTable: "TCNTPdtTnfHD/TCNTPdtTnfDT",
        };
      }

      ensureReadOnlySql(definition);
      const request = pool.request();
      if (datasetName !== "branches") {
        request.input("watermarkFrom", sql.DateTime, watermarkFrom ? new Date(watermarkFrom) : null);
      }
      if (config.branchCode && datasetName === "branches") {
        request.input("branchCode", sql.VarChar, config.branchCode);
      }
      const result = await request.query(definition);
      const records = result.recordset || [];
      const sourceSyncedAt = records[records.length - 1]?.sourceSyncedAt || new Date().toISOString();
      return {
        recordsRead: records.length,
        payload: records.length ? {
          sourceSystem: "AdaAcc",
          sourceSyncedAt,
          records,
        } : null,
        watermarkTo: sourceSyncedAt,
        sourceTable: datasetName === "branches" ? "TCNMBranch" : "TCNMPdt",
      };
    },
    async close() {
      await pool.close();
    },
  };
}

function createExtractor(config) {
  if (config.driver === "simulation") {
    return createSimulationExtractor(config.fixturePath);
  }
  if (config.driver === "sqlserver") {
    return createSqlServerExtractor({
      ...config.sqlserver,
      branchCode: config.branchCode,
    });
  }
  throw new Error(`Unsupported ADAPOS_SYNC_DRIVER: ${config.driver}`);
}

function datasetEndpoint(datasetName) {
  switch (datasetName) {
    case "branches":
      return "/api/sync/ada/branches";
    case "products":
      return "/api/sync/ada/products";
    case "transfers":
      return "/api/sync/ada/transfers";
    case "sales":
      return "/api/sync/ada/sales";
    case "purchases":
      return "/api/sync/ada/purchases";
    case "stock-snapshots":
      return "/api/sync/ada/stock-snapshots";
    default:
      throw new Error(`Unsupported dataset endpoint for ${datasetName}`);
  }
}

async function logRun(config, payload, fetchImpl) {
  return postJson(config.apiBaseUrl, config.apiKey, "/api/sync/ada/run-log", payload, fetchImpl);
}

async function runAdaSyncAgent(options = {}) {
  const config = options.config || loadAgentConfig(options.env, options.argv);
  const fetchImpl = options.fetchImpl || global.fetch;
  const extractor = options.extractor || await createExtractor(config);
  const initialWatermarks = options.initialWatermarks || await loadWatermarks(config.watermarkFile);
  const watermarks = { ...initialWatermarks };
  const startedAt = new Date().toISOString();
  let recordsRead = 0;
  let recordsSent = 0;
  const errors = [];
  const datasetResults = [];

  try {
    for (const datasetName of config.datasets) {
      const watermarkFrom = watermarks[datasetName] || null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const extracted = await extractor.extractDataset(datasetName, watermarkFrom, {
          branchCode: config.branchCode,
        });
        recordsRead += Number(extracted.recordsRead || 0);

        const result = {
          dataset: datasetName,
          dryRun: config.dryRun,
          watermarkFrom,
          watermarkTo: extracted.watermarkTo || watermarkFrom || null,
          recordsRead: Number(extracted.recordsRead || 0),
          recordsSent: 0,
          posted: false,
          branchCode: config.branchCode,
        };

        if (extracted.payload) {
          const payload = {
            ...extracted.payload,
            syncRunId: null,
          };
          if (!config.dryRun) {
            // eslint-disable-next-line no-await-in-loop
            await postJson(config.apiBaseUrl, config.apiKey, datasetEndpoint(datasetName), payload, fetchImpl);
            result.recordsSent = result.recordsRead;
            result.posted = true;
            recordsSent += result.recordsSent;
            watermarks[datasetName] = result.watermarkTo;
          }
        }

        datasetResults.push(result);
      } catch (error) {
        errors.push({
          dataset: datasetName,
          message: error.message,
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const status = errors.length ? "failed" : "success";
    const message = errors.length
      ? `ADA sync finished with ${errors.length} dataset error(s).`
      : (config.dryRun ? "ADA sync dry-run completed." : "ADA sync completed.");

    if (!config.dryRun) {
      await saveWatermarks(config.watermarkFile, watermarks);
    }

    if (config.apiBaseUrl && config.apiKey) {
      await logRun(
        config,
        {
          sourceSystem: "AdaAcc",
          sourceLocation: config.sourceLocation,
          agentName: config.agentName,
          agentVersion: config.agentVersion,
          syncType: config.dryRun ? "ada-sync-dry-run" : "ada-sync",
          startedAt,
          finishedAt,
          status,
          recordsRead,
          recordsSent,
          watermarkFrom: JSON.stringify(
            Object.fromEntries(config.datasets.map((dataset) => [dataset, initialWatermarks[dataset] || null])),
          ),
          watermarkTo: JSON.stringify(
            Object.fromEntries(config.datasets.map((dataset) => [dataset, watermarks[dataset] || null])),
          ),
          message,
          sourceTable: errors[0]?.dataset || null,
          errorCode: errors.length ? "ADA_SYNC_DATASET_ERROR" : null,
          errorDetails: errors.length ? { errors } : {},
          meta: {
            dryRun: config.dryRun,
            driver: config.driver,
            branchCode: config.branchCode,
            datasets: datasetResults,
          },
        },
        fetchImpl,
      );
    }

    return {
      dryRun: config.dryRun,
      status,
      recordsRead,
      recordsSent,
      datasets: datasetResults,
      errors,
      watermarks,
    };
  } finally {
    if (extractor && typeof extractor.close === "function") {
      await extractor.close();
    }
  }
}

module.exports = {
  DEFAULT_DATASETS,
  DEFAULT_FIXTURE_FILE,
  DEFAULT_WATERMARK_FILE,
  parseArgs,
  loadAgentConfig,
  loadWatermarks,
  saveWatermarks,
  createSimulationExtractor,
  createSqlServerExtractor,
  createExtractor,
  getDatasetSql,
  datasetEndpoint,
  runAdaSyncAgent,
};
