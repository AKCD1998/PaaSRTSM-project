import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function DashboardPage() {
  const { isAdmin } = useAuth();

  return (
    <div className="stack">
      <h1>Dashboard</h1>
      <p className="muted">Quick access to imports, enrichment, and product master search.</p>
      <div className="card-grid">
        <Link to="/products" className="card-link">
          <h3>Product Search</h3>
          <p>Search SKU, name, category, supplier, and enrichment status.</p>
        </Link>
        {isAdmin && (
          <Link to="/imports/products" className="card-link">
            <h3>Import Products</h3>
            <p>Upload AdaPos CSV for dry-run or commit.</p>
          </Link>
        )}
        {isAdmin && (
          <Link to="/imports/prices" className="card-link">
            <h3>Monthly Price Update</h3>
            <p>Price-only import with optional history mode.</p>
          </Link>
        )}
        <Link to="/enrichment/top-sellers" className="card-link">
          <h3>Top Sellers</h3>
          <p>See high-volume SKUs still missing verified enrichment.</p>
        </Link>
        {isAdmin && (
          <Link to="/enrichment/apply-rules" className="card-link">
            <h3>Apply Rules</h3>
            <p>Dry-run and apply enrichment rules in bulk.</p>
          </Link>
        )}
      </div>
    </div>
  );
}
