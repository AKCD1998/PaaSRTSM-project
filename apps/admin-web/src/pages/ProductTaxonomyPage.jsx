import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";
import { ConfirmModal } from "../components/ConfirmModal";

const PAGE_SIZE = 50;
const UNCLASSIFIED_FILTER = "unclassified";
const PRODUCT_TYPE_OPTIONS = [
  { value: "", label: "ทั้งหมด" },
  { value: UNCLASSIFIED_FILTER, label: "ยังไม่ระบุ" },
  { value: "drug", label: "ยา" },
  { value: "supplement", label: "อาหารเสริม" },
  { value: "herb", label: "สมุนไพร" },
  { value: "antiseptic", label: "น้ำยาฆ่าเชื้อ" },
  { value: "cosmeceutical", label: "เวชสำอาง" },
  { value: "cosmetic", label: "เครื่องสำอาง" },
  { value: "device", label: "อุปกรณ์" },
  { value: "service", label: "บริการ" },
  { value: "other", label: "อื่นๆ" },
];
const EDIT_PRODUCT_TYPE_OPTIONS = PRODUCT_TYPE_OPTIONS.slice(1);
const ENRICHMENT_STATUS_OPTIONS = [
  { value: "", label: "ทั้งหมด" },
  { value: "missing", label: "missing" },
  { value: "partial", label: "partial" },
  { value: "verified", label: "verified" },
  { value: "not_applicable", label: "not_applicable" },
];
const PRODUCT_TYPE_LABELS = {
  drug: "ยา",
  supplement: "อาหารเสริม",
  herb: "สมุนไพร",
  antiseptic: "น้ำยาฆ่าเชื้อ",
  cosmeceutical: "เวชสำอาง",
  cosmetic: "เครื่องสำอาง",
  device: "อุปกรณ์",
  service: "บริการ",
  other: "อื่นๆ",
};

function summarizePreview(summary) {
  const parts = [];
  for (const line of summary?.lines || []) {
    if (line.startsWith("[") || line.startsWith("Run with")) {
      continue;
    }
    parts.push(line.replace(/\s+/g, " ").trim());
  }
  return parts.join(" | ");
}

function formatProductType(value) {
  if (!value) {
    return "ยังไม่ระบุ";
  }
  return PRODUCT_TYPE_LABELS[value] || value;
}

