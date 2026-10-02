import { test, expect } from "@playwright/test";

test("sidebar width can be dragged and restored", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const sidebar = page.locator(".sidebar");
  const resizer = page.getByRole("separator", { name: "调整侧边栏宽度" });
  const handle = await resizer.boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + 3, handle!.y + 100);
  await page.mouse.down();
  await page.mouse.move(340, handle!.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width))
    .toBe(340);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("znote:preferences")!).sidebarWidth,
    ),
  ).toBe(340);
  await page.reload();
  await expect
    .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width))
    .toBe(340);
  await page.locator(".status-sidebar-toggle").click();
  await expect(sidebar).toBeHidden();
  await page.locator(".status-sidebar-toggle").click();
  await expect
    .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width))
    .toBe(340);
  const restoredHandle = await resizer.boundingBox();
  expect(restoredHandle).not.toBeNull();
  await page.mouse.move(restoredHandle!.x + 3, restoredHandle!.y + 100);
  await page.mouse.down();
  await page.mouse.move(480, restoredHandle!.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width))
    .toBe(480);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect
    .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width))
    .toBe(420);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect
    .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width))
    .toBe(480);
});

test("split view divider resizes both panes and restores its ratio", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const editor = page.locator("#editor-stage");
  const divider = page.getByRole("separator", {
    name: "调整编辑区与渲染区宽度",
  });
  await expect(divider).toBeHidden();
  await page.locator('button[data-mode="split"]').click();
  await expect(divider).toBeVisible();
  const area = await page.locator(".writing-area").boundingBox();
  const handle = await divider.boundingBox();
  expect(area).not.toBeNull();
  expect(handle).not.toBeNull();
  const targetWidth = Math.round(area!.width * 0.65);
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 100);
  await page.mouse.down();
  await page.mouse.move(area!.x + targetWidth, handle!.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Math.abs((await editor.evaluate((el) => el.getBoundingClientRect().width)) - targetWidth),
    )
    .toBeLessThan(2);
  const paneEdges = await page.evaluate(() => ({
    editor: document.querySelector("#editor-stage")!.getBoundingClientRect().right,
    preview: document.querySelector("#preview-panel")!.getBoundingClientRect().left,
  }));
  expect(paneEdges.preview).toBe(paneEdges.editor);
  const savedRatio = await page.evaluate(
    () => JSON.parse(localStorage.getItem("znote:preferences")!).splitRatio,
  );
  expect(savedRatio).toBeCloseTo(0.65, 1);
  await page.reload();
  await expect(divider).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs((await editor.evaluate((el) => el.getBoundingClientRect().width)) - targetWidth),
    )
    .toBeLessThan(2);
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect
    .poll(async () => {
      const editorWidth = await editor.evaluate((el) => el.getBoundingClientRect().width);
      const areaWidth = await page.locator(".writing-area").evaluate((el) => el.getBoundingClientRect().width);
      return Math.abs(editorWidth / areaWidth - savedRatio);
    })
    .toBeLessThan(0.01);
  await page.locator('button[data-mode="source"]').click();
  await expect(divider).toBeHidden();
});

test("sidebar file clicks reach the file action instead of the view switch", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#sidebar-content").evaluate((host) => {
    host.insertAdjacentHTML(
      "afterbegin",
      '<button class="file-row" data-file="example.md">example.md</button>',
    );
  });
  await page.locator('[data-file="example.md"]').click();
  await expect(page.locator("#toasts")).toContainText(
    "请在 ZNote 桌面应用中使用文件",
  );
  await page.locator('[data-side="search"]').click();
  await expect(page.locator(".sidebar")).toHaveAttribute("data-side", "search");
});

test("file filter and document search keep separate unsaved queries", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const fileFilter = page.locator("#file-filter");
  const documentSearch = page.locator("#document-search");
  await expect(fileFilter).toHaveAttribute("autocomplete", "off");
  await expect(documentSearch).toHaveAttribute("autocomplete", "off");
  await fileFilter.fill("file-only");
  await page.locator('[data-side="search"]').click();
  await expect(documentSearch).toBeVisible();
  await expect(documentSearch).toHaveValue("");
  await documentSearch.fill("document-only");
  await page.locator('[data-side="files"]').click();
  await expect(fileFilter).toHaveValue("file-only");
  await page.locator('[data-side="search"]').click();
  await expect(documentSearch).toHaveValue("document-only");
  await page.reload();
  await expect(fileFilter).toHaveValue("");
  await page.locator('[data-side="search"]').click();
  await expect(documentSearch).toHaveValue("");
});

