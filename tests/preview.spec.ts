import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/tests/preview.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof (window as any).renderPreview === "function",
  );
});
test("preview find highlights only visible article text and navigates exact matches", async ({ page }) => {
  await page.locator("#chrome").evaluate((node) => (node.textContent = "zensical outside preview"));
  await page.evaluate(async () => {
    await (window as any).renderPreview("none", "", "<p>Zen<strong>sical</strong> in this note</p><p>zensical again</p><p hidden>zensical hidden</p>");
  });
  const initial = await page.evaluate(() => (window as any).findPreview("zensical"));
  expect(initial).toMatchObject({ count: 2, index: 0 });
  const highlights = await page.frameLocator("iframe").locator("article").evaluate(() =>
    Array.from(CSS.highlights.get("znote-find-matches") || [], (range) => range.toString()),
  );
  expect(highlights).toEqual(["Zensical", "zensical"]);
  await page.frameLocator("iframe").locator("article").click();
  await page.keyboard.press("Control+f");
  expect(await page.evaluate(() => (window as any).getFindShortcutCount())).toBe(1);
  expect(await page.evaluate(() => (window as any).nextPreviewFind(1))).toMatchObject({ count: 2, index: 1 });
  await page.evaluate(() => (window as any).clearPreviewFind());
  expect(await page.frameLocator("iframe").locator("article").evaluate(() => CSS.highlights.has("znote-find-matches"))).toBe(false);
});

test("print preparation renders the full note and forwards Ctrl+P from the preview", async ({ page }) => {
  const html = Array.from({ length: 81 }, (_, index) =>
    `<p class="arithmatex">\\(x_{${index}}\\)</p>`,
  ).join("");
  await page.evaluate(async (markup) => {
    const result = {
      html: markup,
      toc: [], meta: {}, warnings: [], profile: "test", extensions: [],
      highlightCss: "",
      plan: { schemaVersion: 3, engine: "test", engineVersion: "1", configRevision: "1",
        documentPath: null, math: { engine: "katex", macros: {} },
        runtimes: [], features: {}, sources: [], extensions: [], styles: [], dependencies: [] },
    };
    await (window as any).renderResult(result, "", "print-note", true);
  }, html);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".arithmatex .katex")).toHaveCount(81);
  await frame.locator("article").click();
  await page.keyboard.press("Control+p");
  expect(await page.evaluate(() => (window as any).getPrintShortcutCount())).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(frame.locator("body")).toHaveCSS("padding", "0px");
});

test("user CSS is isolated and formulas switch between offline engines", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() =>
    (window as any).renderPreview(
      "katex",
      "body{background:rgb(1,2,3)}h1{color:rgb(22,33,44)}#chrome{display:none}",
    ),
  );
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".katex")).toHaveCount(1);
  await expect(frame.locator("h1")).toHaveCSS("color", "rgb(22, 33, 44)");
  await expect(page.locator("#chrome")).toBeVisible();
  await page.evaluate(() => (window as any).renderPreview("mathjax"));
  await expect(frame.locator(".arithmatex svg")).toHaveCount(1);
  await expect(frame.locator(".katex")).toHaveCount(0);
  await page.evaluate(() => (window as any).renderPreview("none"));
  await expect(frame.locator(".arithmatex")).toContainText("x^2");
  await expect(frame.locator("svg,.katex")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).warnings)).toEqual([]);
  expect(errors).toEqual([]);
});
test("superseded renders cannot replace the active document", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const first = (window as any).renderPreview("mathjax");
    const last = (window as any).renderPreview("none", "", "<h1>最新文档</h1>");
    await Promise.all([first, last]);
  });
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
    "最新文档",
  );
});
test("updates reuse the preview frame and retain its scroll position", async ({ page }) => {
  const body = Array.from({ length: 90 }, (_, i) => `<p>第 ${i} 段内容</p>`).join("");
  await page.evaluate(async html => {
    await (window as any).renderPreview("none", "", html);
    const frame = document.querySelector("iframe")!;
    (window as any).firstPreviewFrame = frame;
    (window as any).firstParagraphs = Array.from(frame.contentDocument!.querySelectorAll("p"));
  }, body);
  const before = await page.frameLocator("iframe").locator("body").evaluate(() => {
    window.scrollTo(0, 520);
    return window.scrollY;
  });
  expect(before).toBeGreaterThan(0);
  await page.evaluate(html => (window as any).renderPreview("none", "", html.replace("<p>第 45 段内容</p>", "<p>第 45 段内容（已修改）</p>") + "<p>新增段落</p>"), body);
  expect(await page.evaluate(() => document.querySelector("iframe") === (window as any).firstPreviewFrame)).toBe(true);
  const blocks = await page.evaluate(() => {
    const paragraphs = Array.from(document.querySelector("iframe")!.contentDocument!.querySelectorAll("p"));
    const previous = (window as any).firstParagraphs;
    return [paragraphs[0] === previous[0], paragraphs[45] === previous[45], paragraphs[46] === previous[46]];
  });
  expect(blocks).toEqual([true, false, true]);
  await page.evaluate(html => (window as any).renderPreview("none", "", html.replace("<p>第 45 段内容</p>", "<p><strong>第 45 段内容</strong></p>")), body);
  await expect(page.frameLocator("iframe").locator("p strong")).toHaveText("第 45 段内容");
  const after = await page.frameLocator("iframe").locator("body").evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});

