import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { RoleGuard } from "./components/RoleGuard";
import { ToastViewport } from "./components/ToastViewport";
import { useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ImportProductsPage } from "./pages/ImportProductsPage";
import { ImportPricesPage } from "./pages/ImportPricesPage";
import { TopSellersPage } from "./pages/TopSellersPage";
import { ApplyRulesPage } from "./pages/ApplyRulesPage";

function PrivateRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/:sku_id" element={<ProductDetailPage />} />
        <Route
          path="/imports/products"
          element={
            <RoleGuard roles={["admin"]}>
              <ImportProductsPage />
            </RoleGuard>
          }
        />
        <Route
          path="/imports/prices"
          element={
            <RoleGuard roles={["admin"]}>
              <ImportPricesPage />
            </RoleGuard>
          }
        />
        <Route path="/enrichment/top-sellers" element={<TopSellersPage />} />
        <Route
          path="/enrichment/apply-rules"
          element={
            <RoleGuard roles={["admin"]}>
              <ApplyRulesPage />
            </RoleGuard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  const { initialized, user } = useAuth();

  if (!initialized) {
    return (
      <div className="login-wrap">
        <div className="login-card">Checking session...</div>
      </div>
    );
  }

  return (
    <>
      {!user ? (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      ) : (
        <PrivateRoutes />
      )}
      <LoadingOverlay />
      <ToastViewport />
    </>
  );
}
