import { test, expect } from "@playwright/test";
import { appThemes } from "../src/app-themes";

test("theme bindings persist independently and follow system and toolbar mode changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.locator('[data-action="settings"]').first().click();
  await expect(page.getByRole("radio", { name: "纸白", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "墨绿", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "晴海", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "ocean");
  await page.getByRole("radio", { name: "石墨", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "ocean");
  await page.locator("#theme-choice").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "graphite");
  await page.locator("#theme-choice").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "ocean");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "graphite");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "graphite");
  await page.locator('[data-action="settings"]').first().click();
  await expect(page.locator("#theme-choice")).toHaveValue("system");
  await expect(page.getByRole("radio", { name: "晴海", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "石墨", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.locator('[data-action="theme"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "ocean");
});

test("all built-in palettes update chrome, source editor and mounted reading preview", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.locator(".sidebar-add").click();
  await page.locator('[data-action="settings"]').first().click();
  const frame = page.frameLocator("#settings-preview iframe");
  await page.locator('[data-settings-tab="reading"]').click();
  await expect(frame.locator("article h1")).toBeVisible();
  await frame.locator("article").evaluate(article => { article.dataset.themeTest = "retained"; });
  await page.locator('[data-settings-tab="appearance"]').click();
  let lightEditorClasses = "";
  for (const mode of ["light", "dark"] as const) {
    await page.locator("#theme-choice").selectOption(mode);
    const editor = page.locator(".tab-editor:not([hidden]) .cm-editor");
    if (mode === "light") lightEditorClasses = (await editor.getAttribute("class"))!;
    else await expect(editor).not.toHaveAttribute("class", lightEditorClasses);
    for (const theme of appThemes) {
      await page.getByRole("radio", { name: theme[mode].name, exact: true }).check();
      await expect(page.locator("html")).toHaveAttribute("data-theme-style", theme.id);
      const expectedColor = (hex: string) => `rgb(${hex.slice(1).match(/../g)!.map(value => parseInt(value, 16)).join(", ")})`;
      await expect(page.locator(".sidebar")).toHaveCSS("background-color", expectedColor(theme[mode].tokens.sidebar));
      await expect(page.locator(".tab-editor:not([hidden]) .cm-editor")).toHaveCSS("color", expectedColor(theme[mode].tokens.text));
      await expect(frame.locator("body")).toHaveCSS("background-color", expectedColor(theme[mode].tokens.paper));
      await expect(frame.locator("article")).toHaveAttribute("data-theme-test", "retained");
      await expect(frame.locator(".znote-render-scope")).toHaveAttribute("data-md-color-scheme", mode === "dark" ? "slate" : "default");
    }
  }
  expect(errors).toEqual([]);
});

test("old dark-mode preferences keep the original ink-green theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("znote:preferences", JSON.stringify({ theme: "dark" })));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "forest");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(32, 41, 35)");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("znote:preferences")!).themeBindings)).toEqual({ light: "forest", dark: "forest" });
});