test("large notes typeset visible formulas and reuse unchanged math blocks", async ({ page }) => {
  const html = '<p>Introduction</p>' + Array.from(
    { length: 120 },
    (_, i) => `<p class="arithmatex">\\(x_{${i}}\\)</p>`,
  ).join("");
  await page.evaluate(html => (window as any).renderPreview("katex", "", html), html);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".arithmatex .katex").first()).toBeVisible();
  const initial = await frame.locator(".arithmatex .katex").count();
  expect(initial).toBeLessThan(120);
  await page.evaluate(() => {
    (window as any).firstMath = document.querySelector("iframe")!
      .contentDocument!.querySelector(".arithmatex");
  });
  await page.evaluate(html => (window as any).renderPreview("katex", "", html.replace("Introduction", "Revised introduction")), html);
  expect(await page.evaluate(() => document.querySelector("iframe")!
    .contentDocument!.querySelector(".arithmatex") === (window as any).firstMath)).toBe(true);
  await frame.locator(".arithmatex").last().scrollIntoViewIfNeeded();
  await expect(frame.locator(".arithmatex .katex").last()).toBeVisible();
});

test("deferred formulas retain document-wide definitions", async ({ page }) => {
  const html = (definition: string) =>
    `<p class="arithmatex">\\(\\gdef\\foo{${definition}}\\foo\\)</p>` +
    Array.from({ length: 85 }, () => '<p class="arithmatex">\\(x\\)</p>').join("") +
    '<p class="arithmatex">\\(\\foo\\)</p>';
  await page.evaluate(body => (window as any).renderPreview("katex", "", body), html("A"));
  const frame = page.frameLocator("iframe");
  await frame.locator(".arithmatex").last().scrollIntoViewIfNeeded();
  await expect(frame.locator(".arithmatex").last().locator(".katex")).toContainText("A");
  await page.evaluate(body => (window as any).renderPreview("katex", "", body), html("B"));
  await expect(frame.locator(".arithmatex").last().locator(".katex")).toContainText("B");
});

test("large diagram collections render diagrams as they enter view", async ({ page }) => {
  const html = Array.from(
    { length: 9 },
    (_, i) => `<div class="mermaid">graph LR\nA${i}[Start] --> B${i}[End]</div><div style="height:400px"></div>`,
  ).join("");
  await page.evaluate(body => (window as any).renderPreview("none", "", body), html);
  const diagrams = page.frameLocator("iframe").locator(".mermaid");
  await expect(diagrams.first().locator("svg")).toHaveCount(1, { timeout: 30000 });
  await expect(diagrams.last().locator("svg")).toHaveCount(0);
  await diagrams.last().scrollIntoViewIfNeeded();
  await expect(diagrams.last().locator("svg")).toHaveCount(1, { timeout: 30000 });
});
test("editor line scrolls the corresponding preview paragraph into view", async ({ page }) => {
  const source = Array.from({ length: 80 }, (_, i) => `第 ${i} 段内容`).join("\n\n");
  const html = Array.from({ length: 80 }, (_, i) => `<p>第 ${i} 段内容</p>`).join("");
  await page.evaluate(async ({ source, html }) => {
    await (window as any).renderPreview("none", "", html);
    (window as any).scrollPreview(source, 141);
  }, { source, html });
  const frame = page.frameLocator("iframe");
  const position = await frame.locator("p").nth(70).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: document.documentElement.clientHeight, scrollY: window.scrollY };
  });
  expect(position.scrollY).toBeGreaterThan(0);
  expect(position.top).toBeGreaterThanOrEqual(0);
  expect(position.bottom).toBeLessThanOrEqual(position.height);
});