test("sidebar search follows only the active document, including unsaved edits", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-add").click();
  await page.locator(".tab-editor:not([hidden]) .cm-content").click();
  await page.keyboard.type("unique sidebar phrase");
  await page.locator('[data-side="search"]').click();
  await page.locator("#document-search").fill("unique sidebar");
  await expect(page.locator("#sidebar-content .search-result")).toHaveCount(1);
  await page.locator(".sidebar-add").click();
  await expect(page.locator("#sidebar-content .search-result")).toHaveCount(0);
  await expect(page.locator("#sidebar-content")).toContainText(
    "当前文档没有匹配内容",
  );
});

test("Ctrl+F opens the preview finder in reading mode and the editor finder in source mode", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-mode="read"]').click();
  await page.keyboard.press("Control+f");
  await expect(page.locator("#preview-find")).toBeVisible();
  await expect(page.locator(".cm-search")).toHaveCount(0);
  await page.locator('[data-mode="source"]').click();
  await expect(page.locator("#preview-find")).toBeHidden();
  await page.locator(".tab-editor:not([hidden]) .cm-content").click();
  await page.keyboard.press("Control+f");
  await expect(page.locator(".cm-search")).toBeVisible();
  await expect(page.locator('.cm-search input[name="search"]')).toHaveAttribute(
    "placeholder",
    "查找",
  );
  expect((await page.locator(".cm-search").boundingBox())!.y).toBeLessThan(230);
});

test("Markdown settings expose extension switches without project actions", async ({
  page,
}) => {
  test.setTimeout(120000); // First navigation can wait for Vite's large preview bundle.
  await page.addInitScript(() => {
    localStorage.removeItem("znote:preferences");
    localStorage.removeItem("znote:drafts");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-action="build"]')).toHaveCount(0);
  await page.locator('[data-action="settings"]').first().click();
  await expect(page.locator("#trust-project")).toHaveCount(0);
  await expect(page.locator('[data-extension="admonition"]')).toBeChecked();
  await expect(page.locator("#sync-preview")).toBeChecked();
  await expect(page.locator("#sync-editor-scroll")).toBeChecked();
  await page.locator("#sync-preview").uncheck();
  await expect(page.locator("#sync-editor-scroll")).toBeChecked();
  await page.locator("#sync-editor-scroll").uncheck();
  await page.locator('[data-settings-tab="extensions"]').click();
  await page.locator('[data-extension="admonition"]').uncheck();
  await page.locator('[data-settings-tab="reading"]').click();
  await page.locator('[data-config="reader.preset"]').selectOption("book");
  await page.locator('[data-settings-tab="advanced"]').click();
  await page.locator('[data-config="variant"]').selectOption("classic");
  await page.locator('[data-config="primary"]').selectOption("teal");
  await page.locator('[data-config="accent"]').selectOption("cyan");
  await page
    .locator("#theme-css-file")
    .setInputFiles({
      name: "my-theme.css",
      mimeType: "text/css",
      buffer: Buffer.from(":root > * { --md-primary-fg-color: #123456; }"),
    });
  const render = await page.evaluate(
    () => JSON.parse(localStorage.getItem("znote:preferences")!).render,
  );
  expect(render.extensions.admonition).toBe(false);
  expect(render.variant).toBe("classic");
  expect(render.reader.font).toBe("serif");
  expect(render.primary).toBe("teal");
  expect(render.accent).toBe("cyan");
  expect(render.customCss).toContain("--md-primary-fg-color: #123456");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("znote:preferences")!).syncPreview,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("znote:preferences")!).syncEditorScroll,
    ),
  ).toBe(false);
});

