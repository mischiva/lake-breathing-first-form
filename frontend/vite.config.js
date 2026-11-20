import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The site reads the generated JSON files from public/data. Copy them from the backend folders
// each time Vite starts or builds, so there is only one copy to keep up to date.
const root = path.dirname(fileURLToPath(import.meta.url));
const dest = path.join(root, "public", "data");
fs.mkdirSync(dest, { recursive: true });
const sources = [
  ...fs.readdirSync(path.join(root, "..", "backend", "output"))
    .filter((f) => f.endsWith(".json")).map((f) => path.join(root, "..", "backend", "output", f)),
  path.join(root, "..", "backend", "data", "response_cards.json"),
];
for (const src of sources) fs.copyFileSync(src, path.join(dest, path.basename(src)));

// base "./" lets the built site run from any folder, like github.io/<repo>/.
// In dev, /api calls go to the FastAPI server only if VITE_API_URL is set.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
});
