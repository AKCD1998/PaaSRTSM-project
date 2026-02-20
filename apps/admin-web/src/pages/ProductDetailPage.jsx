import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { formatDateTime, formatNumber, titleize } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";

const EDITABLE_FIELDS = [
  "display_name",
  "category_name",
  "supplier_code",
  "product_kind",
  "enrichment_status",
  "enrichment_notes",
  "generic_name",
  "strength_text",
  "form",
  "route",
];

function normalizeNullable(value) {
  const text = String(value == null ? "" : value).trim();
  return text === "" ? null : text;
}

export function ProductDetailPage() {
  const { sku_id: skuIdParam } = useParams();
  const navigate = useNavigate();
  const { csrfToken, isAdmin } = useAuth();
  const { withLoading, showToast } = useUi();

  const skuId = Number(skuIdParam);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [product, setProduct] = useState(null);
  const [form, setForm] = useState(null);
  const [baseSnapshot, setBaseSnapshot] = useState(null);

  useEffect(() => {
    if (!Number.isInteger(skuId) || skuId <= 0) {
      showToast("Invalid SKU ID", "error");
      navigate("/products");
      return;
    }

    withLoading(async () => {
      try {
        const data = await api.getProduct(skuId, includeHistory);
        const loaded = data.product;
        setProduct(loaded);
        const initial = Object.fromEntries(
          EDITABLE_FIELDS.map((field) => [field, loaded[field] == null ? "" : String(loaded[field])]),
        );
        setForm(initial);
        setBaseSnapshot(initial);
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Failed to load product", "error");
        }
      }
    });
  }, [includeHistory, navigate, showToast, skuId, withLoading]);

  const hasChanges = useMemo(() => {
    if (!form || !baseSnapshot) {
      return false;
    }
    return EDITABLE_FIELDS.some((field) => (form[field] || "") !== (baseSnapshot[field] || ""));
  }, [baseSnapshot, form]);

  async function handleSave(event) {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }
    if (!form || !baseSnapshot) {
      return;
    }

    const payload = {};
    EDITABLE_FIELDS.forEach((field) => {
      const nextValue = form[field] || "";
      const prevValue = baseSnapshot[field] || "";
      if (nextValue !== prevValue) {
        payload[field] = normalizeNullable(nextValue);
      }
    });

    if (Object.keys(payload).length === 0) {
      showToast("No changes to save", "info");
      return;
    }

    await withLoading(async () => {
      try {
        const data = await api.updateProduct(skuId, payload, csrfToken);
        showToast(`Saved (${data.changed_fields.length} fields)`, "success");
        const merged = {
          ...product,
          ...payload,
        };
        setProduct(merged);
        const refreshed = Object.fromEntries(
          EDITABLE_FIELDS.map((field) => [field, merged[field] == null ? "" : String(merged[field])]),
        );
        setForm(refreshed);
        setBaseSnapshot(refreshed);
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Failed to save product", "error");
        }
      }
    });
  }

  if (!product || !form) {
    return <div className="empty-state">Loading product...</div>;
  }

  return (
    <div className="stack">
      <div className="row-space">
        <h1>Product Detail</h1>
        <button type="button" className="btn btn-secondary" onClick={() => navigate("/products")}>
          Back to Search
        </button>
      </div>

      <div className="info-grid">
        <div className="info-card">
          <h3>Identity</h3>
          <dl>
            <dt>SKU ID</dt>
            <dd>{product.sku_id}</dd>
            <dt>Company Code</dt>
            <dd>{product.company_code || "-"}</dd>
            <dt>Item ID</dt>
            <dd>{product.item_id}</dd>
            <dt>Updated</dt>
            <dd>{formatDateTime(product.updated_at)}</dd>
          </dl>
        </div>
        <div className="info-card">
          <h3>Pricing</h3>
          <dl>
            <dt>Retail (Current)</dt>
            <dd>
              {product.retail_price ? `${formatNumber(product.retail_price.price)} ${product.retail_price.currency}` : "-"}
            </dd>
            <dt>Average Cost</dt>
            <dd>{formatNumber(product.avg_cost)}</dd>
            <dt>Barcodes</dt>
            <dd>{product.barcodes?.map((row) => row.barcode).join(", ") || "-"}</dd>
          </dl>
        </div>
      </div>

      <div className="info-card">
        <h3>Wholesale Tiers</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Price</th>
                <th>Currency</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {(product.wholesale_tiers || []).length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    No wholesale tiers
                  </td>
                </tr>
              )}
              {(product.wholesale_tiers || []).map((tier) => (
                <tr key={tier.tier}>
                  <td>{tier.tier}</td>
                  <td>{formatNumber(tier.price)}</td>
                  <td>{tier.currency}</td>
                  <td>{tier.is_active ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="info-card">
        <div className="row-space">
          <h3>Edit Fields</h3>
          {!isAdmin && <span className="pill role-staff">staff read-only</span>}
        </div>
        <form className="form-grid" onSubmit={handleSave}>
          <label>
            Display Name
            <input
              type="text"
              value={form.display_name}
              onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <label>
            Category Name
            <input
              type="text"
              value={form.category_name}
              onChange={(event) => setForm((prev) => ({ ...prev, category_name: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <label>
            Supplier Code
            <input
              type="text"
              value={form.supplier_code}
              onChange={(event) => setForm((prev) => ({ ...prev, supplier_code: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <label>
            Product Kind
            <input
              type="text"
              value={form.product_kind}
              onChange={(event) => setForm((prev) => ({ ...prev, product_kind: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <label>
            Enrichment Status
            <select
              value={form.enrichment_status}
              onChange={(event) => setForm((prev) => ({ ...prev, enrichment_status: event.target.value }))}
              disabled={!isAdmin}
            >
              <option value="missing">missing</option>
              <option value="partial">partial</option>
              <option value="verified">verified</option>
            </select>
          </label>
          <label>
            Generic Name
            <input
              type="text"
              value={form.generic_name}
              onChange={(event) => setForm((prev) => ({ ...prev, generic_name: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <label>
            Strength Text
            <input
              type="text"
              value={form.strength_text}
              onChange={(event) => setForm((prev) => ({ ...prev, strength_text: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <label>
            Form
            <input
              type="text"
              value={form.form}
              onChange={(event) => setForm((prev) => ({ ...prev, form: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <label>
            Route
            <input
              type="text"
              value={form.route}
              onChange={(event) => setForm((prev) => ({ ...prev, route: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <label className="label-span-2">
            Enrichment Notes
            <textarea
              value={form.enrichment_notes}
              onChange={(event) => setForm((prev) => ({ ...prev, enrichment_notes: event.target.value }))}
              disabled={!isAdmin}
              rows={3}
            />
          </label>
          <div className="actions-inline label-span-2">
            {isAdmin ? (
              <button type="submit" className="btn btn-primary" disabled={!hasChanges}>
                Save Changes
              </button>
            ) : (
              <span className="muted">You can view fields but cannot edit as staff.</span>
            )}
          </div>
        </form>
      </div>

      <div className="info-card">
        <div className="row-space">
          <h3>Price History</h3>
          <label className="toggle-inline">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(event) => setIncludeHistory(event.target.checked)}
            />
            Include history rows
          </label>
        </div>
        {!includeHistory && <p className="muted">Enable the checkbox to load price history.</p>}
        {includeHistory && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Price ID</th>
                  <th>Price</th>
                  <th>Currency</th>
                  <th>Effective Start</th>
                  <th>Effective End</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {(product.price_history || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No history rows.
                    </td>
                  </tr>
                )}
                {(product.price_history || []).map((row) => (
                  <tr key={row.price_id}>
                    <td>{row.price_id}</td>
                    <td>{formatNumber(row.price)}</td>
                    <td>{row.currency}</td>
                    <td>{formatDateTime(row.effective_start)}</td>
                    <td>{formatDateTime(row.effective_end)}</td>
                    <td>{formatDateTime(row.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="info-card">
        <h3>Metadata Snapshot</h3>
        <p className="muted">
          Enriched by: {product.enriched_by || "-"} at {formatDateTime(product.enriched_at)} | Product kind:{" "}
          {titleize(product.product_kind)}
        </p>
      </div>
    </div>
  );
}
