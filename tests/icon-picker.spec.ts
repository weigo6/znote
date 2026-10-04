import { test, expect } from "@playwright/test";

test("card icon picker fills the selected card and preserves the complete draft", async ({ page }) => {
  let searchUrl = "";
  await page.route("https://api.iconify.design/search?**", route => {
    searchUrl = route.request().url();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ icons: ["mdi:star"] }) });
  });
  await page.route("https://api.iconify.design/**.svg", route => route.fulfill({
    contentType: "image/svg+xml",
    headers: { "access-control-allow-origin": "*" },
    body: '<svg xmlns="http://www.w3.org/2000/svg" />',
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-add").click();
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.insertText("Selected source");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  const cards = page.getByRole("dialog", { name: "网格卡片", exact: true });
  await cards.getByRole("combobox", { name: "卡片数量" }).selectOption("3");
  await cards.getByRole("textbox", { name: "卡片 1 图标" }).fill(":lucide-home:");
  await cards.getByRole("textbox", { name: "卡片 2 标题" }).fill("Favorite");
  await cards.getByRole("textbox", { name: "卡片 2 内容" }).fill("Keep this body");
  await cards.getByRole("textbox", { name: "卡片 2 链接" }).fill("guide.md");
  await cards.getByRole("button", { name: "为卡片 2 选择图标" }).click();
  const picker = page.getByRole("dialog", { name: "在线选择图标" });
  await expect(cards).toHaveCount(0);
  await picker.getByRole("combobox", { name: "筛选图标库" }).selectOption("mdi");
  await picker.getByRole("searchbox", { name: "搜索图标" }).fill("star");
  await picker.getByRole("button", { name: "选择图标 :material-star:" }).click();
  expect(new URL(searchUrl).searchParams.get("prefixes")).toBe("mdi");
  await expect(cards).toBeVisible();
  await expect(cards.getByRole("combobox", { name: "卡片数量" })).toHaveValue("3");
  await expect(cards.getByRole("textbox", { name: "卡片 1 图标" })).toHaveValue(":lucide-home:");
  await expect(cards.getByRole("textbox", { name: "卡片 1 内容" })).toHaveValue("Selected source");
  await expect(cards.getByRole("textbox", { name: "卡片 2 图标" })).toHaveValue(":material-star:");
  await expect(cards.getByRole("textbox", { name: "卡片 2 图标" })).toBeFocused();
  await expect(cards.getByRole("textbox", { name: "卡片 2 标题" })).toHaveValue("Favorite");
  await expect(cards.getByRole("textbox", { name: "卡片 2 内容" })).toHaveValue("Keep this body");
  await expect(cards.getByRole("textbox", { name: "卡片 2 链接" })).toHaveValue("guide.md");
  await expect(content).toHaveText("Selected source");
  await cards.getByRole("combobox", { name: "卡片数量" }).selectOption("1");
  await cards.getByRole("combobox", { name: "卡片数量" }).selectOption("3");
  await expect(cards.getByRole("textbox", { name: "卡片 2 图标" })).toHaveValue(":material-star:");
  await cards.getByRole("button", { name: "插入卡片" }).click();
  await expect(content).toContainText(":material-star: **Favorite**");
  await expect(content).toContainText("[了解更多](guide.md)");
  await page.keyboard.press("Control+z");
  await expect(content).toHaveText("Selected source");
});

test("all picker dismissal paths return to the card draft and cancel restores source selection", async ({ page }) => {
  await page.route("https://api.iconify.design/search?**", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ icons: [] }),
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-add").click();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("Replace this selection");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  const cards = page.getByRole("dialog", { name: "网格卡片", exact: true });
  await cards.getByRole("textbox", { name: "卡片 1 图标" }).fill(":material-heart:");
  await cards.getByRole("textbox", { name: "卡片 1 标题" }).fill("Unsaved title");
  for (const dismiss of ["Escape", "返回卡片编辑", "关闭"]) {
    await cards.getByRole("button", { name: "为卡片 1 选择图标" }).click();
    const picker = page.getByRole("dialog", { name: "在线选择图标" });
    await picker.getByRole("searchbox", { name: "搜索图标" }).fill("star");
    if (dismiss === "Escape") await page.keyboard.press("Escape");
    else await picker.getByRole("button", { name: dismiss, exact: true }).click();
    await expect(cards).toBeVisible();
    await expect(cards.getByRole("textbox", { name: "卡片 1 图标" })).toHaveValue(":material-heart:");
    await expect(cards.getByRole("textbox", { name: "卡片 1 标题" })).toHaveValue("Unsaved title");
  }
  await cards.getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.insertText("Replacement");
  await expect(page.locator(".cm-content")).toHaveText("Replacement");
});

test("opening another modal discards the suspended card dialog", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-add").click();
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await page.getByRole("textbox", { name: "卡片 1 标题" }).fill("Abandoned draft");
  await page.getByRole("button", { name: "为卡片 1 选择图标" }).click();
  await page.keyboard.press("Control+k");
  await expect(page.locator(".command-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "卡片 1 标题" })).toHaveValue("卡片 1");
});

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
