import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";
import { ApiError, api } from "../lib/api";
import { formatDateTime, formatNumber, titleize } from "../lib/format";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  "",
  "outbound_only",
  "inbound_present_unprocessed",
  "inbound_processed",
  "ambiguous_match",
  "inbound_only_unmatched",
  "draft",
  "confirmed",
  "discrepancy_recorded",
  "approved",
  "cancelled",
];

function buildLineKey(line) {
  return [
    line.productCode || "",
    line.barcode || "",
    line.unitCode || "",
    line.lotNo || "",
    line.expiryDate || "",
  ].join("|");
}

function buildAppLineKey(line) {
  return [
    line.productCode || "",
    line.sourceBarcode || "",
    line.sourceUnitCode || "",
    line.lotNo || "",
    line.expiryDate || "",
  ].join("|");
}

function initialFilters(searchParams) {
  return {
    branch: searchParams.get("branch") || "",
    dateFrom: searchParams.get("dateFrom") || "",
    dateTo: searchParams.get("dateTo") || "",
    status: searchParams.get("status") || "",
  };
}

function initialOffset(searchParams) {
  const raw = Number(searchParams.get("offset") || 0);
  return Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

function buildQueryParams(filters, offset, caseKey) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  if (offset > 0) {
    params.set("offset", String(offset));
  }
  if (caseKey) {
    params.set("caseKey", caseKey);
  }
  return params;
}

