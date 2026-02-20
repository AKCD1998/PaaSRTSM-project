import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const distDir = path.resolve(thisDir, "..", "dist");
const indexPath = path.join(distDir, "index.html");
const fallbackPath = path.join(distDir, "404.html");

if (!fs.existsSync(indexPath)) {
  console.error(`Cannot create 404 fallback; missing file: ${indexPath}`);
  process.exitCode = 1;
} else {
  fs.copyFileSync(indexPath, fallbackPath);
  console.log(`Created ${path.relative(process.cwd(), fallbackPath)} from index.html`);
}
