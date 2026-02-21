import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { formatDateTime } from "../lib/format";

const PAGE_SIZE = 25;

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function ProductPickerModal({ open, onClose, onSelect }) {
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const keywordSubmittedRef = useRef("");

  const [keywordInput, setKeywordInput] = useState("");
  const [keywordSubmitted, setKeywordSubmitted] = useState("");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    keywordSubmittedRef.current = keywordSubmitted;
  }, [keywordSubmitted]);

  const fetchRows = useCallback(
    async ({ nextOffset = 0, nextKeyword = keywordSubmittedRef.current } = {}) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (mountedRef.current) {
        setLoading(true);
        setErrorMessage("");
      }

      try {
        const data = await api.getProducts({
          keyword: nextKeyword || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });

        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        setRows(data?.rows || []);
        setTotal(toNonNegativeInteger(data?.total, 0));
        setLimit(toPositiveInteger(data?.limit, PAGE_SIZE));
        setOffset(toNonNegativeInteger(data?.offset, nextOffset));
        setKeywordSubmitted(nextKeyword);
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }
        setErrorMessage(error instanceof ApiError ? error.message : "Failed to load products");
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      return;
    }
    setKeywordInput("");
    setKeywordSubmitted("");
    setOffset(0);
    fetchRows({ nextOffset: 0, nextKeyword: "" });
  }, [open, fetchRows]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const effectiveLimit = toPositiveInteger(limit, PAGE_SIZE);
  const page = Math.floor(offset / effectiveLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / effectiveLimit));

  function handleSearchSubmit(event) {
    event.preventDefault();
    fetchRows({
      nextOffset: 0,
      nextKeyword: keywordInput.trim(),
    });
  }

  function handleReset() {
    setKeywordInput("");
    fetchRows({
      nextOffset: 0,
      nextKeyword: "",
    });
  }

  function handlePageChange(nextOffset) {
    if (nextOffset < 0) {
      return;
    }
    fetchRows({
      nextOffset,
      nextKeyword: keywordSubmitted,
    });
  }

  function handleSelect(row) {
    if (typeof onSelect === "function") {
      onSelect({
        sku_id: row.sku_id,
        company_code: row.company_code || "",
        display_name: row.display_name || "",
      });
    }
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Select Product to Enrich">
      <div className="modal-card product-picker-modal-card">
        <div className="product-picker-modal-header">
          <h3>Select Product to Enrich</h3>
          <button type="button" className="btn btn-secondary" onClick={onClose} aria-label="Close">
            X
          </button>
        </div>

        <form className="search-grid" onSubmit={handleSearchSubmit}>
          <label className="label-span-2">
            Keyword
            <input
              type="text"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              placeholder="sku, name, barcode, generic"
            />
          </label>
          <div className="actions-inline label-span-2">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              Search
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleReset} disabled={loading}>
              Reset
            </button>
          </div>
        </form>

        {errorMessage ? <div className="product-picker-error">{errorMessage}</div> : null}

        <div className="table-wrap product-picker-table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU ID</th>
                <th>Company Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Select</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    Loading products...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    No products found.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row) => (
                  <tr
                    key={row.sku_id}
                    className="product-picker-row"
                    onClick={() => handleSelect(row)}
                    title="Click to select this product"
                  >
                    <td>{row.sku_id}</td>
                    <td>{row.company_code || "-"}</td>
                    <td>{row.display_name || "-"}</td>
                    <td>{row.category_name || "-"}</td>
                    <td>{row.supplier_code || "-"}</td>
                    <td>{row.enrichment_status || "-"}</td>
                    <td>{formatDateTime(row.updated_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelect(row);
                        }}
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span>
            Page {page} / {totalPages} ({total} rows)
          </span>
          <div className="actions-inline">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handlePageChange(offset - effectiveLimit)}
              disabled={loading || offset <= 0}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handlePageChange(offset + effectiveLimit)}
              disabled={loading || offset + effectiveLimit >= total}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
