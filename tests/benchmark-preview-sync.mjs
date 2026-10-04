// Requires the development test server (port 1430). Measures Edge DOM separately
// from Python/IPC; never writes to the supplied source document.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(process.argv[2], "utf8").replace(/\r\n/g, "\n");
const prefixed = "New introduction.\n\n" + source;
const renderer = spawnSync(path.join(root, ".venv/Scripts/python.exe"), ["python/znote_renderer.py"], {
  cwd: root,
  input: [source, prefixed].map(text => JSON.stringify({ action: "render", text })).join("\n") + "\n",
  encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
});
if (renderer.status !== 0) throw new Error(renderer.stderr);
const results = renderer.stdout.trim().split("\n").map(line => JSON.parse(line));
if (results.some(result => result.error)) throw new Error(JSON.stringify(results));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://127.0.0.1:1430/tests/preview.html");
  await page.waitForFunction(() => typeof window.renderResult === "function");
  const output = {};
  const samples = { mapped: [], "bounded-text": [] };
  for (let run = 0; run < 10; run++) {
    for (const mode of run % 2 ? ["mapped", "bounded-text"] : ["bounded-text", "mapped"]) {
      const rendered = mode === "mapped" ? results[0] : {
        ...results[0], sourceMap: undefined, html: results[0].html.replace(/ data-zn-node="\d+"/g, ""),
      };
      const measured = await page.evaluate(async ({ rendered, source }) => {
        const started = performance.now();
        await window.renderResult(rendered, source);
        const renderMs = performance.now() - started;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        // Separate stable geometry traversal from the preceding DOM commit.
        document.querySelector("iframe").contentDocument.querySelector("article").getBoundingClientRect();
        const measure = window.benchmarkSync(source);
        return { renderMs, ...measure, indexP50Ms: measure.build[Math.floor(measure.build.length / 2)],
          indexP95Ms: measure.build[Math.floor(measure.build.length * .95)] };
      }, { rendered, source });
      if (run >= 2) samples[mode].push(measured);
    }
  }
  for (const [mode, measures] of Object.entries(samples)) {
    output[mode] = { anchors: measures[0].anchors, runs: measures.length };
    for (const metric of ["renderMs", "geometryMs", "query10kMs", "indexP50Ms", "indexP95Ms"]) {
      const values = measures.map(measure => measure[metric]).sort((a, b) => a - b);
      output[mode][metric] = { p50: values[Math.floor(values.length / 2)], p95: values.at(-1) };
    }
  }
  await page.evaluate(async ({ rendered, source }) => {
    await window.renderResult(rendered, source);
    window.scrollPreview(source, 808);
  }, { rendered: results[0], source });
  await page.waitForFunction(() => document.querySelector("iframe").contentDocument.querySelectorAll(".katex").length > 4);
  await page.evaluate(() => {
    window.mathBefore = Array.from(document.querySelector("iframe").contentDocument.querySelectorAll(".katex"));
  });
  output.prepend = await page.evaluate(async ({ rendered, source }) => {
    const started = performance.now();
    await window.renderResult(rendered, source);
    const renderMs = performance.now() - started;
    const after = new Set(document.querySelector("iframe").contentDocument.querySelectorAll(".katex"));
    return { renderMs, previouslyMountedMath: window.mathBefore.length,
      reusedMath: window.mathBefore.filter(element => after.has(element)).length,
      section41: window.getPreviewTarget(source, 810), section78: window.getPreviewTarget(source, 1684) };
  }, { rendered: results[1], source: prefixed });
  console.log(JSON.stringify(output));
} finally {
  await browser.close();
}
