import { useState } from "react";
import { ApiError, api } from "../lib/api";
import { formatNumber } from "../lib/format";
import { useUi } from "../context/UiContext";

export function TopSellersPage() {
  const { withLoading, showToast } = useUi();
  const [form, setForm] = useState({
    top: "200",
    since: "",
  });
  const [rows, setRows] = useState([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  async function loadReport(event) {
    event?.preventDefault();
    await withLoading(async () => {
      try {
        const data = await api.getTopSellers({
          top: form.top || 200,
          since: form.since || undefined,
        });
        setRows(data.rows || []);
        setHasLoaded(true);
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Failed to load top sellers report", "error");
        }
      }
    });
  }

  return (
    <div className="stack">
      <h1>Top Sellers To Enrich</h1>
      <div className="info-card">
        <form className="search-grid" onSubmit={loadReport}>
          <label>
            Top N
            <input
              type="number"
              min="1"
              max="1000"
              value={form.top}
              onChange={(event) => setForm((prev) => ({ ...prev, top: event.target.value }))}
            />
          </label>
          <label>
            Since (YYYY-MM-DD)
            <input
              type="date"
              value={form.since}
              onChange={(event) => setForm((prev) => ({ ...prev, since: event.target.value }))}
            />
          </label>
          <div className="actions-inline">
            <button type="submit" className="btn btn-primary">
              Load Report
            </button>
          </div>
        </form>
      </div>

      {hasLoaded && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU ID</th>
                <th>Company Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Status</th>
                <th>Qty</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No rows found.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.sku_id}>
                  <td>{row.sku_id}</td>
                  <td>{row.company_code}</td>
                  <td>{row.display_name || "-"}</td>
                  <td>{row.category_name || "-"}</td>
                  <td>{row.enrichment_status || "-"}</td>
                  <td>{formatNumber(row.total_qty)}</td>
                  <td>{formatNumber(row.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
