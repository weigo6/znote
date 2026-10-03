import { test, expect } from "@playwright/test";

test("quick actions group commands, explain unavailable actions and keep search fixed while scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "快速操作", exact: true });
  const search = page.getByRole("combobox", { name: "搜索操作" });
  await expect(search).toBeFocused();
  await expect(dialog.locator('[data-command="save"]')).toBeDisabled();
  await expect(dialog.locator('[data-command="save"]')).toContainText("先打开一篇笔记");
  await expect(dialog.locator('[data-command="reopen-closed"]')).toBeDisabled();
  await expect(dialog.locator('[data-command="close-workspace"]')).toBeDisabled();
  const searchBounds = await search.boundingBox();
  const footerBounds = await dialog.locator(".command-footer").boundingBox();
  await dialog.locator(".command-results").evaluate(element => element.scrollTop = element.scrollHeight);
  expect(await search.boundingBox()).toEqual(searchBounds);
  expect(await dialog.locator(".command-footer").boundingBox()).toEqual(footerBounds);
  await dialog.locator('[data-command-group="界面"]').click();
  await expect(dialog.locator('[data-command="settings"]')).toBeVisible();
  await expect(dialog.locator('[data-command="new"]')).toHaveCount(0);
  await expect(dialog.locator('[data-command-group="界面"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+n");
  await page.keyboard.press("Control+k");
  await expect(dialog.locator('[data-command="save"]')).toBeEnabled();
  await expect(dialog.locator('[data-command="find"]')).toBeEnabled();
});

test("search handles case, multiple words and safe empty results without executing a hidden action", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("znote:preferences", JSON.stringify({ language: "en" })));
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const search = page.locator("#command-query");
  await search.fill("   OPEN   NOTE  ");
  await expect(page.locator('[data-command="open"]')).toBeVisible();
  await expect(page.locator('[data-command="settings"]')).toHaveCount(0);
  await search.fill('<img src=x onerror="alert(1)">');
  await expect(page.locator(".command-empty")).toContainText("No matching actions");
  await expect(page.locator("#command-count")).toHaveText("0 available actions");
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".command-palette")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await search.fill("设置");
  await expect(page.locator('[data-command="settings"]')).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.locator(".command-palette")).toHaveCount(0);
});

test("arrow navigation skips unavailable commands, wraps and executes the selected action", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const search = page.locator("#command-query");
  await expect(search).toHaveAttribute("aria-activedescendant", "command-new");
  await page.keyboard.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", "command-open");
  await page.keyboard.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", "command-folder");
  await page.keyboard.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", "command-welcome");
  await page.keyboard.press("ArrowUp");
  await expect(search).toHaveAttribute("aria-activedescendant", "command-folder");
  await search.fill("新建");
  await page.keyboard.press("ArrowUp");
  await expect(search).toHaveAttribute("aria-activedescendant", "command-new");
  await page.keyboard.press("Enter");
  await expect(page.locator(".command-palette")).toHaveCount(0);
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator(".cm-content")).toBeFocused();
});

test("the palette contains focus and restores the invoker on Escape, backdrop click and Ctrl+K", async ({ page }) => {
  await page.goto("/");
  const trigger = page.locator('[data-action="commands"]');
  await trigger.click();
  const root = page.locator(".command-palette");
  await root.locator('[data-dismiss]').focus();
  await page.keyboard.press("Shift+Tab");
  await expect(root.locator('[data-command="new"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(root.locator('[data-dismiss]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(30, 30);
  await expect(root).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Control+k");
  await expect(root).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.waitForTimeout(60);
  await expect(trigger).toBeFocused();
});

test("typing with an IME does not execute commands before composition finishes", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").evaluate(input => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".command-palette")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
});

test("global shortcuts close the palette before opening another note", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Control+n");
  await expect(page.locator(".command-palette")).toHaveCount(0);
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await expect(page.locator(".cm-content")).toBeFocused();
});

test("English and dark palettes remain usable in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 650 });
  await page.addInitScript(() => localStorage.setItem("znote:preferences", JSON.stringify({ language: "en", theme: "dark" })));
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const root = page.getByRole("dialog", { name: "Quick actions", exact: true });
  await expect(root).toBeVisible();
  expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(root.locator(".command-footer")).toBeInViewport();
  await root.locator('[data-command-group="界面"]').click();
  await expect(root.locator('[data-command="settings"]')).toBeVisible();
  await root.locator('[data-command="settings"]').click();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
});
