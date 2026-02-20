import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const githubPagesBase = process.env.GITHUB_PAGES_BASE || "/PaaSRTSM-project/";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : githubPagesBase,
  plugins: [react()],
  server: {
    port: 5173,
  },
}));
