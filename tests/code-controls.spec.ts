import { test, expect } from "@playwright/test";
import fs from "node:fs";

const fixtures = JSON.parse(fs.readFileSync("tests/fixtures/rendered.json", "utf8"));
const baseline = fixtures.results.regressions;

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/preview.html");
  await page.waitForFunction(() => typeof (window as any).renderResult === "function");
});

test("copy control preserves source code while annotations are mounted", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const result = structuredClone(baseline);
  result.plan.features.codeCopy = true;
  result.plan.features.codeAnnotations = true;
  result.html = '<div class="highlight"><pre><code><span id="__span-0-1"><a id="__codelineno-0-1" href="#__codelineno-0-1"></a>x  <span class="c1"># (1)!</span>\n</span></code></pre></div><ol><li>注释正文</li></ol>';
  await page.evaluate(() => document.querySelector("#surface")!.addEventListener("code-copy-feedback", (event) => {
    document.querySelector("#surface")!.setAttribute("data-copy-result", String((event as CustomEvent).detail.success));
  }));
  await page.evaluate((value) => (window as any).renderResult(value), result);
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("button", { name: "代码注释 1" })).toHaveCount(1);
  await frame.getByRole("button", { name: "复制代码" }).click();
  await expect(page.locator("#surface")).toHaveAttribute("data-copy-result", "true");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("x  # (1)!");
  const appearance = await frame.locator(".md-code__button[data-md-type='copy']").evaluate((button) => ({
    width: getComputedStyle(button).width,
    icon: getComputedStyle(button, "::after").maskImage,
  }));
  expect(appearance.width).not.toBe("auto");
  expect(appearance.icon).not.toBe("none");

  await page.evaluate((value) => (window as any).renderResult(value), result);
  await expect(frame.getByRole("button", { name: "选择代码行" })).toHaveCount(0);
  await expect(frame.locator(".md-code__button[data-md-type='copy']")).toHaveCount(1);
});

test("copy failure reports a visible host event and restores the button", async ({ page }) => {
  const result = structuredClone(baseline);
  result.plan.features.codeCopy = true;
  result.html = '<div class="highlight"><pre><code>hello\n</code></pre></div>';
  await page.evaluate(() => {
    document.querySelector("#surface")!.addEventListener("code-copy-feedback", (event) => {
      document.querySelector("#surface")!.setAttribute("data-copy-result", String((event as CustomEvent).detail.success));
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("denied"); } },
    });
    document.execCommand = () => false;
  });
  await page.evaluate((value) => (window as any).renderResult(value), result);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "复制代码" }).click();
  await expect(page.locator("#surface")).toHaveAttribute("data-copy-result", "false");
  await expect(frame.getByRole("button", { name: "复制失败" })).toBeEnabled();
  await expect(frame.getByRole("button", { name: "复制失败" })).not.toHaveAttribute("aria-busy");
});

test("line selection follows Zensical single and Shift range behavior", async ({ page }) => {
  const result = structuredClone(baseline);
  result.plan.features.codeCopy = false;
  result.plan.features.codeSelect = true;
  result.html = '<p><a href="#__codelineno-0-2:3">跳转到代码行</a></p><div class="highlight"><pre><code>' + [1, 2, 3].map((line) => `<span id="__span-0-${line}"><a id="__codelineno-0-${line}" href="#__codelineno-0-${line}"></a>line ${line}\n</span>`).join("") + '</code></pre></div>';
  await page.evaluate((value) => (window as any).renderResult(value), result);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "选择代码行" }).click();
  await frame.locator("code > span").nth(0).click();
  await expect(frame.locator("code > span .hll")).toHaveCount(1);
  await frame.locator("code > span").nth(2).click({ modifiers: ["Shift"] });
  await expect(frame.locator("code > span .hll")).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#__codelineno-0-1:3");
  await frame.getByRole("button", { name: "选择代码行" }).click();
  await frame.getByRole("link", { name: "跳转到代码行" }).click();
  await expect(frame.locator("code > span .hll")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#__codelineno-0-2:3");
});

test("per-block enable and disable classes override global controls", async ({ page }) => {
  const result = structuredClone(baseline);
  result.plan.features.codeCopy = true;
  result.plan.features.codeSelect = true;
  const code = '<pre><code><span id="__span-0-1"><a id="__codelineno-0-1"></a>hello\n</span></code></pre>';
  result.html = `<div class="highlight no-copy no-select">${code}</div>`;
  await page.evaluate((value) => (window as any).renderResult(value), result);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".md-code__button")).toHaveCount(0);

  result.plan.features.codeCopy = false;
  result.plan.features.codeSelect = false;
  result.html = `<div class="highlight copy select">${code}</div>`;
  await page.evaluate((value) => (window as any).renderResult(value), result);
  await expect(frame.locator(".md-code__button")).toHaveCount(2);
});

test("named blocks retain authored highlighted lines during selection", async ({ page }) => {
  const result = structuredClone(baseline);
  result.plan.features.codeSelect = true;
  result.html = '<div id="snippet" class="highlight"><pre><code><span id="__span-snippet-1"><a id="__codelineno-snippet-1"></a>first\n</span><span id="__span-snippet-2"><a id="__codelineno-snippet-2"></a><span class="hll">second\n</span></span></code></pre></div>';
  await page.evaluate((value) => (window as any).renderResult(value), result);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "选择代码行" }).click();
  await frame.locator("code > span").first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#__codelineno-snippet-1");
  await expect(frame.locator("code > span .hll.znote-code-selection")).toHaveCount(1);
  await expect(frame.locator("code > span .hll:not(.znote-code-selection)")).toHaveCount(1);
  await frame.locator("code > span").last().click();
  await expect(frame.locator("code > span .hll:not(.znote-code-selection)")).toHaveCount(1);
});
