import { test, expect } from "@playwright/test";
import { appThemes } from "../src/app-themes";

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
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    window.editor.setColorMode("dark");
  });
  await page.keyboard.press("Control+z");
  expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe(source);
  await page.evaluate(pos => window.editor.jump(pos), source.length);
  await page.keyboard.type("!");
  expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe(source + "!");
});

test("mouse drag selects source text across lines", async ({ page }) => {
  const source = "alpha beta gamma\nsecond line here\nthird line";
  await page.evaluate(text => window.loadNote(text), source);
  const { start, end } = await page.evaluate(() => {
    const view = window.editor.view;
    return { start: view.coordsAtPos(6), end: view.coordsAtPos(view.state.doc.line(2).from + 6) };
  });
  if (!start || !end) throw new Error("Editor lines are not visible");
  await page.mouse.move(start.left, (start.top + start.bottom) / 2);
  await page.mouse.down();
  await page.mouse.move(end.left, (end.top + end.bottom) / 2, { steps: 12 });
  await page.mouse.up();
  const selected = await page.evaluate(() => {
    const view = window.editor.view;
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  });
  expect(selected).toContain("beta gamma\nsecond");
  await expect(page.locator(".cm-selectionBackground")).not.toHaveCount(0);
});

for (const mode of ["source", "split"] as const) {
  test(`${mode} selections stay inside text boundaries after wrapping and resizing`, async ({ page }) => {
    const source = `alpha beta\n  indented 中文 😀\n\n\tthird line\n${"wrapped 中文 text ".repeat(45)}\nlast line`;
    await page.evaluate(({ mode, source }) => {
      document.querySelector<HTMLElement>(".writing-area")!.dataset.mode = mode;
      window.loadNote(source);
      const view = window.editor.view;
      view.dispatch({ selection: { anchor: 2, head: view.state.doc.length - 3 } });
      view.focus();
    }, { mode, source });
    for (const width of [1440, 1100, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => {
        const view = window.editor.view;
        const content = view.contentDOM.getBoundingClientRect();
        const lineStyle = getComputedStyle(view.contentDOM.querySelector(".cm-line")!);
        const left = view.coordsAtPos(view.state.doc.line(2).from)!.left;
        const right = content.right - parseFloat(lineStyle.paddingRight);
        const rects = Array.from(view.dom.querySelectorAll(".cm-selectionBackground"), el => el.getBoundingClientRect());
        return rects.length > 0 && rects.every(rect => rect.left >= left - 1 && rect.right <= right + 1)
          && Math.abs(Math.min(...rects.map(rect => rect.left)) - left) < 1;
      })).toBe(true);
    }
    // Reversing the selection must keep the same geometry and source text.
    await page.evaluate(() => {
      const view = window.editor.view;
      view.dispatch({ selection: { anchor: view.state.doc.length - 3, head: 2 } });
    });
    await expect.poll(() => page.evaluate(() => {
      const view = window.editor.view;
      const left = view.coordsAtPos(view.state.doc.line(2).from)!.left;
      return Math.abs(Math.min(...Array.from(view.dom.querySelectorAll(".cm-selectionBackground"), el => el.getBoundingClientRect().left)) - left);
    })).toBeLessThan(1);
    expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe(source);
  });
}

test("syntax remains readable on normal, selected and search backgrounds in every palette", async ({ page }) => {
  const source = '# 中文标题\n\n---\n\n[link](https://example.com)\n\n<div class="example">\n<!-- 中文 comment -->\n<style>\n.card { display: none; width: 20px; color: #ffffff; }\n</style>\n</div>';
  await page.evaluate(text => window.loadNote(text), source);
  await expect(page.locator(".zn-syntax-tag").first()).toBeVisible();
  await expect(page.locator(".zn-syntax-keyword").first()).toBeVisible();
  await expect(page.locator(".zn-syntax-selector").first()).toBeVisible();
  await expect(page.locator(".zn-syntax-number").first()).toBeVisible();
  await expect(page.locator(".zn-syntax-string").first()).toBeVisible();
  await expect(page.locator(".zn-syntax-comment").first()).toBeVisible();
  await expect(page.locator(".zn-syntax-meta").first()).toBeVisible();
  await expect(page.locator(".zn-syntax-link").first()).toBeVisible();
  await page.evaluate(() => {
    const view = window.editor.view;
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.focus();
  });
  await expect(page.locator(".cm-selectionBackground").first()).toBeVisible();
  for (const mode of ["light", "dark"] as const) for (const theme of appThemes) {
    await page.evaluate(({ mode, tokens }) => {
      const root = document.documentElement;
      root.dataset.theme = mode;
      for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, value);
      window.editor.setColorMode(mode);
      window.editor.view.focus();
    }, { mode, tokens: theme[mode].tokens });
    expect(await page.evaluate(() => {
      const view = window.editor.view;
      const EditorView = view.constructor as typeof import("@codemirror/view").EditorView;
      return view.state.facet(EditorView.darkTheme);
    })).toBe(mode === "dark");
    const ratios = await page.evaluate(() => {
      const view = window.editor.view;
      const style = getComputedStyle(view.dom);
      const context = document.createElement("canvas").getContext("2d")!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => {
          const c = value / 255;
          return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
        });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      // Resolve custom colors (including color-mix) through actual CSS styles.
      const probe = document.createElement("span");
      view.dom.append(probe);
      const backgrounds: Record<string, string> = {
        paper: style.backgroundColor,
        selected: getComputedStyle(view.dom.querySelector(".cm-selectionBackground")!).backgroundColor,
      };
      for (const [name, value] of Object.entries({
        inactive: "var(--editor-selection-inactive)",
        activeLine: "var(--hover)",
        search: "var(--editor-search-match)",
        searchSelected: "var(--editor-search-selected)",
      })) {
        probe.style.backgroundColor = value;
        backgrounds[name] = getComputedStyle(probe).backgroundColor;
      }
      probe.remove();
      const spans = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('[class*="zn-syntax-"]'));
      const foregrounds = [{ name: "text", color: style.color },
        ...spans.map(span => ({ name: span.className, color: getComputedStyle(span).color }))];
      return foregrounds.flatMap(({ name, color }) => Object.entries(backgrounds).map(([background, value]) => {
        const a = luminance(color), b = luminance(value);
        return { name, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      }));
    });
    for (const result of ratios) {
      expect(result.ratio, `${theme.id}/${mode}/${result.name}/${result.background}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(await page.evaluate(() => window.editor.view.state.doc.toString())).toBe(source);
  expect(await page.evaluate(() => {
    const range = window.editor.view.state.selection.main;
    return { from: range.from, to: range.to };
  })).toEqual({ from: 0, to: source.length });
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
