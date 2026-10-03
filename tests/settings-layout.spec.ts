import { test, expect } from "@playwright/test";

test("settings categories keep navigation fixed and retain drafts and page scroll", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-action="settings"]').first().click();
  await page.getByRole("dialog").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const navigation = page.getByRole("tablist", { name: "设置分类" });
  await expect(navigation.getByRole("tab")).toHaveCount(7);
  await expect(page.getByRole("tabpanel", { name: "外观", exact: true })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "阅读", exact: true })).toBeHidden();
  const sidebar = await navigation.boundingBox();
  const content = page.locator(".settings-content");
  expect(sidebar!.x + sidebar!.width).toBeLessThanOrEqual((await content.boundingBox())!.x);
  const footer = await page.getByRole("button", { name: "完成", exact: true }).boundingBox();

  await page.getByRole("tab", { name: "高级", exact: true }).click();
  const draft = '{"reader":{"preset":"compact"}}';
  await page.locator("#render-config-json").fill(draft);
  await content.evaluate(element => element.scrollTop = 240);
  const scrollTop = await content.evaluate(element => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  expect(await navigation.boundingBox()).toEqual(sidebar);
  expect(await page.getByRole("button", { name: "完成", exact: true }).boundingBox()).toEqual(footer);

  await page.getByRole("tab", { name: "阅读", exact: true }).click();
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0);
  await page.locator('[data-config="reader.preset"]').selectOption("book");
  await page.getByRole("tab", { name: "高级", exact: true }).click();
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(scrollTop);
  await expect(page.locator("#render-config-json")).toHaveValue(draft);
  await page.locator("#config-apply").click();
  await expect(page.locator("#config-error")).toContainText("已应用");
});

test("settings supports keyboard category navigation, focus containment and return", async ({ page }) => {
  await page.goto("/");
  const opener = page.locator('[data-action="settings"]').first();
  await opener.click();
  const first = page.getByRole("tab", { name: "外观", exact: true });
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "阅读", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "阅读", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel", { name: "配置管理", exact: true })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  const done = page.getByRole("button", { name: "完成", exact: true });
  const close = page.locator("#modal-root").getByRole("button", { name: "关闭", exact: true });
  await done.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(done).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("narrow settings keep categories and footer accessible without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 640 });
  await page.goto("/");
  await page.locator('[data-action="settings"]').first().click();
  const navigation = page.getByRole("tablist", { name: "设置分类" });
  await expect(navigation).toHaveAttribute("aria-orientation", "horizontal");
  await page.getByRole("tab", { name: "外观", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel", { name: "配置管理", exact: true })).toBeVisible();
  await page.locator("#profile-name").fill("窄窗口配置");
  await page.locator("#profile-save").click();
  await expect(page.locator("#profile-feedback")).toContainText("已保存");
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const bounds = await page.getByRole("button", { name: "完成", exact: true }).boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
