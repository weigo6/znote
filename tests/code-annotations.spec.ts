import { test, expect } from "@playwright/test";
import fs from "node:fs";

const fixtures = JSON.parse(fs.readFileSync("tests/fixtures/rendered.json", "utf8"));
const baseline = fixtures.results[fixtures.samples.regressions.trim()];

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/preview.html");
  await page.waitForFunction(() => typeof (window as any).renderResult === "function");
});

test("Pygments comment markers open Markdown annotations and survive partial updates", async ({ page }) => {
  const result = structuredClone(baseline);
  result.plan.features.codeAnnotations = true;
  result.html = '<div class="highlight"><pre><code><span class="n">x</span> <span class="c1"># (1)!</span>\n</code></pre></div><ol><li><p><strong>第一条说明</strong> <a href="second.md">另一篇</a></p></li></ol>';
  await page.evaluate((value) => {
    document.querySelector("#surface")!.addEventListener("note-link", (event) => {
      document.querySelector("#surface")!.setAttribute("data-link", (event as CustomEvent).detail);
    });
    return (window as any).renderResult(value);
  }, result);
  const frame = page.frameLocator("iframe");
  const badge = frame.getByRole("button", { name: "代码注释 1" });
  await expect(badge).toHaveCount(1);
  await expect(frame.locator(".highlight code")).not.toContainText("# (1)!");
  await expect(frame.locator("ol.znote-code-annotation-list")).toBeHidden();
  await badge.focus();
  await expect(frame.getByRole("dialog", { name: "代码注释 1" })).toContainText("第一条说明");
  await frame.getByRole("link", { name: "另一篇" }).click();
  await expect(page.locator("#surface")).toHaveAttribute("data-link", "second.md");
  await page.keyboard.press("Escape");
  await expect(frame.getByRole("dialog", { name: "代码注释 1" })).toHaveCount(0);

  result.html = result.html.replace("第一条说明", "更新后的说明");
  await page.evaluate((value) => (window as any).renderResult(value), result);
  await expect(frame.getByRole("button", { name: "代码注释 1" })).toHaveCount(1);
  await frame.getByRole("button", { name: "代码注释 1" }).focus();
  await expect(frame.getByRole("dialog", { name: "代码注释 1" })).toContainText("更新后的说明");

  result.plan.features.codeAnnotations = false;
  result.plan.revisions.runtime = "annotations-disabled";
  await page.evaluate((value) => (window as any).renderResult(value), result);
  await expect(frame.locator(".znote-code-annotation")).toHaveCount(0);
  await expect(frame.locator("ol")).toBeVisible();
});

test("strings and unmatched markers remain literal; forced markers replace their token", async ({ page }) => {
  const result = structuredClone(baseline);
  result.plan.features.codeAnnotations = true;
  result.html = '<div class="highlight"><pre><code><span class="s2">"(1)"</span> <span class="c1"># (2)</span></code></pre></div><ol><li>普通列表</li></ol>';
  await page.evaluate((value) => (window as any).renderResult(value), result);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".znote-code-annotation")).toHaveCount(0);
  await expect(frame.locator(".highlight code")).toContainText('"(1)" # (2)');
  await expect(frame.locator("ol")).toBeVisible();

  result.html = '<div class="highlight"><pre><code><span class="c1"># (1)! (2)!</span></code></pre></div><ol><li>第一条</li><li>第二条</li></ol>';
  await page.evaluate((value) => (window as any).renderResult(value), result);
  await expect(frame.locator(".znote-code-annotation")).toHaveCount(1);
  await expect(frame.locator(".highlight code")).not.toContainText("# (1)! (2)!");
  await expect(frame.locator("ol")).toBeHidden();
});

test("a single annotated block works with the global setting off", async ({ page }) => {
  const result = structuredClone(baseline);
  result.plan.features.codeAnnotations = false;
  result.html = '<div class="highlight annotate"><pre><code><span class="c1"># note (1)</span></code></pre></div><ol><li><p>局部说明</p></li></ol>';
  await page.evaluate((value) => (window as any).renderResult(value), result);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".highlight code")).toContainText("# note ");
  await expect(frame.getByRole("button", { name: "代码注释 1" })).toBeVisible();
  await expect(frame.locator("ol")).toBeHidden();
});

test("numbered Pygments blocks keep the code line and annotation aligned", async ({ page }) => {
  const result = structuredClone(baseline);
  result.plan.features.codeAnnotations = true;
  result.html = '<div class="language-python highlight"><table class="highlighttable"><tr><td class="linenos"><div class="linenodiv"><pre><span class="normal">1</span></pre></div></td><td class="code"><div><pre><code><span id="__span-0-1"><span class="n">x</span> <span class="c1"># (1)!</span>\n</span></code></pre></div></td></tr></table></div><ol><li>行号说明</li></ol>';
  await page.evaluate((value) => (window as any).renderResult(value), result);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".linenos")).toContainText("1");
  await expect(frame.getByRole("button", { name: "代码注释 1" })).toHaveCount(1);
  await expect(frame.locator("ol")).toBeHidden();
  const offset = await frame.locator(".highlighttable").evaluate((table) => {
    const top = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().top;
    };
    return Math.abs(top(table.querySelector(".linenos .normal")!) - top(table.querySelector("code > span")!));
  });
  expect(offset).toBeLessThan(1);
});
