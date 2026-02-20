import { useState } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useUi } from "../context/UiContext";

export function LoginPage() {
  const { login } = useAuth();
  const { withLoading, showToast } = useUi();
  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      await withLoading(async () => {
        await login(form.username, form.password);
      });
      showToast("Login successful", "success");
    } catch (error) {
      if (error instanceof ApiError) {
        showToast(error.message, "error");
      } else {
        showToast("Login failed", "error");
      }
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-title">Inventory Admin</div>
        <p className="muted">
          Sign in with your assigned admin/staff credentials.
        </p>
        <form className="form-grid login-form-grid" onSubmit={handleSubmit}>
          <label>
            Username / Email
            <input
              type="text"
              value={form.username}
              onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              required
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
