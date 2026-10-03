import { test, expect } from "@playwright/test";

test("language round trips preserve layout whitespace and intentionally empty translations", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules directly in browser tests.
    const { localizeUi, setLanguage } = await import("/src/i18n.ts");
    const root = document.createElement("div");
    root.innerHTML = '\n  <span title="行">行</span>\n  <span>设置</span>\n';
    const whitespace = [...root.childNodes].filter(node => node.nodeType === Node.TEXT_NODE);
    const before = whitespace.map(node => node.textContent);
    const snapshots = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      setLanguage("en");
      localizeUi(root);
      snapshots.push([root.querySelector("span")!.textContent, root.querySelector("span")!.title]);
      setLanguage("zh-CN");
      localizeUi(root);
      snapshots.push([root.querySelector("span")!.textContent, root.querySelector("span")!.title]);
    }
    return { before, after: whitespace.map(node => node.textContent), snapshots, label: root.lastElementChild!.textContent };
  });
  expect(result.after).toEqual(result.before);
  expect(result.snapshots).toEqual([["", ""], ["行", "行"], ["", ""], ["行", "行"], ["", ""], ["行", "行"]]);
  expect(result.label).toBe("设置");
});

test("repeated language switches keep the desktop layout and note preview intact", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("znote:preferences", JSON.stringify({ mode: "split", theme: "dark" }));
    const appWindow = window as any;
    appWindow.isTauri = true;
    appWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "read_recovery") return [];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command === "render_markdown") return {
          html: `<pre>${args.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
          toc: [], warnings: [], meta: {},
        };
        return null;
      },
    };
  });
  await page.goto("/");
  await page.locator(".sidebar-add").click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  const source = "# 我的笔记\n\n中文原文 Settings Reading 保持不变。";
  await editor.fill(source);
  const original = await editor.innerText();
  const preview = page.frameLocator("#preview-content iframe").locator("article pre");
  await expect(preview).toHaveText(source);
  const layout = () => page.evaluate(() => {
    const selectors = [".main", ".tabs-bar", ".editor-toolbar", ".writing-area", ".statusbar"];
    return selectors.map(selector => {
      const element = document.querySelector(selector)!;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { selector, x, y, width, height };
    });
  });
  const before = await layout();
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator('[data-action="settings"]').first().click();
    await page.locator("#language-choice").selectOption("en");
    await expect(preview).toHaveText(source);
    await page.locator("#language-choice").selectOption("zh-CN");
    await page.getByRole("button", { name: "完成", exact: true }).click();
    expect(await editor.innerText()).toBe(original);
    await expect(preview).toHaveText(source);
    expect(await layout()).toEqual(before);
    expect(await page.locator("#app").evaluate(root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let strayLines = 0;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.trim() === "行") strayLines++;
      }
      return strayLines;
    })).toBe(0);
  }
});

test("language switches live without replacing editors, unsaved notes or settings drafts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.locator(".sidebar-add").click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.fill("设置\nReading\n中文笔记不会被翻译");
  await editor.evaluate(element => { element.dataset.localeTest = "retained"; });
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-settings-tab="advanced"]').click();
  const draft = '{"reader":{"preset":"compact"}}';
  await page.locator("#render-config-json").fill(draft);
  await page.locator('[data-settings-tab="math"]').click();
  const macros = '{"myMacro":"\\\\alpha"}';
  await page.locator("#math-macros").fill(macros);
  await page.locator('[data-settings-tab="appearance"]').click();
  await page.locator("#language-choice").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Writing & saving", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Paper White", exact: true })).toBeVisible();
  await expect(editor).toHaveAttribute("data-locale-test", "retained");
  await expect(editor.locator(".cm-line")).toHaveText(["设置", "Reading", "中文笔记不会被翻译"]);
  await expect(page.locator("#render-config-json")).toHaveValue(draft);
  await expect(page.locator("#math-macros")).toHaveValue(macros);
  await page.getByRole("tab", { name: "Syntax extensions", exact: true }).click();
  await expect(page.locator('[data-settings-panel="extensions"]')).toContainText("Basic typography");
  await page.getByRole("tab", { name: "Reading", exact: true }).click();
  await expect(page.locator('[data-config="reader.preset"] option[value="book"]')).toHaveText("Book · Serif");
  await expect(page.frameLocator("#settings-preview iframe").locator("h1")).toHaveText("Reading starts with a simple paragraph");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('button[data-mode="source"]')).toContainText("Edit");
  await editor.click();
  await page.keyboard.press("Control+f");
  await expect(page.locator('.cm-search input[name="search"]')).toHaveAttribute("placeholder", "Find");
  await page.keyboard.press("Escape");
  await page.locator('[data-action="settings"]').first().click();
  await expect(page.getByRole("radio", { name: "Ink Green", exact: true })).toBeVisible();
  await page.locator("#language-choice").selectOption("zh-CN");
  await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(editor.locator(".cm-line")).toHaveText(["设置", "Reading", "中文笔记不会被翻译"]);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("replacement");
  await page.keyboard.press("Control+z");
  await expect(editor.locator(".cm-line")).toHaveText(["设置", "Reading", "中文笔记不会被翻译"]);
  expect(errors).toEqual([]);
});

test("English persists across reloads and updates newly opened menus and settings", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-action="settings"]').first().click();
  await page.locator("#language-choice").selectOption("en");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("znote:preferences")!).language)).toBe("en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('[data-mode="split"]')).toContainText("Split");
  await expect(page.locator("#start-page h1")).toHaveText("A little space for your thoughts.");
  await expect(page.locator("#tabs [role=tab]")).toHaveCount(0);
  await page.locator('[data-action="settings"]').first().click();
  await expect(page.locator("#language-choice")).toHaveValue("en");
  await page.getByRole("tab", { name: "Math", exact: true }).click();
  await expect(page.locator('[data-config="math.engine"]')).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Quick actions", exact: true })).toBeVisible();
  await expect(page.locator(".command-list")).toContainText("New note");
});

test("unknown stored languages fall back to Chinese", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("znote:preferences", JSON.stringify({ language: "unknown" })));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator('[data-mode="split"]')).toContainText("对照");
});

test("English is passed to native dialogs and known native errors are localized", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("znote:preferences", JSON.stringify({ language: "en" }));
    const appWindow = window as any;
    appWindow.isTauri = true;
    appWindow.nativeCalls = [];
    appWindow.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        appWindow.nativeCalls.push({ command, args });
        if (command === "read_recovery") return [];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command === "choose_file") throw "文件包含二进制内容，无法作为 Markdown 打开。";
        return null;
      },
    };
  });
  await page.goto("/");
  await page.keyboard.press("Control+o");
  await expect(page.locator("#toasts")).toContainText("The file contains binary data and cannot be opened as Markdown.");
  await page.keyboard.press("Control+Shift+o");
  const calls = await page.evaluate(() => (window as any).nativeCalls);
  expect(calls).toContainEqual({ command: "choose_file", args: { filterLabel: "Markdown / Text" } });
  expect(calls).toContainEqual({ command: "choose_workspace", args: { dialogTitle: "Browse Markdown folder" } });
});
