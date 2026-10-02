import { test, expect } from "@playwright/test";
import fs from "node:fs";
const fixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/rendered.json", "utf8"),
);
const regression = fixtures.results[fixtures.samples.regressions.trim()];

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/preview.html");
  await page.waitForFunction(
    () => typeof (window as any).renderResult === "function",
  );
});

for (const variant of ["modern", "classic"])
  for (const scheme of ["light", "dark"]) {
    test(`${variant}/${scheme}: real renderer retains diagram labels, aligned code and packaged icons`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const result = structuredClone(regression);
      result.theme.variant = variant;
      await page.evaluate(
        async ({ result, scheme }) => {
          document.documentElement.dataset.theme = scheme;
          await (window as any).renderResult(result);
        },
        { result, scheme },
      );
      const frame = page.frameLocator("iframe");
      await expect(
        frame.locator(".mermaid text").filter({ hasText: "Start" }),
      ).toBeVisible();
      await expect(frame.locator(".mermaid")).toContainText("Yes");
      await expect(frame.locator(".mermaid foreignObject")).toHaveCount(0);
      await expect(frame.locator(".twemoji svg")).toHaveCount(3);
      await frame.locator("body").evaluate(() => document.fonts.ready);
      const alignment = await frame
        .locator(".highlighttable")
        .evaluate((el) => {
          const top = (node: Element) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect().top;
          };
          const numbers = Array.from(
              el.querySelectorAll(".linenodiv .normal"),
              top,
            ),
            lines = Array.from(el.querySelectorAll("code > span"), top);
          return numbers.map((value, i) => Math.abs(value - lines[i]));
        });
      expect(Math.max(...alignment)).toBeLessThan(1);
      const background = await frame
        .locator("body")
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      const application = await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background).toBe(application);
      await frame.locator(".footnote-ref").hover();
      await expect(frame.getByRole("tooltip")).toContainText("这段中文脚注");
      await page.keyboard.press("Escape");
      await expect(frame.getByRole("tooltip")).toHaveCount(0);
      await frame.locator(".footnote-ref").focus();
      await expect(frame.getByRole("tooltip")).toBeVisible();
      await frame.locator(".footnote-ref").click();
      await expect(frame.getByRole("tooltip")).toHaveCount(0);
      expect(errors).toEqual([]);
      fs.mkdirSync("build/qa", { recursive: true });
      await frame
        .locator("body")
        .evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({
        path: `build/qa/reader-${variant}-${scheme}.png`,
        fullPage: true,
      });
    });
  }

test("parameter macros and engine settings reach both engines without sharing document state", async ({
  page,
}) => {
  for (const engine of ["katex", "mathjax"]) {
    const result = structuredClone(regression);
    result.html = '<p class="arithmatex">\\(\\norm{x}+\\RR\\)</p>';
    result.plan.math.engine = engine;
    result.plan.math.macros = {
      RR: { body: "\\mathbb{R}", args: 0 },
      norm: { body: "\\lVert #1\\rVert", args: 1 },
    };
    result.plan.math.katex.fleqn = true;
    await page.evaluate(
      (result) => (window as any).renderResult(result),
      result,
    );
    await expect(
      page
        .frameLocator("iframe")
        .locator(engine === "katex" ? ".katex" : ".arithmatex svg"),
    ).toHaveCount(1);
    await expect(
      page.frameLocator("iframe").locator(".math-error"),
    ).toHaveCount(0);
  }
  const defined = structuredClone(regression);
  defined.html =
    '<p class="arithmatex">\\(\\gdef\\foo{z}\\foo\\)</p><p class="arithmatex">\\(\\foo\\)</p>';
  await page.evaluate(
    (result) => (window as any).renderResult(result),
    defined,
  );
  await expect(page.frameLocator("iframe").locator(".katex")).toHaveCount(2);
  defined.html = '<p class="arithmatex">\\(\\foo\\)</p>';
  await page.evaluate(
    (result) => (window as any).renderResult(result),
    defined,
  );
  await expect(page.frameLocator("iframe").locator(".math-error")).toHaveCount(
    1,
  );
});

test("HTML styles stay inside the reader and can be disabled independently", async ({
  page,
}) => {
  const result = structuredClone(regression);
  await page.evaluate((result) => (window as any).renderResult(result), result);
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("内联样式", { exact: true })).toHaveCSS(
    "color",
    "rgb(90, 110, 130)",
  );
  await expect(frame.locator(".local-style")).toHaveCSS("font-weight", "700");
  result.plan.features.inlineStyles = false;
  await page.evaluate((result) => (window as any).renderResult(result), result);
  await expect(frame.locator("article > style")).toHaveCount(0);
  await expect(
    frame.getByText("内联样式", { exact: true }),
  ).not.toHaveAttribute("style");
  result.plan.features.footnoteTooltips = false;
  await page.evaluate((result) => (window as any).renderResult(result), result);
  await frame.locator(".footnote-ref").hover();
  await expect(frame.getByRole("tooltip")).toHaveCount(0);
});

test("plain-text reading presets differ and remain coordinated during live theme switches", async ({
  page,
}) => {
  const result = structuredClone(regression);
  result.html = "<h1>普通笔记</h1><p>没有链接和特殊语法的正文。</p>";
  const snapshots = [];
  for (const reader of [
    { preset: "integrated", font: "sans", lineHeight: 1.8, width: 820 },
    { preset: "book", font: "serif", lineHeight: 2, width: 720 },
    { preset: "compact", font: "sans", lineHeight: 1.6, width: 1000 },
  ]) {
    result.theme.reader = reader;
    await page.evaluate(
      (result) => (window as any).renderResult(result),
      result,
    );
    snapshots.push(
      await page
        .frameLocator("iframe")
        .locator("p")
        .evaluate((el) => {
          const c = getComputedStyle(el);
          return [c.fontFamily, c.lineHeight];
        }),
    );
  }
  expect(new Set(snapshots.map((value) => JSON.stringify(value))).size).toBe(3);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect
    .poll(async () => {
      const app = await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      const doc = await page
        .frameLocator("iframe")
        .locator("body")
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      return app === doc;
    })
    .toBe(true);
});

test("style-only commits preserve formula DOM and remount delegated footnotes", async ({
  page,
}) => {
  const result = structuredClone(regression);
  result.html += '<p class="arithmatex">\\(x^2\\)</p>';
  await page.evaluate((result) => (window as any).renderResult(result), result);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".katex")).toHaveCount(1);
  await frame.locator(".katex").evaluate((el) => {
    (window as any).originalFormula = el;
  });
  result.theme.reader = {
    preset: "book",
    font: "serif",
    lineHeight: 2,
    width: 720,
  };
  result.plan.revisions.style = "book-style";
  await page.evaluate((result) => (window as any).renderResult(result), result);
  expect(
    await frame
      .locator(".katex")
      .evaluate((el) => el === (window as any).originalFormula),
  ).toBe(true);
  await frame.locator(".footnote-ref").hover();
  await expect(frame.getByRole("tooltip")).toContainText("这段中文脚注");
  await frame.locator(".footnote-ref").click();
  await expect(frame.getByRole("tooltip")).toHaveCount(0);
});
