import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// Raw CSS belongs to generation and regression tests. Only notices and the
// provenance manifest are added to the application; scoped CSS is imported by src.
function vendorNotices(): Plugin {
  return {
    name: "znote-vendor-notices",
    apply: "build",
    generateBundle() {
      const root = path.resolve("tests/vendor");
      const visit = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(file);
          else if (entry.isFile() && !entry.name.endsWith(".css")) {
            const name = path.relative(root, file).split(path.sep).join("/");
            this.emitFile({ type: "asset", fileName: `licenses/${name}`, source: fs.readFileSync(file) });
          }
        }
      };
      visit(root);
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [vendorNotices()],
  server: {
    host: "127.0.0.1", port: 1420, strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/.dev-archive/**", "**/build/**", "**/release/**", "**/.venv/**", "**/.uv-cache/**", "**/.pnpm-store/**", "**/.znote/**"] },
  },
  build: { chunkSizeWarningLimit: 1100 },
});
