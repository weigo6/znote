import { test, expect, type Page } from "@playwright/test";

async function write(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".sidebar-add").click();
});

test("paragraph menu reflects all six levels and uses the same command as keyboard shortcuts", async ({
  page,
}) => {
  await write(page, "## heading");
  const paragraph = page.locator('[data-toolbar-menu="paragraph"]');
  await expect(paragraph).toHaveText("二级标题");
  await paragraph.click();
  const menu = page.locator(".editor-toolbar-menu");
  await expect(
    menu.getByRole("menuitemradio", { name: /二级标题/ }),
  ).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: /六级标题/ }).click();
  await expect(page.locator(".cm-content")).toHaveText("###### heading");
  await expect(paragraph).toHaveText("六级标题");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("## heading");
  await page.keyboard.press("Control+Alt+4");
  await expect(page.locator(".cm-content")).toHaveText("#### heading");
});

test("bold toggles from toolbar and keyboard, with one undo per command", async ({
  page,
}) => {
  await write(page, "中文 😀 text");
  await page.keyboard.press("Control+a");
  const button = page.locator('.editor-toolbar [data-command="bold"]');
  await button.click();
  await expect(page.locator(".cm-content")).toHaveText("**中文 😀 text**");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+b");
  await expect(page.locator(".cm-content")).toHaveText("中文 😀 text");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("**中文 😀 text**");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("中文 😀 text");
});

