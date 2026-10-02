import { test, expect } from "@playwright/test";
import type { RenderResult, SourceLocation } from "../src/types";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/rendered.json", import.meta.url), "utf8"));

function result(html: string, entries: SourceLocation[] = []): RenderResult {
  return { html, toc: [], meta: {}, warnings: [], profile: "sync-test", extensions: [], highlightCss: "",
    sourceMap: { version: 1, offsetEncoding: "utf-16", entries } };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/preview.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof (window as any).renderResult === "function");
});

test("fallback headings prevent repeated phrases from crossing sections", async ({ page }) => {
  const source = "# A\n\n**Tips** more\n\n# B\n\nTips\n\n# C";
  await page.evaluate(async ({ source, rendered }) => {
    await (window as any).renderResult(rendered, source);
  }, { source, rendered: result("<h1>A</h1><p>Tips</p><h1>B</h1><p>Tips</p><h1>C</h1>") });
  expect(await page.evaluate(source => (window as any).getPreviewTarget(source, 5), source)).toMatchObject({ text: "B", line: 5 });
  expect(await page.evaluate(source => (window as any).getPreviewTarget(source, 7), source)).toMatchObject({ text: "Tips", line: 7 });
});

test("mapping refresh keeps unchanged nodes when source offsets and local IDs change", async ({ page }) => {
  const source = "# A\n\nfirst\n\nsecond";
  const initial = result('<h1 data-zn-node="0">A</h1><p data-zn-node="1">first</p><p data-zn-node="2">second</p>', [
    { id: "0", kind: "h1", precision: "exact", from: 0, to: 3 },
    { id: "1", kind: "p", precision: "exact", from: 5, to: 10 },
    { id: "2", kind: "p", precision: "exact", from: 12, to: 18 },
  ]);
  await page.evaluate(async ({ source, initial }) => {
    await (window as any).renderResult(initial, source);
    (window as any).retainedParagraph = document.querySelector("iframe")!.contentDocument!.querySelector("p");
  }, { source, initial });
  const updated = "intro\n\n" + source;
  const next = result('<p data-zn-node="0">intro</p><h1 data-zn-node="1">A</h1><p data-zn-node="2">first</p><p data-zn-node="3">second</p>', [
    { id: "0", kind: "p", precision: "exact", from: 0, to: 5 },
    ...initial.sourceMap!.entries.map(entry => ({ ...entry, id: String(Number(entry.id) + 1), from: entry.from! + 7, to: entry.to! + 7 })),
  ]);
  await page.evaluate(async ({ updated, next }) => (window as any).renderResult(next, updated), { updated, next });
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument!.querySelectorAll("p")[1] === (window as any).retainedParagraph)).toBe(true);
  expect(await page.evaluate(updated => (window as any).getPreviewTarget(updated, 5), updated)).toMatchObject({ text: "first", line: 5 });
  await expect(page.frameLocator("iframe").locator("[data-zn-node]")).toHaveCount(0);
});

test("same HTML with a different frontmatter length refreshes cached source ranges", async ({ page }) => {
  const source = "# Header";
  const initial = result('<h1 data-zn-node="0">Header</h1>', [{ id: "0", kind: "h1", precision: "exact", from: 0, to: 8 }]);
  initial.plan = (Object.values(fixtures.results)[0] as unknown as RenderResult).plan;
  await page.evaluate(async ({ source, initial }) => {
    await (window as any).renderResult(initial, source);
    (window as any).retainedHeading = document.querySelector("iframe")!.contentDocument!.querySelector("h1");
  }, { source, initial });
  const prefix = "---\ntitle: test\n---\n";
  const next = { ...initial, sourceMap: { ...initial.sourceMap!, entries: [{ ...initial.sourceMap!.entries[0], from: prefix.length, to: prefix.length + 8 }] } };
  await page.evaluate(async ({ source, next }) => (window as any).renderResult(next, source), { source: prefix + source, next });
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument!.querySelector("h1") === (window as any).retainedHeading)).toBe(true);
  expect(await page.evaluate(source => (window as any).getPreviewTarget(source, 4), prefix + source)).toMatchObject({ line: 4, text: "Header" });
});

test("long mapped blocks use an internal point and do not repeatedly jump to their top", async ({ page }) => {
  const source = Array.from({ length: 100 }, (_, i) => "line " + i).join("\n") + "\n\n# End";
  const rendered = result('<pre data-zn-node="0"><code>' + source.slice(0, source.indexOf("\n\n")) + '</code></pre><h1 data-zn-node="1">End</h1>', [
    { id: "0", kind: "pre", precision: "exact", from: 0, to: source.indexOf("\n\n") },
    { id: "1", kind: "h1", precision: "exact", from: source.indexOf("# End"), to: source.length },
  ]);
  await page.evaluate(async ({ rendered, source }) => {
    await (window as any).renderResult(rendered, source);
    (window as any).scrollPreview(source, 70);
  }, { rendered, source });
  await expect.poll(() => page.frameLocator("iframe").locator("body").evaluate(() => window.scrollY)).toBeGreaterThan(500);
  const before = await page.frameLocator("iframe").locator("body").evaluate(() => window.scrollY);
  await page.evaluate(source => (window as any).scrollPreview(source, 71), source);
  await page.waitForTimeout(80);
  const after = await page.frameLocator("iframe").locator("body").evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(1);
});