test("preview scrollbar shares the editor palette in both themes", async ({ page }) => {
  await page.evaluate(async () => {
    await (window as any).renderPreview("none", "", "<p>正文</p>");
  });
  const scrollbar = async () => page.evaluate(() => {
    const doc = document.querySelector("iframe")!.contentDocument!;
    return {
      editor: getComputedStyle(document.documentElement).getPropertyValue("--scrollbar").trim(),
      preview: getComputedStyle(doc.documentElement).getPropertyValue("--scrollbar").trim(),
      rules: Array.from(doc.querySelectorAll("style")).some(style =>
        style.textContent?.includes("::-webkit-scrollbar-thumb:hover")),
    };
  });
  expect(await scrollbar()).toMatchObject({ editor: "#d6dbd3", preview: "#d6dbd3", rules: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await expect.poll(scrollbar).toMatchObject({ editor: "#3b4c40", preview: "#3b4c40", rules: true });
});

test("user preview scrolling reports source lines without echoing editor scrolling", async ({ page }) => {
  const source = Array.from({ length: 80 }, (_, i) => `第 ${i} 段内容`).join("\n\n");
  const html = Array.from({ length: 80 }, (_, i) => `<p>第 ${i} 段内容</p>`).join("");
  await page.evaluate(async ({ source, html }) => {
    await (window as any).renderPreview("none", "", html);
    (window as any).enableScrollSync(source);
    (window as any).scrollPreview(source, 81);
  }, { source, html });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).scrollLines)).toEqual([]);
  await page.frameLocator("iframe").locator("body").hover();
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => page.evaluate(() => (window as any).scrollLines.at(-1) ?? 0)).toBeGreaterThan(41);
});
test("untrusted HTML cannot execute and iframe has no app bridge", async ({
  page,
}) => {
  await page.evaluate(() =>
    (window as any).renderPreview(
      "none",
      "",
      '<script>parent.document.querySelector("#chrome").remove()</script><img onerror="parent.document.querySelector(\"#chrome\").remove()" src="data:,bad"><h1>保留正文</h1>',
    ),
  );
  await expect(page.locator("#chrome")).toBeVisible();
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("script,[onerror]")).toHaveCount(0);
  expect(
    await frame
      .locator("body")
      .evaluate(() => typeof (window as any).__TAURI_INTERNALS__),
  ).toBe("undefined");
});
test("isolated tabs remain interactive and local note links reach the host", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const host = document.querySelector("#surface")!;
    host.addEventListener("note-link", (event) =>
      host.setAttribute("data-link", (event as CustomEvent).detail),
    );
    await (window as any).renderPreview(
      "none",
      "",
      '<div class="tabbed-set tabbed-alternate" data-tabs="1:2"><input type="radio" name="tabs" id="t1" checked><input type="radio" name="tabs" id="t2"><div class="tabbed-labels"><label for="t1">第一项</label><label for="t2">第二项</label></div><div class="tabbed-content"><div class="tabbed-block">内容一</div><div class="tabbed-block">内容二</div></div></div><a href="other.md">另一篇</a>',
    );
  });
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("内容一")).toBeVisible();
  await frame.getByRole("tab", { name: "第二项" }).click();
  await expect(frame.getByText("内容二")).toBeVisible();
  await expect(frame.getByText("内容一")).toBeHidden();
  await frame.getByRole("link", { name: "另一篇" }).click();
  await expect(page.locator("#surface")).toHaveAttribute(
    "data-link",
    "other.md",
  );
});
test("imported user CSS works under desktop CSP", async ({ page }) => {
  await page.evaluate(() => {
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' data:; font-src 'self' data:; img-src 'self' data: blob: https:; frame-src 'self' blob:";
    document.head.append(policy);
    return (window as any).renderPreview(
      "none",
      '@import url("data:text/css;base64,' +
        btoa("h1{color:rgb(55,66,77)}") +
        '") screen;',
    );
  });
  await expect(page.frameLocator("iframe").locator("h1")).toHaveCSS(
    "color",
    "rgb(55, 66, 77)",
  );
});

test("theme palette and CSS overrides apply only inside the reader", async ({ page }) => {
  await page.evaluate(() => (window as any).renderPreview(
    "none", ":root > * { --md-primary-fg-color: rgb(18, 52, 86); }",
    "<h1>主题预览</h1><p><a href='#'>链接</a></p>",
    { variant: "classic", primary: "teal", accent: "cyan" },
  ));
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("body")).toHaveAttribute("data-zn-variant", "classic");
  await expect(frame.locator("body")).toHaveAttribute("data-md-color-primary", "teal");
  await expect(frame.locator("body")).toHaveAttribute("data-md-color-accent", "cyan");
  await expect(frame.locator("a")).toHaveCSS("color", "rgb(18, 52, 86)");
  await expect(page.locator("#chrome")).toBeVisible();
});