test("invalid config drafts do not replace preferences and macro edits survive reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-settings-tab="math"]').click();
  await page.locator("#math-macros").fill('{"RR":"\\\\mathbb{R}"}');
  await page.locator("#apply-macros").click();
  await expect(page.locator("#macro-error")).toContainText("已应用");
  const before = await page.evaluate(() =>
    localStorage.getItem("znote:preferences"),
  );
  await page.locator('[data-settings-tab="advanced"]').click();
  await page
    .locator("#render-config-json")
    .fill('{"extensionConfigs":{"toc":{"slugify":"os.system"}}}');
  await page.locator("#config-apply").click();
  await expect(page.locator("#config-error")).toContainText("slugify");
  expect(
    await page.evaluate(() => localStorage.getItem("znote:preferences")),
  ).toBe(before);
  await page.reload();
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-settings-tab="math"]').click();
  expect(
    JSON.parse(await page.locator("#math-macros").inputValue()).RR.body,
  ).toBe("\\mathbb{R}");
});

test("named configurations persist and JSON drafts survive edits in other controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-config="reader.preset"]').selectOption("book");
  await page.locator(".profile-library summary").click();
  await page.locator("#profile-name").fill("长文阅读");
  await page.locator("#profile-save").click();
  await expect(page.locator("#profile-feedback")).toContainText("已保存");
  await page.locator('[data-settings-tab="advanced"]').click();
  const draft = '{"reader":{"preset":"compact"}}';
  await page.locator("#render-config-json").fill(draft);
  await page.locator('[data-config="primary"]').selectOption("teal");
  await expect(page.locator("#render-config-json")).toHaveValue(draft);
  await page.locator("#render-profile").selectOption("0");
  await page.locator("#profile-load").click();
  await expect(page.locator('[data-config="primary"]')).toHaveValue("app");
  await page.reload();
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-config="reader.preset"]').selectOption("compact");
  await page.locator(".profile-library summary").click();
  await page.locator("#render-profile").selectOption("0");
  await page.locator("#profile-load").click();
  await expect(page.locator('[data-config="reader.preset"]')).toHaveValue(
    "book",
  );
  await page.locator(".profile-library summary").click();
  await expect(
    page.frameLocator("#settings-preview iframe").locator("h1"),
  ).toBeVisible();
  await expect(
    page.frameLocator("#settings-preview iframe").locator("body"),
  ).toHaveAttribute("data-zn-reader", "book");
  await page.screenshot({
    path: "build/qa/settings-reading-light.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(
    page.frameLocator("#settings-preview iframe").locator("body"),
  ).toHaveAttribute("data-md-color-scheme", "slate");
  await page.screenshot({
    path: "build/qa/settings-reading-dark.png",
    fullPage: true,
  });
});

test("legacy live preference opens the source editor and all view switches preserve Markdown", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "znote:preferences",
      JSON.stringify({ mode: "live", theme: "light" }),
    );
    localStorage.removeItem("znote:drafts");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-mode="source"].active')).toHaveCount(1);
  await expect(page.locator(".writing-area")).toHaveAttribute(
    "data-mode",
    "source",
  );
  await expect(page.locator('button[data-mode="live"]')).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeVisible();
  const original = await page.locator(".cm-content").textContent();
  await page.locator('button[data-mode="split"]').click();
  await expect(page.locator(".writing-area")).toHaveAttribute(
    "data-mode",
    "split",
  );
  await page.locator('button[data-mode="read"]').click();
  await expect(page.locator(".writing-area")).toHaveAttribute(
    "data-mode",
    "read",
  );
  await page.locator('button[data-mode="source"]').click();
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(await page.locator(".cm-content").textContent()).toBe(original);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("znote:preferences")!).mode,
    ),
  ).toBe("source");
});

test("toolbar prefixes selected source lines and can remove the prefix", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("znote:drafts"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建笔记" }).first().click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.click();
  await page.keyboard.type("one\ntwo");
  await page.keyboard.press("Control+a");
  await page.locator('[data-format="quote"]').click();
  await expect(editor).toContainText("> one");
  await expect(editor).toContainText("> two");
  await page.locator('[data-format="quote"]').click();
  await expect(editor).not.toContainText("> one");
});