export function ReconciliationPage() {
  const { csrfToken } = useAuth();
  const { withLoading, showToast } = useUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [branches, setBranches] = useState([]);
  const [filters, setFilters] = useState(() => initialFilters(searchParams));
  const [offset, setOffset] = useState(() => initialOffset(searchParams));
  const [summary, setSummary] = useState(null);
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedCaseKey, setSelectedCaseKey] = useState(searchParams.get("caseKey") || "");
  const [detail, setDetail] = useState(null);
  const [loadingCases, setLoadingCases] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [lineInputs, setLineInputs] = useState({});
  const [discrepancyForm, setDiscrepancyForm] = useState({
    reason: "",
    note: "",
  });
  const [eventForm, setEventForm] = useState({
    eventType: "note_added",
    note: "",
  });

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const requestQuery = useMemo(
    () => ({
      ...filters,
      limit: PAGE_SIZE,
      offset,
    }),
    [filters, offset],
  );

  useEffect(() => {
    withLoading(async () => {
      try {
        const data = await api.listBranches();
        setBranches(data || []);
      } catch (error) {
        showToast(error instanceof ApiError ? error.message : "Failed to load branches", "error");
      }
    });
  }, [showToast, withLoading]);

  useEffect(() => {
    const nextFilters = initialFilters(searchParams);
    const nextOffset = initialOffset(searchParams);
    const nextCaseKey = searchParams.get("caseKey") || "";
    setFilters((prev) => (JSON.stringify(prev) === JSON.stringify(nextFilters) ? prev : nextFilters));
    setOffset((prev) => (prev === nextOffset ? prev : nextOffset));
    setSelectedCaseKey((prev) => (prev === nextCaseKey ? prev : nextCaseKey));
  }, [searchParams]);

  useEffect(() => {
    let alive = true;
    setLoadingCases(true);
    setListError("");

    Promise.all([
      api.getReconciliationSummary(filters),
      api.listReconciliationCases(requestQuery),
    ])
      .then(([summaryData, caseData]) => {
        if (!alive) {
          return;
        }
        setSummary(summaryData);
        setCases(caseData.rows || []);
        setTotal(caseData.total || 0);

        const currentCaseKey = selectedCaseKey;
        if (!currentCaseKey && caseData.rows?.length) {
          const nextCaseKey = caseData.rows[0].caseKey;
          setSelectedCaseKey(nextCaseKey);
          setSearchParams(buildQueryParams(filters, offset, nextCaseKey));
        } else if (currentCaseKey && !(caseData.rows || []).some((row) => row.caseKey === currentCaseKey)) {
          if (caseData.rows?.length) {
            const nextCaseKey = caseData.rows[0].caseKey;
            setSelectedCaseKey(nextCaseKey);
            setSearchParams(buildQueryParams(filters, offset, nextCaseKey));
          } else {
            setSelectedCaseKey("");
            setDetail(null);
          }
        }
      })
      .catch((error) => {
        if (!alive) {
          return;
        }
        setListError(error instanceof ApiError ? error.message : "Failed to load reconciliation cases");
      })
      .finally(() => {
        if (alive) {
          setLoadingCases(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [filters, offset, requestQuery, selectedCaseKey, setSearchParams]);

  useEffect(() => {
    let alive = true;
    if (!selectedCaseKey) {
      setDetail(null);
      return undefined;
    }

    setLoadingDetail(true);
    setDetailError("");
    api.getReconciliationCase(selectedCaseKey)
      .then((data) => {
        if (!alive) {
          return;
        }
        setDetail(data);
        const nextInputs = {};
        (data.sourceLines || []).forEach((line) => {
          const matchingAppLine = (data.reconciliationLines || []).find(
            (appLine) => buildAppLineKey(appLine) === buildLineKey(line),
          );
          nextInputs[buildLineKey(line)] = {
            actualReceivedQtyBase:
              matchingAppLine?.actualReceivedQtyBase ?? line.inboundQtyBase ?? line.outboundQtyBase ?? 0,
            note: matchingAppLine?.note || "",
          };
        });
        setLineInputs(nextInputs);
        setDiscrepancyForm({
          reason: "",
          note: data.case?.note || "",
        });
      })
      .catch((error) => {
        if (!alive) {
          return;
        }
        setDetailError(error instanceof ApiError ? error.message : "Failed to load case detail");
      })
      .finally(() => {
        if (alive) {
          setLoadingDetail(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [selectedCaseKey]);

  function applyFilters(event) {
    event.preventDefault();
    setOffset(0);
    setSearchParams(buildQueryParams(filters, 0, selectedCaseKey));
  }

  function resetFilters() {
    const blank = {
      branch: "",
      dateFrom: "",
      dateTo: "",
      status: "",
    };
    setFilters(blank);
    setOffset(0);
    setSearchParams(buildQueryParams(blank, 0, selectedCaseKey));
  }

  function changePage(nextOffset) {
    if (nextOffset < 0 || nextOffset >= total) {
      return;
    }
    setOffset(nextOffset);
    setSearchParams(buildQueryParams(filters, nextOffset, selectedCaseKey));
  }

  function selectCase(caseKey) {
    setSelectedCaseKey(caseKey);
    setSearchParams(buildQueryParams(filters, offset, caseKey));
  }

  async function refreshDetailAndList(message) {
    setLoadingDetail(true);
    try {
      const [summaryData, caseData, detailData] = await Promise.all([
        api.getReconciliationSummary(filters),
        api.listReconciliationCases(requestQuery),
        api.getReconciliationCase(selectedCaseKey),
      ]);
      setSummary(summaryData);
      setCases(caseData.rows || []);
      setTotal(caseData.total || 0);
      setDetail(detailData);
      showToast(message, "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Refresh failed", "error");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function saveLine(line) {
    const key = buildLineKey(line);
    const current = lineInputs[key];
    await withLoading(async () => {
      await api.confirmReconciliationReceipt(
        selectedCaseKey,
        {
          productCode: line.productCode,
          sourceBarcode: line.barcode || "",
          sourceUnitCode: line.unitCode || "",
          lotNo: line.lotNo || "",
          expiryDate: line.expiryDate || "",
          expectedQtyBase: line.outboundQtyBase,
          actualReceivedQtyBase: Number(current.actualReceivedQtyBase || 0),
          note: current.note || "",
        },
        csrfToken,
      );
      await refreshDetailAndList("Actual received quantity saved");
    });
  }

  async function saveDiscrepancy() {
    await withLoading(async () => {
      await api.recordReconciliationDiscrepancy(
        selectedCaseKey,
        {
          reason: discrepancyForm.reason,
          note: discrepancyForm.note,
        },
        csrfToken,
      );
      await refreshDetailAndList("Discrepancy recorded");
    });
  }

  async function approveCase() {
    await withLoading(async () => {
      await api.approveReconciliationCase(
        selectedCaseKey,
        {
          note: "Approved from reconciliation screen",
        },
        csrfToken,
      );
      await refreshDetailAndList("Reconciliation case approved");
    });
  }

  async function updateCaseStatus(action) {
    await withLoading(async () => {
      await api.updateReconciliationCaseStatus(
        selectedCaseKey,
        {
          action,
          note: action === "cancel" ? "Cancelled from reconciliation screen" : "Reopened from reconciliation screen",
        },
        csrfToken,
      );
      await refreshDetailAndList(action === "cancel" ? "Case cancelled" : "Case reopened");
    });
  }

  async function appendEvent() {
    await withLoading(async () => {
      await api.appendReconciliationEvent(
        selectedCaseKey,
        {
          eventType: eventForm.eventType,
          note: eventForm.note,
        },
        csrfToken,
      );
      setEventForm((prev) => ({ ...prev, note: "" }));
      await refreshDetailAndList("Audit event added");
    });
  }

  return (
    <div className="stack">
      <div className="row-space">
        <div>
          <h1>Transfer Reconciliation</h1>
          <p className="muted">Review source-derived transfer cases and record branch-owned resolution state.</p>
        </div>
      </div>

      <form className="search-grid" onSubmit={applyFilters}>
        <label>
          Branch
          <select
            value={filters.branch}
            onChange={(event) => setFilters((prev) => ({ ...prev, branch: event.target.value }))}
          >
            <option value="">all branches</option>
            {branches.map((branch) => (
              <option key={branch.branchCode} value={branch.branchCode}>
                {branch.branchCode} - {branch.branchName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status || "all"} value={status}>
                {status ? titleize(status) : "all statuses"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date From
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
          />
        </label>
        <label>
          Date To
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
          />
        </label>
        <div className="actions-inline">
          <button type="submit" className="btn btn-primary">
            Apply Filters
          </button>
          <button type="button" className="btn btn-secondary" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </form>

      <div className="reconciliation-summary-grid">
        <div className="summary-card">
          <div className="summary-label">Cases in filter</div>
          <div className="summary-value">{summary ? formatNumber(summary.totalCases) : "-"}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Unprocessed inbound</div>
          <div className="summary-value">{summary ? formatNumber(summary.bySourceMatchStatus?.inbound_present_unprocessed) : "-"}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Approved</div>
          <div className="summary-value">{summary ? formatNumber(summary.byResolutionStatus?.approved) : "-"}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Ambiguous</div>
          <div className="summary-value">{summary ? formatNumber(summary.bySourceMatchStatus?.ambiguous_match) : "-"}</div>
        </div>
      </div>

      <div className="reconciliation-layout">
        <section className="reconciliation-list-panel">
          <div className="reconciliation-panel-header">
            <div>
              <h3>Case List</h3>
              <p className="muted">
                Page {page} / {totalPages} ({formatNumber(total)} cases)
              </p>
            </div>
            <div className="actions-inline">
              <button type="button" className="btn btn-secondary" disabled={offset <= 0} onClick={() => changePage(offset - PAGE_SIZE)}>
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => changePage(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </div>

          {loadingCases && <div className="summary-card">Loading reconciliation cases...</div>}
          {!loadingCases && listError && <div className="progress-overlay-error">{listError}</div>}
          {!loadingCases && !listError && cases.length === 0 && (
            <div className="summary-card">No reconciliation cases found for the current filters.</div>
          )}
          {!loadingCases && !listError && cases.length > 0 && (
            <div className="reconciliation-case-list">
              {cases.map((row) => (
                <button
                  key={row.caseKey}
                  type="button"
                  className={`reconciliation-case-card${selectedCaseKey === row.caseKey ? " active" : ""}`}
                  onClick={() => selectCase(row.caseKey)}
                >
                  <div className="row-space">
                    <strong>{row.caseKey}</strong>
                    <span className="pill">{titleize(row.resolutionStatus)}</span>
                  </div>
                  <div className="reconciliation-case-meta">
                    <span>{row.caseDate || "-"}</span>
                    <span>
                      {row.dispatchBranchCode || "-"} to {row.receivingBranchCode || "-"}
                    </span>
                  </div>
                  <div className="reconciliation-case-meta">
                    <span>Source: {titleize(row.sourceMatchStatus)}</span>
                    <span>Delta: {formatNumber(row.qtyDeltaSource)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="reconciliation-detail-panel">
          {!selectedCaseKey && <div className="summary-card">Select a case to review its line details and audit history.</div>}
          {selectedCaseKey && loadingDetail && <div className="summary-card">Loading case detail...</div>}
          {selectedCaseKey && !loadingDetail && detailError && <div className="progress-overlay-error">{detailError}</div>}
          {selectedCaseKey && !loadingDetail && !detailError && detail && (
            <div className="stack">
              <div className="summary-card stack">
                <div className="row-space">
                  <div>
                    <h3>{detail.case.caseKey}</h3>
                    <p className="muted">
                      {detail.case.dispatchBranchCode || "-"} to {detail.case.receivingBranchCode || "-"} |{" "}
                      {titleize(detail.case.sourceMatchStatus)}
                    </p>
                  </div>
                  <div className="actions-inline">
                    <button type="button" className="btn btn-primary" onClick={approveCase}>
                      Approve
                    </button>
                    {detail.case.resolutionStatus === "cancelled" ? (
                      <button type="button" className="btn btn-secondary" onClick={() => updateCaseStatus("reopen")}>
                        Reopen
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary" onClick={() => updateCaseStatus("cancel")}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                <dl>
                  <dt>Outbound Doc</dt>
                  <dd>{detail.case.outboundDocNo || "-"}</dd>
                  <dt>Inbound Doc</dt>
                  <dd>{detail.case.inboundDocNo || "-"}</dd>
                  <dt>Match Method</dt>
                  <dd>{titleize(detail.case.sourceMatchMethod)}</dd>
                  <dt>Expected Qty</dt>
                  <dd>{formatNumber(detail.case.expectedTotalQtyBase)}</dd>
                  <dt>Received Qty</dt>
                  <dd>{formatNumber(detail.case.sourceReceivedTotalQtyBase)}</dd>
                  <dt>Resolution</dt>
                  <dd>{titleize(detail.case.resolutionStatus)}</dd>
                </dl>
              </div>

              <div className="summary-card stack">
                <div className="row-space">
                  <h3>Expected vs Actual Lines</h3>
                  <span className="muted">{detail.sourceLines.length} lines</span>
                </div>
                {detail.sourceLines.length === 0 ? (
                  <div className="muted">No source lines available for this case.</div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Expected</th>
                          <th>Source Received</th>
                          <th>Actual Received</th>
                          <th>Line Note</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.sourceLines.map((line) => {
                          const key = buildLineKey(line);
                          const input = lineInputs[key] || { actualReceivedQtyBase: 0, note: "" };
                          return (
                            <tr key={line.lineKey}>
                              <td>
                                <div>{line.productCode}</div>
                                <div className="muted">
                                  {line.unitCode || "-"} {line.lotNo ? `| Lot ${line.lotNo}` : ""}
                                </div>
                              </td>
                              <td>{formatNumber(line.outboundQtyBase)}</td>
                              <td>{formatNumber(line.inboundQtyBase)}</td>
                              <td>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={input.actualReceivedQtyBase}
                                  onChange={(event) =>
                                    setLineInputs((prev) => ({
                                      ...prev,
                                      [key]: {
                                        ...prev[key],
                                        actualReceivedQtyBase: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  value={input.note}
                                  onChange={(event) =>
                                    setLineInputs((prev) => ({
                                      ...prev,
                                      [key]: {
                                        ...prev[key],
                                        note: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="optional note"
                                />
                              </td>
                              <td>
                                <button type="button" className="btn btn-secondary" onClick={() => saveLine(line)}>
                                  Save
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="reconciliation-detail-grid">
                <div className="summary-card stack">
                  <h3>Discrepancy Note</h3>
                  <label>
                    Reason
                    <input
                      type="text"
                      value={discrepancyForm.reason}
                      onChange={(event) => setDiscrepancyForm((prev) => ({ ...prev, reason: event.target.value }))}
                      placeholder="damaged_in_transit, short_shipment..."
                    />
                  </label>
                  <label>
                    Note
                    <textarea
                      rows={5}
                      value={discrepancyForm.note}
                      onChange={(event) => setDiscrepancyForm((prev) => ({ ...prev, note: event.target.value }))}
                      placeholder="Describe what the branch actually received."
                    />
                  </label>
                  <div className="actions-inline">
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={saveDiscrepancy}
                      disabled={!discrepancyForm.note.trim()}
                    >
                      Record Discrepancy
                    </button>
                  </div>
                </div>

                <div className="summary-card stack">
                  <h3>Audit Timeline</h3>
                  <label>
                    Append Note
                    <input
                      type="text"
                      value={eventForm.note}
                      onChange={(event) => setEventForm((prev) => ({ ...prev, note: event.target.value }))}
                      placeholder="Add an operational note to the timeline"
                    />
                  </label>
                  <div className="actions-inline">
                    <button type="button" className="btn btn-secondary" onClick={appendEvent} disabled={!eventForm.note.trim()}>
                      Add Timeline Note
                    </button>
                  </div>
                  <div className="timeline-list">
                    {detail.events.length === 0 && <div className="muted">No audit events yet for this case.</div>}
                    {detail.events.map((event) => (
                      <div key={event.reconciliationEventId} className="timeline-item">
                        <div className="row-space">
                          <strong>{titleize(event.eventType)}</strong>
                          <span className="muted">{formatDateTime(event.createdAt)}</span>
                        </div>
                        <div className="muted">
                          {event.actorUserId || "-"} ({event.actorRole || "-"})
                        </div>
                        <div>{event.note || "-"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
