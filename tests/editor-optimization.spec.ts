import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(".sidebar-add").click();
});

for (const side of ["files", "outline", "search"]) {
  test(`typing once preserves SVG nodes and refreshes toolbar once in ${side}`, async ({
    page,
  }) => {
    await page.locator('button[data-side="' + side + '"]').click();
    await page.evaluate(async () => {
      const f = await import("/tests/editor-insertion-fixture.ts");
      f.updateEditor("# Heading\n\nAlready dirty", 24);
    });
    const result = await page.evaluate(async () =>
      (await import("/tests/editor-optimization-fixture.ts")).measureInput(),
    );
    expect(result.total).toBeGreaterThan(20);
    expect(result).toMatchObject({
      refreshes: 1,
      detached: 0,
      added: 0,
      removed: 0,
    });
  });
}

test("repeated footnotes and references use fresh labels and undo independently", async ({
  page,
}) => {
  for (const action of ["footnote", "reference"]) {
    const base = action === "footnote" ? "note" : "ref";
    const original = `[${base}]: existing`;
    await page.evaluate(
      async (text) =>
        (await import("/tests/editor-insertion-fixture.ts")).updateEditor(
          text,
          text.length,
        ),
      original,
    );
    for (let n = 2; n <= 3; n++) {
      await page.locator('[data-toolbar-menu="more"]').click();
      await page
        .locator(`.editor-toolbar-menu [data-command="${action}"]`)
        .click();
      await expect(page.locator(".cm-content")).toContainText(`${base}-${n}]`);
    }
    await page.keyboard.press("Control+z");
    await expect(page.locator(".cm-content")).not.toContainText(`${base}-3]`);
    await expect(page.locator(".cm-content")).toContainText(`${base}-2]`);
    await page.keyboard.press("Control+z");
    await expect(page.locator(".cm-content")).toHaveText(original);
  }
});

test("disabled renderer extensions are honored by menus and icon shortcut", async ({
  page,
}) => {
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("znote:preferences")!);
    for (const id of ["pymdownx.tasklist", "pymdownx.tilde", "pymdownx.emoji"])
      prefs.render.extensions[id] = false;
    localStorage.setItem("znote:preferences", JSON.stringify(prefs));
  });
  await page.reload();
  await page.locator(".sidebar-add").click();
  await expect(
    page.locator('.editor-toolbar [data-command="icons"]'),
  ).toBeDisabled();
  await page.locator('[data-toolbar-menu="list"]').click();
  await expect(
    page.locator('.editor-toolbar-menu [data-command="task"]'),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator('[data-toolbar-menu="more"]').click();
  await expect(
    page.locator('.editor-toolbar-menu [data-command="strikethrough"]'),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+Shift+e");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("#toasts")).toContainText("pymdownx.emoji");
  await page.locator(".cm-content").click({ button: "right" });
  await expect(
    page.locator(
      '#editor-context-root .editor-context-format [data-context-action="task"]',
    ),
  ).toBeDisabled();
});

test("admonition keyboard back returns to the paragraph menu", async ({
  page,
}) => {
  await page.locator('[data-toolbar-menu="paragraph"]').click();
  await page.getByRole("menuitem", { name: "提示框", exact: true }).click();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.locator('.editor-toolbar-menu [role="menu"]'),
  ).toHaveAttribute("aria-label", "段落");
});

test("a newer selection replaces a pending large format scan", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const f = await import("/tests/editor-insertion-fixture.ts");
    const text = "# Start\n\n" + "**bold**\n\n".repeat(10000);
    f.updateEditor(text, 0, text.length);
    f.updateEditor(undefined, 3);
  });
  await expect(page.locator('[data-toolbar-menu="paragraph"]')).toHaveText(
    "一级标题",
  );
  await expect(
    page.locator('.editor-toolbar [data-command="bold"]'),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".editor-toolbar")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
});

test("large selection format state eventually completes and word counts catch up", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const f = await import("/tests/editor-insertion-fixture.ts");
    const text = "# Start\n\n" + "**bold**\n\n".repeat(3000);
    f.updateEditor(text, 0, text.length);
  });
  await expect(page.locator(".editor-toolbar")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.locator('[data-toolbar-menu="paragraph"]')).toHaveText(
    "混合格式",
  );
  await expect(
    page.locator('.editor-toolbar [data-command="bold"]'),
  ).toHaveAttribute("aria-pressed", "mixed");
  await expect(page.locator("#word-count")).toContainText("3,001");
  await expect(page.locator("#word-count")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
});

test("toolbar teardown removes listeners and popover; icon initialization is idempotent", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const f = await import("/tests/editor-optimization-fixture.ts");
    return {
      lifecycle: f.checkLifecycle(),
      icons: f.checkIconInitialization(),
    };
  });
  expect(result.lifecycle).toEqual({ commands: 1, menusRemoved: 1 });
  expect(result.icons).toEqual({
    same: true,
    accessible: "true",
    custom: true,
    tag: "svg",
  });
});

test("formatting a distant all-bold selection does not stop at a partial syntax tree", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const f = await import("/tests/editor-insertion-fixture.ts");
    const text = "**bold**\n\n".repeat(10000).trim();
    f.updateEditor(text, 0, text.length);
  });
  await expect(
    page.locator('.editor-toolbar [data-command="bold"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".editor-toolbar")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
});