test("list menu converts nested lists and reflects task state", async ({
  page,
}) => {
  await write(page, "- parent\n  - child\n- [x] done");
  await page.keyboard.press("Control+a");
  await page.locator('[data-toolbar-menu="list"]').click();
  await page
    .locator(".editor-toolbar-menu")
    .getByRole("menuitemradio", { name: "有序列表" })
    .click();
  await expect(page.locator(".cm-content")).toHaveText(
    "1. parent  1. child2. done",
  );
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+End");
  await page.locator('[data-toolbar-menu="list"]').click();
  await expect(
    page.getByRole("menuitemradio", { name: "任务列表" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("Escape and outside click close menus without replacing the saved selection", async ({
  page,
}) => {
  await write(page, "select me");
  await page.keyboard.press("Control+a");
  await page.locator('[data-toolbar-menu="paragraph"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitemradio", { name: /一级标题/ }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "水平分割线" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-toolbar-menu")).toBeHidden();
  await expect(page.locator('[data-toolbar-menu="paragraph"]')).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  // Escape restores source focus and the selected text, so typing replaces it.
  await page.keyboard.insertText("replacement");
  await expect(page.locator(".cm-content")).toHaveText("replacement");
  await page.locator('[data-toolbar-menu="more"]').click();
  await page.locator("#cursor-position").click();
  await expect(page.locator(".editor-toolbar-menu")).toBeHidden();
});

test("cards preserve selection on cancel and insert validated grid markup in one undo", async ({
  page,
}) => {
  await write(page, "Selected body");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "卡片 1 内容" })).toHaveValue(
    "Selected body",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.insertText("New body");
  await expect(page.locator(".cm-content")).toHaveText("New body");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await page
    .getByRole("textbox", { name: "卡片 1 标题" })
    .fill("Getting started");
  await page
    .getByRole("textbox", { name: "卡片 1 图标" })
    .fill(":material-star:");
  await page.getByRole("textbox", { name: "卡片 1 链接" }).fill("guide.md");
  await page.getByRole("button", { name: "插入卡片", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText(
    '<div class="grid cards" markdown>',
  );
  await expect(page.locator(".cm-content")).toContainText(
    ":material-star: **Getting started**",
  );
  await expect(page.locator(".cm-content")).toContainText(
    "[了解更多](guide.md)",
  );
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("New body");
});

test("Material insertion wraps selected content and menus navigate to admonition variants", async ({
  page,
}) => {
  await write(page, "First line\nSecond line");
  await page.keyboard.press("Control+a");
  await page.locator('[data-toolbar-menu="material"]').click();
  await page.getByRole("menuitem", { name: "提示框", exact: true }).click();
  await page.getByRole("menuitem", { name: "技巧", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText('!!! tip "标题"');
  await expect(page.locator(".cm-content")).toContainText("    First line");
  await expect(page.locator(".cm-content")).toContainText("    Second line");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("First lineSecond line");
});

test("narrow editor keeps the three feature entries and reading offers a return to editing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 850 });
  const toolbar = page.locator(".editor-toolbar");
  await expect(toolbar).toHaveAttribute("data-size", "narrow");
  await expect(
    toolbar.getByRole("button", { name: "在线选择图标", exact: true }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "卡片", exact: true }),
  ).toBeVisible();
  await expect(toolbar.locator('[data-toolbar-menu="material"]')).toBeVisible();
  expect(await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await toolbar
    .getByRole("combobox", { name: "编辑模式" })
    .selectOption("read");
  await expect(toolbar.locator(".format-tools")).toBeHidden();
  await toolbar.getByRole("button", { name: "返回编辑" }).click();
  await expect(page.locator(".writing-area")).toHaveAttribute(
    "data-mode",
    "source",
  );
});

for (const { name, text, body } of [
  {
    name: "fenced code",
    text: "```html\n<div>raw</div>\n```",
    body: "<div>raw</div>",
  },
  { name: "HTML", text: "<div>\nraw\n</div>", body: "raw" },
  { name: "front matter", text: "---\ntitle: A\n---", body: "title: A" },
]) {
  test(`toolbar and shortcuts allow formatting inside ${name}`, async ({
    page,
  }) => {
    await write(page, text);
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const content = page.locator(".cm-content");
    const bold = page.locator('.editor-toolbar [data-command="bold"]');
    await expect(bold).toBeEnabled();
    await bold.click();
    await expect
      .poll(() => content.innerText())
      .toBe(text.replace(body, `**${body}**`));
    await page.keyboard.press("Control+z");
    await expect.poll(() => content.innerText()).toBe(text);
    await page.keyboard.press("Control+b");
    await expect
      .poll(() => content.innerText())
      .toBe(text.replace(body, `**${body}**`));
    await page.keyboard.press("Control+z");
    await page.locator('[data-toolbar-menu="paragraph"]').click();
    const heading = page.getByRole("menuitemradio", { name: /二级标题/ });
    await expect(heading).toBeEnabled();
    await heading.click();
    await expect
      .poll(() => content.innerText())
      .toBe(text.replace(body, `## ${body}`));
    await page.keyboard.press("Control+z");
    await expect.poll(() => content.innerText()).toBe(text);
  });
}

test("disabled card extensions are explained and only enabled by clicking the dialog action", async ({
  page,
}) => {
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("znote:preferences") || "{}");
    prefs.render = {
      ...prefs.render,
      extensions: {
        ...prefs.render?.extensions,
        attr_list: false,
        md_in_html: false,
      },
    };
    localStorage.setItem("znote:preferences", JSON.stringify(prefs));
  });
  await page.reload();
  await page.locator(".sidebar-add").click();
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "插入卡片", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".cards-dependencies")).toContainText(
    "attr_list, md_in_html",
  );
  await page.getByRole("button", { name: "启用所需扩展" }).click();
  await expect(
    page.getByRole("button", { name: "插入卡片", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("znote:preferences")!).render.extensions
          .attr_list,
    ),
  ).toBe(true);
});

test("card count preserves fields and invalid links cannot insert source", async ({
  page,
}) => {
  await write(page, "body");
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await page.getByRole("textbox", { name: "卡片 1 标题" }).fill("Saved title");
  await page.getByRole("combobox", { name: "卡片数量" }).selectOption("3");
  await expect(page.getByRole("textbox", { name: "卡片 1 标题" })).toHaveValue(
    "Saved title",
  );
  await page
    .getByRole("textbox", { name: "卡片 1 链接" })
    .fill("javascript:alert(1)");
  await page.getByRole("button", { name: "插入卡片", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveText("body");
  expect(
    await page
      .getByRole("textbox", { name: "卡片 1 链接" })
      .evaluate((el: HTMLInputElement) => el.validity.valid),
  ).toBe(false);
});

test("English dark toolbar adapts to its available width and clamps its menus", async ({
  page,
}) => {
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("znote:preferences") || "{}");
    localStorage.setItem(
      "znote:preferences",
      JSON.stringify({ ...prefs, language: "en", theme: "dark" }),
    );
  });
  await page.reload();
  await page.locator(".sidebar-add").click();
  for (const width of [1280, 1100, 900, 640]) {
    await page.setViewportSize({ width, height: 850 });
    const toolbar = page.locator(".editor-toolbar");
    await expect
      .poll(() => toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await expect(
      toolbar.getByRole("button", { name: "Cards", exact: true }),
    ).toBeVisible();
  }
  await page.locator('[data-toolbar-menu="material"]').click();
  const bounds = await page.locator(".editor-toolbar-menu").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(632);
  await expect(
    page.getByRole("menuitem", { name: "Content tabs", exact: true }),
  ).toBeVisible();
});
