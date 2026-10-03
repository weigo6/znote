import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function desktop(page: Page, options: { deferred?: boolean; recovery?: boolean } = {}) {
  await page.addInitScript(({ deferred, recovery }) => {
    localStorage.setItem("znote:preferences", JSON.stringify({ mode: "split" }));
    const app = window as any;
    const doc = { path: "C:\\Notes\\Settings.md", text: "# A real note", hash: "original", bom: false, eol: "LF" };
    const folder = { root: "C:\\Notes", name: "Notes", entries: [], truncated: false };
    app.isTauri = true;
    app.calls = [];
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        app.calls.push({ command, args });
        if (command === "read_recovery") return recovery ? [{ name: "Recovered.md", text: "My unsaved draft", base: "", dirty: true }] : [];
        if (command === "list_recent_files") return [doc.path];
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command === "open_recent_file" || command === "choose_file" || command === "read_file") return doc;
        if (command === "choose_workspace" || command === "restore_workspace") return folder;
        if (command === "check_file") return { changed: false };
        if (command === "render_markdown") {
          const result = { html: `<p>${args.text}</p>`, toc: [], meta: {}, warnings: [] };
          if (deferred) return new Promise(resolve => { app.finishRender = () => resolve(result); });
          return result;
        }
        return null;
      },
    };
  }, options);
}

test("startup and closing the last note show the start page without creating a file", async ({ page }) => {
  await page.goto("/");
  const home = page.locator("#start-page");
  await expect(home).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await expect(page.locator(".editor-toolbar")).toBeHidden();
  await expect(page.locator(".save-btn")).toBeDisabled();
  for (let cycle = 0; cycle < 2; cycle++) {
    await home.locator('[data-action="new"]').click();
    await expect(home).toBeHidden();
    await expect(page.locator("#tabs .tab")).toHaveCount(1);
    await expect(page.locator(".cm-content")).toBeFocused();
    await expect(page.locator(".cm-content .cm-placeholder")).toBeVisible();
    await page.keyboard.press("Control+w");
    await expect(home).toBeVisible();
    await expect(page.locator("#tabs .tab")).toHaveCount(0);
    await expect(page.locator(".cm-editor")).toHaveCount(0);
    await expect(page.locator("#preview-content")).toBeEmpty();
    await expect(page.locator("#cursor-position")).toBeEmpty();
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("znote:drafts")!))).toEqual([]);
  await page.reload();
  await expect(home).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
});

test("closing other tabs preserves the active note and honors unsaved-note decisions", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+n");
  await page.keyboard.press("Control+n");
  const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.fill("Keep this draft");
  await page.locator("#tabs .tab-close").first().click();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(editor).toHaveText("Keep this draft");
  await page.keyboard.press("Control+w");
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.locator("#start-page")).toBeHidden();
  await expect(editor).toHaveText("Keep this draft");
  await page.locator("#tabs .tab-close").click();
  await page.getByRole("button", { name: "放弃更改", exact: true }).click();
  await expect(page.locator("#start-page")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("znote:drafts")!))).toEqual([]);
});

test("visiting the start page preserves open notes, editor instances and undo history", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+n");
  const editor = page.locator(".tab-editor .cm-content");
  await page.keyboard.type("My note");
  await editor.evaluate(element => element.dataset.startPageTest = "retained");
  await page.locator(".start-toggle").click();
  await expect(page.locator("#start-page")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator('#tabs [aria-selected="true"]')).toHaveCount(0);
  await page.keyboard.press("Control+w");
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await page.locator("#tabs .tab").click();
  await expect(editor).toHaveAttribute("data-start-page-test", "retained");
  await expect(editor).toHaveText("My note");
  await editor.click();
  await page.keyboard.press("Control+z");
  await expect(editor.locator(".cm-placeholder")).toBeVisible();
});

test("recent notes and folder actions use native commands without inserting a welcome tab", async ({ page }) => {
  await desktop(page);
  await page.goto("/");
  await expect(page.locator("#start-recent-list")).toContainText("Settings.md");
  expect(await page.evaluate(() => (window as any).calls.filter((call: any) => call.command === "render_markdown"))).toEqual([]);
  await page.locator('#start-page [data-action="folder"]').click();
  await expect(page.locator("#workspace-name")).toHaveText("Notes");
  await expect(page.locator("#start-page")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
  await page.locator("#start-page [data-recent-file]").click();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator("#tabs .tab")).toContainText("Settings.md");
  await expect(page.frameLocator("#preview-content iframe").locator("article")).toHaveText("# A real note");
  await page.locator("#tabs .tab-close").click();
  await expect(page.locator("#start-page")).toBeVisible();
  await expect(page.locator("#workspace-name")).toHaveText("Notes");
  await expect(page.locator("#preview-content iframe")).toHaveCount(0);
  await page.locator('#start-page [data-action="open"]').click();
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  const commands = await page.evaluate(() => (window as any).calls.map((call: any) => call.command));
  expect(commands).toContain("choose_workspace");
  expect(commands).toContain("open_recent_file");
  expect(commands).toContain("choose_file");
});

test("late preview results cannot reopen content after the last note closes", async ({ page }) => {
  await desktop(page, { deferred: true });
  await page.goto("/");
  await page.locator("#start-page [data-recent-file]").click();
  await page.waitForFunction(() => typeof (window as any).finishRender === "function");
  await page.locator("#tabs .tab-close").click();
  await page.evaluate(() => (window as any).finishRender());
  await expect(page.locator("#start-page")).toBeVisible();
  await expect(page.locator("#preview-content")).toBeEmpty();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
  await expect(page.locator("#preview-warnings")).toBeHidden();
});

test("recovered drafts open directly without adding a default document", async ({ page }) => {
  await desktop(page, { recovery: true });
  await page.goto("/");
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator("#tabs .tab")).toContainText("Recovered.md");
  await expect(page.locator("#start-page")).toBeHidden();
  await expect(page.locator(".cm-content")).toHaveText("My unsaved draft");
});

test("the start page follows language and themes and fits a narrow window", async ({ page }) => {
  await desktop(page);
  await page.goto("/");
  await page.locator('[data-action="settings"]').first().click();
  await page.locator("#language-choice").selectOption("en");
  await page.locator("#theme-choice").selectOption("dark");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("#start-page h1")).toHaveText("A little space for your thoughts.");
  await expect(page.locator("#start-page")).toHaveAttribute("aria-label", "Welcome to ZNote");
  await expect(page.locator("#start-recent-list")).toContainText("Settings.md");
  await page.setViewportSize({ width: 540, height: 750 });
  expect(await page.locator("#start-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const open = page.locator('#start-page [data-action="open"]');
  await open.scrollIntoViewIfNeeded();
  await expect(open).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-action="settings"]').first().click();
  await page.locator("#language-choice").selectOption("zh-CN");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator("#start-page h1")).toHaveText("留一点空间，给你的想法。");
  await expect(page.locator("#start-recent-list")).toContainText("Settings.md");
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
});
