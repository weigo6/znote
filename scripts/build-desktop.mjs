import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// Keep the bundled Python renderer and its capability manifest in step with
// the frontend. A stale sidecar silently drops new settings at render time.
run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-renderer.ps1"]);
run(".venv/Scripts/python.exe", ["tests/test-bundled-renderer.py"]);
run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
run(process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
run(process.execPath, ["tests/check-package-assets.mjs"]);
