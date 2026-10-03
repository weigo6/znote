import { test, expect } from "@playwright/test";

test("online icon picker replaces the saved editor selection with a shortcode", async ({ page }) => {
  let searchUrl = "";
  await page.route("https://api.iconify.design/search?**", async (route) => {
    searchUrl = route.request().url();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ icons: ["lucide:home", "mdi:home", "twemoji:sparkles"] }),
    });
  });
  await page.route("https://api.iconify.design/**.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" />',
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-add").click();
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("replace me");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+Shift+e");
  await expect(page.getByRole("dialog", { name: "在线选择图标" })).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索图标" }).fill("home");
  await expect(page.locator(".icon-picker-result")).toHaveCount(2);
  await expect(page.getByRole("option", { name: "Emoji" })).toHaveCount(0);
  await expect(page.locator(".icon-picker-preview img").first()).toHaveAttribute("src", /^data:image\/svg\+xml/);
  expect(new URL(searchUrl).searchParams.get("query")).toBe("home");
  await page.getByRole("button", { name: "插入 :lucide-home:" }).click();
  await expect(content).toHaveText(":lucide-home:");
  await page.keyboard.type("!");
  await expect(content).toHaveText(":lucide-home:!");
});

test("toolbar picker inserts a shortcode and Escape keeps the note untouched", async ({ page }) => {
  await page.route("https://api.iconify.design/search?**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ icons: ["lucide:sparkles"] }) }),
  );
  await page.route("https://api.iconify.design/**.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" />',
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-add").click();
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("note");
  await page.getByRole("button", { name: "在线选择图标" }).click();
  await page.getByRole("searchbox", { name: "搜索图标" }).fill("sparkles");
  await expect(page.getByRole("button", { name: "插入 :lucide-sparkles:" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(content).toHaveText("note");
  await page.getByRole("button", { name: "在线选择图标" }).click();
  await page.getByRole("searchbox", { name: "搜索图标" }).fill("sparkles");
  await page.getByRole("button", { name: "插入 :lucide-sparkles:" }).click();
  await expect(content).toHaveText("note:lucide-sparkles:");
});

test("search keeps existing cards until replacement and keeps a short result row compact", async ({ page }) => {
  let releaseGithub!: () => void;
  let githubRequested!: () => void;
  const githubGate = new Promise<void>((resolve) => { releaseGithub = resolve; });
  const requested = new Promise<void>((resolve) => { githubRequested = resolve; });
  await page.route("https://api.iconify.design/search?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    if (query === "github") {
      githubRequested();
      await githubGate;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ icons: query === "github"
        ? ["fa6-brands:github"]
        : ["lucide:home", "mdi:home", "octicon:home-24"] }),
    });
  });
  await page.route("https://api.iconify.design/**.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" />',
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-add").click();
  await page.getByRole("button", { name: "在线选择图标" }).click();
  const dialog = page.getByRole("dialog", { name: "在线选择图标" });
  const grid = page.locator("#icon-picker-results");
  const cards = page.locator(".icon-picker-result");
  const input = page.getByRole("searchbox", { name: "搜索图标" });

  await input.fill("home");
  await expect(cards).toHaveCount(3);
  const topBefore = (await dialog.boundingBox())!.y;

  await input.fill("github");
  await requested;
  await expect(grid).toHaveAttribute("aria-busy", "true");
  await expect(cards).toHaveCount(3);
  expect((await dialog.boundingBox())!.y).toBeCloseTo(topBefore, 0);

  releaseGithub();
  await expect(cards).toHaveCount(1);
  await expect(grid).toHaveAttribute("aria-busy", "false");
  expect((await cards.first().boundingBox())!.height).toBeLessThan(110);
  expect((await dialog.boundingBox())!.y).toBeCloseTo(topBefore, 0);
});
