import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

// Keep the development WebView2 profile independent of installed ZNote builds.
// WebView2 can fail to create a window when another process holds its profile.
if (
  process.platform === "win32" &&
  args[0] === "dev" &&
  !process.env.WEBVIEW2_USER_DATA_FOLDER
) {
  const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  process.env.WEBVIEW2_USER_DATA_FOLDER = path.join(
    projectRoot,
    ".znote",
    "webview-dev",
  );
}

const require = createRequire(import.meta.url);
const cli = require("@tauri-apps/cli");

try {
  await cli.run(args, "npm run tauri");
} catch (error) {
  cli.logError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
