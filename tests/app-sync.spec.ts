import { test, expect } from "@playwright/test";

test("appearance settings update preview without a renderer request", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("znote:preferences");
    const appWindow = window as any;
    appWindow.isTauri = true;
    appWindow.renderRequests = 0;
    let callback = 0;
    appWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "read_recovery") return [{ name: "style.md", text: "# Style", base: "# Style", dirty: true }];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command !== "render_markdown") return null;
        appWindow.renderRequests++;
        return {
          html: "<h1>Style</h1>", toc: [], warnings: [], meta: {},
          effectiveConfig: args.includeEffectiveConfig ? args.settings : undefined,
          plan: { schemaVersion: 4, math: args.settings.math, mermaid: args.settings.mermaid,
            features: args.settings.features, runtimes: [], styles: [],
            revisions: { parse: "parse", runtime: "runtime" } },
        };
      },
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-mode="split"]').click();
  const article = page.frameLocator("#preview-content iframe").locator("article");
  await expect(article).toContainText("Style");
  await article.evaluate(element => {
    (element.ownerDocument.defaultView as any).originalHeading = element.querySelector("h1");
  });
  await page.locator('[data-action="settings"]').first().click();
  await expect(page.frameLocator("#settings-preview iframe").locator("article")).toContainText("Style");
  const requests = await page.evaluate(() => (window as any).renderRequests);
  await page.locator('[data-settings-tab="advanced"]').click();
  await page.locator('[data-config="variant"]').selectOption("classic");
  await expect(page.frameLocator("#preview-content iframe").locator("body")).toHaveAttribute("data-zn-variant", "classic");
  expect(await article.evaluate(element =>
    (element.ownerDocument.defaultView as any).originalHeading === element.querySelector("h1"),
  )).toBe(true);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).renderRequests)).toBe(requests);
  await page.locator("#modal-root [data-dismiss]").last().click();
  await page.locator('[data-action="theme"]').click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).renderRequests)).toBe(requests);
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-settings-tab="extensions"]').click();
  await page.locator('[data-extension="admonition"]').uncheck();
  await expect.poll(() => page.evaluate(() => (window as any).renderRequests)).toBeGreaterThan(requests);
});

test("native render commits respect later preview reading and cursor-only moves do not render", async ({ page }) => {
  const source = Array.from({ length: 100 }, (_, i) => "paragraph " + i).join("\n\n");
  await page.addInitScript(source => {
    const appWindow = window as any;
    appWindow.isTauri = true;
    appWindow.renderRequests = 0;
    appWindow.pendingRenders = [];
    appWindow.holdRenders = false;
    let callback = 0;
    appWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "read_recovery") return [{ name: "sync.md", text: source, base: source, dirty: true }];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command !== "render_markdown") return null;
        appWindow.renderRequests++;
        const entries: any[] = [];
        let offset = 0;
        const html = args.text.split("\n\n").map((text: string, i: number) => {
          entries.push({ id: String(i), kind: "p", precision: "exact", from: offset, to: offset + text.length });
          offset += text.length + 2;
          return `<p data-zn-node="${i}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;
        }).join("");
        const result = { html, toc: [], warnings: [], meta: {},
          sourceMap: { version: 1, offsetEncoding: "utf-16", entries } };
        if (!appWindow.holdRenders) return result;
        return await new Promise(resolve => appWindow.pendingRenders.push(() => resolve(result)));
      },
    };
  }, source);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-mode="split"]').click();
  const frame = page.frameLocator("#preview-content iframe");
  await expect(frame.locator("p").first()).toHaveText("paragraph 0");
  await page.evaluate(() => { (window as any).holdRenders = true; });
  await page.locator(".tab-editor:not([hidden]) .cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect.poll(() => page.evaluate(() => (window as any).pendingRenders.length)).toBe(1);
  await frame.locator("body").hover();
  await page.mouse.wheel(0, 1400);
  await expect.poll(() => frame.locator("body").evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const before = await frame.locator("body").evaluate(() => window.scrollY);
  await page.evaluate(() => {
    (window as any).holdRenders = false;
    (window as any).pendingRenders.splice(0).forEach((resolve: () => void) => resolve());
  });
  await expect(frame.locator("p").first()).toHaveText("paragraph 0!");
  await expect.poll(() => frame.locator("body").evaluate(() => window.scrollY)).toBeCloseTo(before, 0);
  await expect(page.locator("#cursor-position")).toContainText("行 1");
  const requests = await page.evaluate(() => (window as any).renderRequests);
  await page.locator(".tab-editor:not([hidden]) .cm-content").focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).renderRequests)).toBe(requests);
});
