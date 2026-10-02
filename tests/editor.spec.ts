import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/editor.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.editor);
});

test("Markdown syntax stays visible and editable for rules, quotes, and Zensical blocks", async ({ page }) => {
  const source = "# 标题\n\n---\n\n> 引用\n\n!!! note \"提示\"\n\n    内容\n";
  await page.evaluate(text => window.loadNote(text), source);
  await expect(page.locator(".cm-content")).toContainText("---");
  await expect(page.locator(".cm-content")).toContainText("> 引用");
  await expect(page.locator(".cm-content")).toContainText("!!! note");
  await expect(page.locator(".live-block")).toHaveCount(0);
  expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe(source);
});

test("mouse clicks and vertical arrows stay aligned with the source", async ({ page }) => {
  const source = "# Heading\n\nParagraph with **bold text**.\n\n## Second heading\n\nClick this plain paragraph accurately.\n\nLast line.";
  await page.evaluate(text => window.loadNote(text), source);
  const target = page.locator(".cm-line").filter({ hasText: "Click this plain paragraph accurately." });
  await target.click({ position: { x: 50, y: 12 } });
  expect(await page.evaluate(() => {
    const view = window.editor.view;
    return view.state.doc.lineAt(view.state.selection.main.head).text;
  })).toBe("Click this plain paragraph accurately.");
  await page.evaluate(() => window.editor.jump(0));
  const positions: number[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowDown");
    positions.push(await page.evaluate(() => window.editor.view.state.selection.main.head));
  }
  expect(positions.every((pos, i) => i === 0 || pos >= positions[i - 1])).toBe(true);
  expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe(source);
});

test("selection, formatting shortcuts, and undo preserve source fidelity", async ({ page }) => {
  const source = "中文 😀 文字\n\n第二行";
  await page.evaluate(text => window.loadNote(text), source);
  await page.evaluate(() => {
    const view = window.editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
  });
  await page.keyboard.press("Control+b");
  expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe("**中文** 😀 文字\n\n第二行");
  await page.keyboard.press("Control+z");
  expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe(source);
  await page.evaluate(pos => window.editor.jump(pos), source.length);
  await page.keyboard.type("!");
  expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe(source + "!");
});

test("mouse drag selects source text across lines", async ({ page }) => {
  await page.evaluate(text => window.loadNote(text), "alpha beta gamma\nsecond line here\nthird line");
  const first = page.locator(".cm-line").first();
  const second = page.locator(".cm-line").nth(1);
  const start = await first.boundingBox();
  const end = await second.boundingBox();
  if (!start || !end) throw new Error("Editor lines are not visible");
  await page.mouse.move(start.x + 5, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 90, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
  const selected = await page.evaluate(() => {
    const view = window.editor.view;
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  });
  expect(selected).toContain("beta gamma\nsecond");
  await expect(page.locator(".cm-selectionBackground")).not.toHaveCount(0);
});

test("resizing and long documents keep click positions accurate", async ({ page }) => {
  const source = Array.from({ length: 25 }, (_, i) => `## Heading ${i}\n\nParagraph ${i} 中文测试。\n\n`).join("");
  await page.evaluate(text => window.loadNote(text), source);
  await page.setViewportSize({ width: 950, height: 720 });
  await page.evaluate(() => document.documentElement.style.setProperty("--editor-font", "22px"));
  await page.evaluate(pos => window.editor.jump(pos), source.indexOf("Paragraph 23"));
  await page.locator(".cm-line").filter({ hasText: "Paragraph 23 中文测试。" }).click({ position: { x: 56, y: 14 } });
  expect(await page.evaluate(() => {
    const view = window.editor.view;
    return view.state.doc.lineAt(view.state.selection.main.head).text;
  })).toBe("Paragraph 23 中文测试。");
});
