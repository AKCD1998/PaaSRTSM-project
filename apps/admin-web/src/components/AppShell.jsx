import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";

function navClass({ isActive }) {
  return `nav-link${isActive ? " active" : ""}`;
}

export function AppShell({ children }) {
  const { user, isAdmin, logout } = useAuth();
  const { withLoading, showToast } = useUi();

  async function handleLogout() {
    await withLoading(async () => {
      await logout();
      showToast("Logged out", "info");
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-title">Inventory Admin</div>
          <div className="brand-subtitle">ทะเบียนยา / ทะเบียนสินค้า</div>
        </div>
        <nav className="side-nav">
          <NavLink to="/" end className={navClass}>
            Dashboard
          </NavLink>
          <NavLink to="/products" className={navClass}>
            Product Search
          </NavLink>
          {isAdmin && (
            <>
              <NavLink to="/imports/products" className={navClass}>
                Import Products
              </NavLink>
              <NavLink to="/imports/prices" className={navClass}>
                Monthly Price Update
              </NavLink>
            </>
          )}
          <NavLink to="/enrichment/top-sellers" className={navClass}>
            Top Sellers
          </NavLink>
          {isAdmin && (
            <NavLink to="/enrichment/apply-rules" className={navClass}>
              Apply Rules
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/embeddings/sync" className={navClass}>
              Embedding Jobs
            </NavLink>
          )}
        </nav>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div>
            <div className="topbar-title">Admin Web v1</div>
            <div className="topbar-subtitle">{user?.id}</div>
          </div>
          <div className="topbar-actions">
            <span className={`pill role-${user?.role || "none"}`}>{user?.role || "guest"}</span>
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>
        <section className="content-panel">{children}</section>
      </main>
    </div>
  );
}