test("user reading survives a render and later height changes above the reading block", async ({ page }) => {
  const source = Array.from({ length: 100 }, (_, i) => "paragraph " + i).join("\n\n");
  const html = Array.from({ length: 100 }, (_, i) => `<p>paragraph ${i}</p>`).join("");
  await page.evaluate(async ({ source, rendered }) => {
    await (window as any).renderResult(rendered, source);
    (window as any).enableScrollSync(source);
  }, { source, rendered: result(html) });
  await page.frameLocator("iframe").locator("body").hover();
  await page.mouse.wheel(0, 1400);
  await expect.poll(() => page.evaluate(() => (window as any).scrollLines.length)).toBeGreaterThan(0);
  const tracked = await page.frameLocator("iframe").locator("p").evaluateAll(elements => {
    const y = document.documentElement.clientHeight * .28;
    let selected = 0;
    elements.forEach((element, i) => { if (element.getBoundingClientRect().top <= y) selected = i; });
    return { index: selected, top: elements[selected].getBoundingClientRect().top, scroll: window.scrollY };
  });
  await page.evaluate(async ({ source, rendered }) => {
    await (window as any).renderResult(rendered, source);
    (window as any).cursorSync(source, 1);
  }, { source, rendered: result(html.replace("paragraph 0", "changed paragraph 0")) });
  await expect.poll(() => page.frameLocator("iframe").locator("p").nth(tracked.index).evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(tracked.top, 0);
  await page.frameLocator("iframe").locator("p").first().evaluate(element => { element.style.height = "500px"; });
  await expect.poll(() => page.frameLocator("iframe").locator("p").nth(tracked.index).evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(tracked.top, 0);
});

test("hidden mapped list items are excluded from reverse lookup", async ({ page }) => {
  const source = "visible\n\nhidden\n\nlast";
  const rendered = result('<p data-zn-node="0">visible</p><ul><li hidden data-zn-node="1">hidden</li></ul><p data-zn-node="2">last</p>' + '<p>footer</p>'.repeat(80), [
    { id: "0", kind: "p", precision: "exact", from: 0, to: 7 },
    { id: "1", kind: "li", precision: "exact", from: 9, to: 15 },
    { id: "2", kind: "p", precision: "exact", from: 17, to: 21 },
  ]);
  await page.evaluate(async ({ rendered, source }) => {
    await (window as any).renderResult(rendered, source);
    (window as any).enableScrollSync(source);
  }, { rendered, source });
  await page.frameLocator("iframe").locator("body").hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => (window as any).scrollLines.at(-1))).toBe(5);
  expect(await page.evaluate(() => (window as any).scrollLines.includes(3))).toBe(false);
});

test("generated blocks preserve reading position without reporting unrelated source lines", async ({ page }) => {
  const source = "body";
  const rendered = result('<p data-zn-node="0">body</p><div data-zn-node="1">' + '<p>generated</p>'.repeat(100) + '</div>', [
    { id: "0", kind: "p", precision: "exact", from: 0, to: 4 },
    { id: "1", kind: "div", precision: "generated" },
  ]);
  await page.evaluate(async ({ rendered, source }) => {
    await (window as any).renderResult(rendered, source);
    (window as any).enableScrollSync(source);
  }, { rendered, source });
  await page.frameLocator("iframe").locator("body").hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => page.frameLocator("iframe").locator("body").evaluate(() => window.scrollY)).toBeGreaterThan(500);
  expect(await page.evaluate(() => (window as any).scrollLines)).toEqual([]);
});

test("a closed details block maps its visible summary to the opening source line", async ({ page }) => {
  const source = "??? note\n\n" + "    hidden content\n".repeat(80);
  const rendered = result('<details data-zn-node="0"><summary>Note</summary><p data-zn-node="1">hidden content</p></details>' + '<p>footer</p>'.repeat(100), [
    { id: "0", kind: "details", precision: "exact", from: 0, to: source.length },
    { id: "1", kind: "p", precision: "exact", from: 10, to: source.length, parentId: "0" },
  ]);
  await page.evaluate(async ({ rendered, source }) => {
    await (window as any).renderResult(rendered, source);
    (window as any).enableScrollSync(source);
  }, { rendered, source });
  await page.frameLocator("iframe").locator("body").hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => (window as any).scrollLines.at(-1))).toBe(1);
});
