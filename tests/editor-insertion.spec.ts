import { test, expect, type Page } from "@playwright/test";

const original = "alpha beta";
const imageMarkdown = "![pic.png](assets/pic.png)";
const activeContent = (page: Page) =>
  page.locator(".tab-editor:not([hidden]) .cm-content");

async function updateEditor(
  page: Page,
  text: string | undefined,
  anchor = 0,
  head = anchor,
) {
  await page.evaluate(
    async ({ text, anchor, head }) => {
      const fixture = await import("/tests/editor-insertion-fixture.ts");
      fixture.updateEditor(text, anchor, head);
    },
    { text, anchor, head },
  );
}

async function startImageImport(page: Page) {
  await page.locator("#image-picker").setInputFiles({
    name: "pic.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingImages.length))
    .toBe(1);
}

async function finishImageImport(page: Page) {
  await page.evaluate(() =>
    (window as any).pendingImages.shift()("assets/pic.png"),
  );
}

async function openIconPicker(page: Page) {
  await page.route("https://api.iconify.design/search?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ icons: ["lucide:home"] }),
    }),
  );
  await page.route("https://api.iconify.design/**.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" />',
    }),
  );
  await page.getByRole("button", { name: "在线选择图标", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索图标" }).fill("home");
  await expect(
    page.getByRole("button", { name: "插入 :lucide-home:" }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((original) => {
    localStorage.removeItem("znote:preferences");
    const appWindow = window as any;
    appWindow.isTauri = true;
    appWindow.pendingImages = [];
    let callback = 0;
    appWindow.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string) => {
        if (command === "read_file")
          return {
            path: "D:/notes/note.md",
            name: "note.md",
            text: original,
            hash: "same",
            bom: false,
            eol: "LF",
          };
        if (command === "read_recovery")
          return [
            {
              path: "D:/notes/note.md",
              name: "note.md",
              text: original,
              base: original,
              hash: "same",
              dirty: false,
              bom: false,
              eol: "LF",
            },
          ];
        if (command === "file_hash") return "same";
        if (command === "renderer_info")
          return { versions: { zensical: "test" } };
        if (command === "import_image")
          return new Promise((resolve) =>
            appWindow.pendingImages.push(resolve),
          );
        return null;
      },
    };
  }, original);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(activeContent(page)).toHaveText(original);
  await updateEditor(page, undefined, 5, 0);
});

test("image import keeps the original selection when only the cursor moves", async ({
  page,
}) => {
  await startImageImport(page);
  await updateEditor(page, undefined, original.length);
  await finishImageImport(page);
  await expect(activeContent(page)).toHaveText(`${imageMarkdown} beta`);
  await page.keyboard.press("Control+z");
  await expect(activeContent(page)).toHaveText(original);
});

test("image import does not replace text after the document changes", async ({
  page,
}) => {
  await startImageImport(page);
  await updateEditor(page, "changed source", 14);
  await finishImageImport(page);
  await expect(page.locator("#toasts")).toContainText(
    "笔记已变化，请重新插入。",
  );
  await expect(activeContent(page)).toHaveText("changed source");
});

test("image import ends quietly after the target editor is closed", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await startImageImport(page);
  await activeContent(page).focus();
  await page.keyboard.press("Control+w");
  await expect(page.locator("#start-page")).toBeVisible();
  await finishImageImport(page);
  await page.locator(".sidebar-add").click();
  await expect(activeContent(page)).not.toContainText(imageMarkdown);
  await expect(page.locator("#toasts")).not.toContainText("笔记已变化");
  expect(errors).toEqual([]);
});

test("icon picker keeps the original selection when only the cursor moves", async ({
  page,
}) => {
  await openIconPicker(page);
  await updateEditor(page, undefined, original.length);
  await page.getByRole("button", { name: "插入 :lucide-home:" }).click();
  await expect(activeContent(page)).toHaveText(":lucide-home: beta");
});

test("icon picker refuses a changed document without restoring stale positions", async ({
  page,
}) => {
  await openIconPicker(page);
  await updateEditor(page, "x", 1);
  await page.getByRole("button", { name: "插入 :lucide-home:" }).click();
  await expect(page.locator("#toasts")).toContainText(
    "笔记已变化，请重新插入。",
  );
  await expect(activeContent(page)).toHaveText("x");
  await page.keyboard.press("Escape");
  await expect(activeContent(page)).toHaveText("x");
});

test("cards keep the original selection when only the cursor moves", async ({
  page,
}) => {
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await updateEditor(page, undefined, original.length);
  await page.getByRole("button", { name: "插入卡片", exact: true }).click();
  const text = await activeContent(page).innerText();
  expect(text).toContain("    alpha");
  expect(text).toMatch(/<\/div>\s+beta$/);
  await page.keyboard.press("Control+z");
  await expect(activeContent(page)).toHaveText(original);
});

test("cards refuse a changed document and cancellation leaves the new selection intact", async ({
  page,
}) => {
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await updateEditor(page, "x", 1);
  await page.getByRole("button", { name: "插入卡片", exact: true }).click();
  await expect(page.locator(".cards-error")).toHaveText(
    "笔记已变化，请重新插入。",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(activeContent(page)).toHaveText("x");
});
