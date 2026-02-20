import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { formatDateTime, formatNumber } from "../lib/format";
import { useUi } from "../context/UiContext";

const PAGE_SIZE = 25;

function toInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function ProductsPage() {
  const { withLoading, showToast } = useUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    keyword: searchParams.get("keyword") || "",
    category_name: searchParams.get("category_name") || "",
    supplier_code: searchParams.get("supplier_code") || "",
    product_kind: searchParams.get("product_kind") || "",
    enrichment_status: searchParams.get("enrichment_status") || "",
  });

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const requestQuery = useMemo(
    () => ({
      ...filters,
      limit,
      offset,
    }),
    [filters, limit, offset],
  );

  useEffect(() => {
    withLoading(async () => {
      try {
        const data = await api.getProducts(requestQuery);
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setLimit(data.limit || PAGE_SIZE);
        setOffset(data.offset || 0);
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Failed to load products", "error");
        }
      }
    });
  }, [requestQuery, showToast, withLoading]);

  function updateParamState(nextFilters, nextOffset) {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
    if (nextOffset > 0) {
      params.set("offset", String(nextOffset));
    }
    setSearchParams(params);
  }

  function onSearchSubmit(event) {
    event.preventDefault();
    setOffset(0);
    updateParamState(filters, 0);
  }

  function onPageChange(nextOffset) {
    if (nextOffset < 0) {
      return;
    }
    setOffset(nextOffset);
    updateParamState(filters, nextOffset);
  }

  useEffect(() => {
    const externalOffset = toInteger(searchParams.get("offset"), 0);
    if (externalOffset !== offset) {
      setOffset(externalOffset);
    }
  }, [offset, searchParams]);

  return (
    <div className="stack">
      <h1>Product Search</h1>
      <form className="search-grid" onSubmit={onSearchSubmit}>
        <label>
          Keyword
          <input
            type="text"
            value={filters.keyword}
            onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
            placeholder="sku, name, barcode, generic"
          />
        </label>
        <label>
          Category
          <input
            type="text"
            value={filters.category_name}
            onChange={(event) => setFilters((prev) => ({ ...prev, category_name: event.target.value }))}
          />
        </label>
        <label>
          Supplier
          <input
            type="text"
            value={filters.supplier_code}
            onChange={(event) => setFilters((prev) => ({ ...prev, supplier_code: event.target.value }))}
          />
        </label>
        <label>
          Product Kind
          <input
            type="text"
            value={filters.product_kind}
            onChange={(event) => setFilters((prev) => ({ ...prev, product_kind: event.target.value }))}
            placeholder="medicine, supplement..."
          />
        </label>
        <label>
          Enrichment Status
          <select
            value={filters.enrichment_status}
            onChange={(event) => setFilters((prev) => ({ ...prev, enrichment_status: event.target.value }))}
          >
            <option value="">all</option>
            <option value="missing">missing</option>
            <option value="partial">partial</option>
            <option value="verified">verified</option>
          </select>
        </label>
        <div className="actions-inline">
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const blank = {
                keyword: "",
                category_name: "",
                supplier_code: "",
                product_kind: "",
                enrichment_status: "",
              };
              setFilters(blank);
              setOffset(0);
              setSearchParams(new URLSearchParams());
            }}
          >
            Reset
          </button>
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU ID</th>
              <th>Company Code</th>
              <th>Name</th>
              <th>Category</th>
              <th>Supplier</th>
              <th>Status</th>
              <th>Retail</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-cell">
                  No products found.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.sku_id}>
                <td>{row.sku_id}</td>
                <td>{row.company_code || "-"}</td>
                <td>
                  <Link to={`/products/${row.sku_id}`}>{row.display_name || "-"}</Link>
                </td>
                <td>{row.category_name || "-"}</td>
                <td>{row.supplier_code || "-"}</td>
                <td>{row.enrichment_status || "-"}</td>
                <td>{formatNumber(row.retail_price)}</td>
                <td>{formatDateTime(row.updated_at)}</td>
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
            onClick={() => onPageChange(offset - limit)}
            disabled={offset <= 0}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onPageChange(offset + limit)}
            disabled={offset + limit >= total}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