export function ProductTaxonomyPage() {
  const { csrfToken, isAdmin } = useAuth();
  const { withLoading, showToast } = useUi();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    product_type: "",
    enrichment_status: "",
    q: "",
  });
  const [appliedFilters, setAppliedFilters] = useState({
    product_type: "",
    enrichment_status: "",
    q: "",
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewSummary, setPreviewSummary] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const statsChips = useMemo(() => {
    if (!stats) {
      return [];
    }
    return [
      { key: "drug", label: "ยา", count: stats.by_product_type.drug, tone: "drug" },
      { key: "herb", label: "สมุนไพร", count: stats.by_product_type.herb, tone: "herb" },
      { key: "supplement", label: "อาหารเสริม", count: stats.by_product_type.supplement, tone: "supplement" },
      { key: "antiseptic", label: "ฆ่าเชื้อ", count: stats.by_product_type.antiseptic, tone: "antiseptic" },
      { key: "cosmeceutical", label: "เวชสำอาง", count: stats.by_product_type.cosmeceutical, tone: "cosmeceutical" },
      { key: "cosmetic", label: "เครื่องสำอาง", count: stats.by_product_type.cosmetic, tone: "cosmetic" },
      { key: "device", label: "อุปกรณ์", count: stats.by_product_type.device, tone: "device" },
      { key: "service", label: "บริการ", count: stats.by_product_type.service, tone: "service" },
      { key: "other", label: "อื่นๆ", count: stats.by_product_type.other, tone: "other" },
      { key: "unclassified", label: "ยังไม่ระบุ", count: stats.unclassified, tone: "unclassified" },
    ];
  }, [stats]);

  useEffect(() => {
    withLoading(async () => {
      try {
        const [statsData, taxonomyData] = await Promise.all([
          api.getTaxonomyStats(),
          api.listProductTaxonomy({
            ...appliedFilters,
            limit: PAGE_SIZE,
            offset,
          }),
        ]);
        setStats(statsData);
        setRows(taxonomyData.rows || []);
        setTotal(taxonomyData.total || 0);
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Failed to load taxonomy", "error");
        }
      }
    });
  }, [appliedFilters, offset, refreshKey, showToast, withLoading]);

  function reload() {
    setRefreshKey((prev) => prev + 1);
  }

  function handleFilterSubmit(event) {
    event.preventDefault();
    setOffset(0);
    setAppliedFilters({ ...filters });
  }

  async function handleInlineUpdate(skuCode, nextValue) {
    if (!isAdmin) {
      return;
    }

    try {
      const payload = { product_type: nextValue || null };
      await api.updateProductTaxonomy(skuCode, payload, csrfToken);
      setRows((prev) =>
        prev.map((row) =>
          row.sku_code === skuCode
            ? {
                ...row,
                product_type: nextValue || null,
                enrichment_status:
                  nextValue === "device" || nextValue === "service"
                    ? "not_applicable"
                    : row.enrichment_status,
              }
            : row,
        ),
      );
      showToast("Updated product type", "success");
      reload();
    } catch (error) {
      if (error instanceof ApiError) {
        showToast(error.message, "error");
      } else {
        showToast("Failed to update product type", "error");
      }
    }
  }

  async function handleAutoClassifyPreview() {
    if (!isAdmin) {
      return;
    }

    await withLoading(async () => {
      try {
        const data = await api.bulkClassifyTaxonomy({ commit: false }, csrfToken);
        setPreviewSummary(data.summary);
        setConfirmOpen(true);
      } catch (error) {
        if (error instanceof ApiError) {
          showToast(error.message, "error");
        } else {
          showToast("Failed to preview auto-classify", "error");
        }
      }
    });
  }

  async function handleConfirmCommit() {
    setConfirmBusy(true);
    try {
      const data = await api.bulkClassifyTaxonomy({ commit: true }, csrfToken);
      setConfirmOpen(false);
      setPreviewSummary(null);
      showToast(`Applied ${data.summary.updated || 0} taxonomy updates`, "success");
      reload();
    } catch (error) {
      if (error instanceof ApiError) {
        showToast(error.message, "error");
      } else {
        showToast("Failed to apply auto-classify", "error");
      }
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row-space">
        <div>
          <h1>ประเภทสินค้า</h1>
          <p className="muted">จัดการ Product Type taxonomy และ enrichment applicability ของสินค้า</p>
        </div>
        {isAdmin ? (
          <button type="button" className="btn btn-primary" onClick={handleAutoClassifyPreview}>
            Auto-classify
          </button>
        ) : (
          <span className="pill role-staff">staff read-only</span>
        )}
      </div>

      <div className="info-card">
        <div className="taxonomy-chip-grid">
          {statsChips.map((chip) => (
            <div key={chip.key} className={`taxonomy-chip tone-${chip.tone}`}>
              <span>{chip.label}</span>
              <strong>{chip.count}</strong>
            </div>
          ))}
        </div>
      </div>

      <form className="search-grid" onSubmit={handleFilterSubmit}>
        <label>
          ประเภทสินค้า
          <select
            value={filters.product_type}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, product_type: event.target.value }))
            }
          >
            {PRODUCT_TYPE_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          enrichment_status
          <select
            value={filters.enrichment_status}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, enrichment_status: event.target.value }))
            }
          >
            {ENRICHMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="label-span-2">
          ค้นหาชื่อสินค้า
          <input
            type="text"
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            placeholder="ค้นหาจากชื่อหรือรหัสสินค้า"
          />
        </label>
        <div className="actions-inline">
          <button type="submit" className="btn btn-primary">
            Filter
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFilters({
                product_type: "",
                enrichment_status: "",
                q: "",
              });
              setAppliedFilters({
                product_type: "",
                enrichment_status: "",
                q: "",
              });
              setOffset(0);
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
              <th>รหัส</th>
              <th>ชื่อสินค้า</th>
              <th>หมวด AdaPos</th>
              <th>product_kind</th>
              <th>ประเภท</th>
              <th>enrichment_status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  No products found.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.sku_code}>
                <td>{row.sku_code}</td>
                <td>{row.name || "-"}</td>
                <td>{row.category_name || "-"}</td>
                <td>{row.product_kind || "-"}</td>
                <td>
                  <select
                    value={row.product_type || ""}
                    onChange={(event) => handleInlineUpdate(row.sku_code, event.target.value)}
                    disabled={!isAdmin}
                  >
                    <option value="">ยังไม่ระบุ</option>
                    {EDIT_PRODUCT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{row.enrichment_status || "-"}</td>
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
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            disabled={offset <= 0}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
          >
            Next
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="ยืนยัน Auto-classify"
        message={previewSummary ? summarizePreview(previewSummary) : ""}
        confirmLabel="Apply"
        cancelLabel="Cancel"
        tone="primary"
        busy={confirmBusy}
        onConfirm={handleConfirmCommit}
        onCancel={() => {
          if (!confirmBusy) {
            setConfirmOpen(false);
          }
        }}
      />
    </div>
  );
}
