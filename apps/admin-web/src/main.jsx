import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { UiProvider } from "./context/UiContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <UiProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </UiProvider>
    </HashRouter>
  </React.StrictMode>,
);
