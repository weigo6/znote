import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

// Derive expectations from the pinned upstream manifest independently of the
// build plugin, so a mistaken exclusion rule cannot make the check pass too.
const manifest = JSON.parse(fs.readFileSync("tests/vendor/zensical/manifest.json", "utf8"));
const referenceCss = new Set(manifest.files.map(({ variant, file }) => `zensical/${variant}/${file}`));

let excluded = 0;
function verify(root, directory, prefix, reference) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) verify(root, file, prefix, reference);
    else {
      const relative = path.relative(root, file).split(path.sep).join("/");
      const destination = path.join("dist", prefix, relative);
      if (reference && referenceCss.has(relative)) {
        assert(!fs.existsSync(destination), `Reference CSS must not ship: ${relative}`);
        excluded += fs.statSync(file).size;
      } else {
        assert(fs.readFileSync(file).equals(fs.readFileSync(destination)), `Public asset missing or changed: ${relative}`);
      }
    }
  }
}
if (fs.existsSync("public")) verify("public", "public", "", false);
verify("tests/vendor", "tests/vendor", "licenses", true);
const generated = fs.readdirSync("dist/assets").filter(name => /\.(css|js)$/.test(name)).map(name => fs.readFileSync(path.join("dist/assets", name), "utf8")).join("\n");
assert(generated.includes("znote-render-scope"), "Scoped document CSS must remain in the frontend bundle");
console.log(`Package assets verified: ${excluded.toLocaleString()} bytes of reference CSS excluded; notices retained.`);
