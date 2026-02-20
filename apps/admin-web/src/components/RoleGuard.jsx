import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RoleGuard({ roles, children }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!roles.includes(user.role)) {
    return <div className="empty-state">You do not have access to this page.</div>;
  }
  return children;
}