test("drag selection survives the editor context menu and formats only selected text", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("znote:drafts"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建笔记" }).first().click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.click();
  await page.keyboard.type("alpha beta gamma");
  const line = page.locator(".tab-editor:not([hidden]) .cm-line").first();
  const box = await line.boundingBox();
  if (!box) throw new Error("Editor line is not visible");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(
    page.locator(".tab-editor:not([hidden]) .cm-selectionBackground"),
  ).not.toHaveCount(0);
  await page.mouse.click(box.x + 50, box.y + box.height / 2, {
    button: "right",
  });
  await expect(page.getByRole("menu", { name: "编辑菜单" })).toBeVisible();
  await page.getByRole("menuitem", { name: "粗体" }).click();
  await expect(editor).toContainText("**alpha");
  await expect(editor).toContainText("**alpha beta **gamma");
  await expect(page.getByRole("menu", { name: "编辑菜单" })).toHaveCount(0);
});

test("mouse selection shows nearby actions and selected length", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("znote:drafts"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建笔记" }).first().click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.click();
  await page.keyboard.type("alpha beta gamma");
  const line = page.locator(".tab-editor:not([hidden]) .cm-line").first();
  const box = await line.boundingBox();
  if (!box) throw new Error("Editor line is not visible");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("#selection-toolbar")).toBeVisible();
  await expect(page.locator("#selection-summary")).toContainText("已选");
  await expect(page.locator("#cursor-position")).toContainText("已选");
  expect(
    await page
      .locator(".tab-editor:not([hidden]) .cm-activeLine")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await page.locator('[data-selection-action="bold"]').click();
  await expect(editor).toContainText("**alpha beta **gamma");
  await expect(page.locator("#selection-toolbar")).toBeHidden();
});

test("cursor navigation updates position without rebuilding the save indicator", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("znote:drafts"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建笔记" }).first().click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.click();
  await page.keyboard.type("alpha beta");
  await page.evaluate(() => {
    const save = document.querySelector("#save-status")!;
    (window as unknown as { saveMutations: number }).saveMutations = 0;
    new MutationObserver((records) => {
      (window as unknown as { saveMutations: number }).saveMutations +=
        records.length;
    }).observe(save, { childList: true, subtree: true, characterData: true });
  });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#cursor-position")).toContainText("列");
  expect(
    await page.evaluate(
      () => (window as unknown as { saveMutations: number }).saveMutations,
    ),
  ).toBe(0);
});

test("editor insert submenu adds Markdown source", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("znote:drafts"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建笔记" }).first().click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.click({ button: "right" });
  await page.getByRole("button", { name: "插入", exact: true }).hover();
  await page.getByRole("menuitem", { name: "水平分割线" }).click();
  await expect(editor).toContainText("---");
});

test("paragraph menu converts block style and insert shortcut creates a code block", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("znote:drafts"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建笔记" }).first().click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.click();
  await page.keyboard.type("# heading");
  await editor.click({ button: "right" });
  await page.getByRole("button", { name: "段落", exact: true }).hover();
  await page.getByRole("menuitem", { name: "二级标题" }).click();
  await expect(editor).toContainText("## heading");
  await page.keyboard.press("Control+Shift+k");
  await expect(editor).toContainText("```");
});

test("context submenu remains in the viewport near the right edge", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("znote:drafts"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建笔记" }).first().click();
  const stage = page.locator("#editor-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Editor stage is not visible");
  await page.mouse.click(box.x + box.width - 15, box.y + 75, {
    button: "right",
  });
  await page.getByRole("button", { name: "插入", exact: true }).hover();
  const submenu = page
    .getByRole("menuitem", { name: "水平分割线" })
    .locator("..");
  const menuBox = await submenu.boundingBox();
  if (!menuBox) throw new Error("Insert submenu is not visible");
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1280);
});

test("context menu copies and pastes selected source", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => localStorage.removeItem("znote:drafts"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建笔记" }).first().click();
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.click();
  await page.keyboard.type("alpha");
  await page.keyboard.press("Control+a");
  await editor.click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "alpha",
  );
  await editor.click();
  await page.keyboard.press("End");
  await editor.click({ button: "right" });
  await page.getByRole("menuitem", { name: "粘贴", exact: true }).click();
  await expect(editor).toContainText("alphaalpha");
});
