import { test, expect } from "@playwright/test";

test("recent menu groups folders and clears history without changing the current workspace", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("znote:preferences", JSON.stringify({
      recent: ["C:\\Notes\\First", "D:\\Work\\Second"],
    }));
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-more").click();
  const recent = page.locator('[data-action="recent-menu"]');
  const panel = page.locator("#recent-section");
  await recent.hover();
  await expect(panel).toBeVisible();
  await expect(recent).toHaveAttribute("aria-expanded", "true");
  const menuBox = await page.locator("#sidebar-menu").boundingBox();
  const panelBox = await panel.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(menuBox!.x + menuBox!.width + 4);
  const triggerBox = await recent.boundingBox();
  await page.mouse.move(menuBox!.x + menuBox!.width + 3, triggerBox!.y + triggerBox!.height / 2);
  await page.waitForTimeout(120);
  await panel.hover();
  await page.waitForTimeout(250);
  await expect(panel).toBeVisible();
  await expect(page.locator("#recent-folders .recent-item")).toHaveCount(2);
  await expect(page.locator("#recent-folders")).toContainText("First");
  await expect(page.locator("#recent-folders")).toContainText("Second");
  await expect(page.locator('[data-action="reopen-closed"]')).toBeDisabled();

  await page.mouse.move(1000, 100);
  await expect(panel).toBeHidden();
  await recent.hover();
  await expect(panel).toBeVisible();

  await page.locator('[data-action="clear-recent"]').click();
  await expect(page.locator("#recent-folders")).toContainText("暂无最近文件夹");
  await expect(page.locator("#recent-files")).toContainText("暂无最近文件");
  await expect(page.locator("#workspace-name")).toHaveText("选择文件夹");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("znote:preferences")!).recent)).toEqual([]);

  await page.setViewportSize({ width: 420, height: 750 });
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return box!.x + box!.width;
  }).toBeLessThanOrEqual(412);
  expect((await panel.boundingBox())!.x).toBeGreaterThanOrEqual(8);
});
