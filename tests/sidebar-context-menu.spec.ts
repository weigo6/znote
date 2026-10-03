import { test, expect, type Page } from "@playwright/test";

test.setTimeout(25000);

const root = "C:\\Notes", folder = root + "\\Projects", note = folder + "\\Plan.md", other = root + "\\设置.md";
async function desktop(page: Page, language = "zh-CN", startup = false) {
  await page.addInitScript(({ root, folder, note, other, language, startup }) => {
    if (!localStorage.getItem("znote:preferences")) localStorage.setItem("znote:preferences", JSON.stringify({ lastWorkspace: root, language, theme: language === "en" ? "dark" : "light", autosave: false }));
    const app = window as any;
    const entry = (path: string, children: any[] = [], directory = false) => ({ path, name: path.split("\\").pop(), directory, children });
    let workspace = { root, name: "Notes", truncated: false, entries: [entry(folder, [entry(note)], true), entry(other)] };
    let docs: Record<string, any> = Object.fromEntries([note, other].map(path => [path, { path, text: "# Original", hash: "original", bom: false, eol: "LF" }]));
    app.isTauri = true; app.calls = []; app.copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { app.copied = text; } } });
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } }, transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        app.calls.push({ command, args });
        if (["restore_workspace", "refresh_workspace", "choose_workspace"].includes(command)) return structuredClone(workspace);
        if (command === "read_recovery") return [];
        if (command === "startup_document") return startup ? docs[note] : null;
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command === "list_recent_files") return Object.keys(docs);
        if (command === "read_file" || command === "open_recent_file") return structuredClone(docs[args.path]);
        if (command === "file_hash") return docs[args.path]?.hash;
        if (command === "render_markdown") return { html: "<h1>Original</h1>", toc: [], meta: {}, warnings: [] };
        const insert = (path: string, directory = false) => {
          const parent = path.slice(0, path.lastIndexOf("\\"));
          const container = workspace.entries.find(entry => entry.path === parent)?.children ?? workspace.entries;
          container.push(entry(path, [], directory));
        };
        if (command === "create_note" || command === "create_folder") {
          const path = (args.parent ?? root) + "\\" + args.name + (command === "create_note" && !/\.md$/.test(args.name) ? ".md" : "");
          insert(path, command === "create_folder");
          if (command === "create_folder") return path;
          return docs[path] = { path, text: "", hash: "created", bom: false, eol: "LF" };
        }
        if (command === "rename_entry") {
          if (app.renameFail) throw "目标名称已存在，请换一个名称。";
          const destination = args.path.slice(0, args.path.lastIndexOf("\\") + 1) + args.name;
          const within = (path: string) => path === args.path || path.startsWith(args.path + "\\");
          const rename = (entries: any[]) => entries.forEach(entry => { if (within(entry.path)) { entry.path = destination + entry.path.slice(args.path.length); entry.name = entry.path.split("\\").pop(); } rename(entry.children); });
          rename(workspace.entries);
          docs = Object.fromEntries(Object.entries(docs).map(([path, doc]) => { const updated = within(path) ? destination + path.slice(args.path.length) : path; return [updated, { ...doc, path: updated }]; }));
          return destination;
        }
        if (command === "duplicate_note") { const path = args.path.replace(/\.md$/, " " + args.suffix + ".md"); insert(path); return docs[path] = { ...docs[args.path], path }; }
        if (command === "trash_entry") {
          if (app.trashFail) throw "无法移入回收站，操作已取消。";
          const keep = (path: string) => !(path === args.path || path.startsWith(args.path + "\\"));
          const remove = (entries: any[]): any[] => entries.filter(entry => keep(entry.path)).map(entry => ({ ...entry, children: remove(entry.children) }));
          workspace.entries = remove(workspace.entries); docs = Object.fromEntries(Object.entries(docs).filter(([path]) => keep(path))); return null;
        }
        if (command === "entry_properties") return { path: args.path, directory: args.path === folder || args.path === root, size: 1234, created: 1700000000, modified: 1700000300 };
        if (command === "save_file") { const payload = args.data; return docs[payload.path] = { ...docs[payload.path], text: payload.text, hash: "saved" }; }
        return null;
      },
    };
  }, { root, folder, note, other, language, startup });
  await page.goto("/"); await expect(page.locator("[data-file]")).toHaveCount(2);
}
// Attribute matching through JS avoids CSS escaping Windows paths.
const file = (page: Page, name = "Plan") => page.locator("#sidebar-content [data-file]").filter({ hasText: name });
async function menu(page: Page, name = "Plan") { await file(page, name).click({ button: "right" }); return page.getByRole("menu", { name: /文件菜单|File menu/ }); }

test("file menu follows grouped actions and right-clicking does not open a note", async ({ page }) => {
  await desktop(page); const popup = await menu(page);
  await expect(popup).toBeVisible(); await expect(page.locator("#tabs .tab")).toHaveCount(0);
  await expect(popup.getByRole("menuitemradio", { name: "文档树", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(await popup.locator("[data-file-action]").evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.fileAction))).toEqual(["open", "window", "new", "folder", "search", "list", "tree", "rename", "duplicate", "trash", "properties", "copy-path", "reveal"]);
  await page.screenshot({ path: "build/qa/sidebar-menu-light.png", animations: "disabled" });
  await popup.getByRole("menuitem", { name: "打开", exact: true }).click();
  await expect(page.locator("#tabs .tab")).toContainText("Plan.md"); await expect(popup).toHaveCount(0);
});

test("folder and blank-area menus create items in the clicked directory and protect the root", async ({ page }) => {
  await desktop(page); await page.locator("[data-folder]").click({ button: "right" });
  await expect(page.locator('[data-file-action="duplicate"]')).toHaveCount(0);
  await page.locator('[data-file-action="new"]').click(); await page.locator("#dialog-input").fill("Meeting"); await page.locator("#dialog-submit").click();
  await expect.poll(() => page.evaluate(() => (window as any).calls.find((call: any) => call.command === "create_note")?.args)).toEqual({ name: "Meeting", parent: folder });
  await page.locator("#sidebar-content").click({ button: "right", position: { x: 150, y: 350 } });
  await expect(page.locator('[data-file-action="rename"]')).toHaveCount(0); await expect(page.locator('[data-file-action="trash"]')).toHaveCount(0);
  await page.locator('[data-file-action="folder"]').click(); await page.locator("#dialog-input").fill("Research"); await page.locator("#dialog-submit").click();
  await expect.poll(() => page.evaluate(() => (window as any).calls.find((call: any) => call.command === "create_folder")?.args)).toEqual({ name: "Research", parent: root });
});

test("flat list persists, retains parent labels, and search focuses the file filter", async ({ page }) => {
  await desktop(page); await menu(page); await page.locator('[data-file-action="list"]').click();
  await expect(page.locator("[data-folder]")).toHaveCount(0); await expect(file(page)).toContainText("Projects");
  await page.reload(); await expect(page.locator("[data-folder]")).toHaveCount(0);
  await menu(page); await page.locator('[data-file-action="search"]').click(); await expect(page.locator("#file-filter")).toBeFocused();
  await page.locator("#file-filter").fill("Projects"); await expect(page.locator("[data-file]")).toHaveCount(1);
});

test("renaming a folder preserves dirty editor content and undo, and future saves use its new path", async ({ page }) => {
  await desktop(page); await file(page).click(); const editor = page.locator(".tab-editor:not([hidden]) .cm-content");
  await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" edits");
  await editor.evaluate(element => element.dataset.instance = "kept");
  await page.locator("[data-folder]").click({ button: "right" }); await page.locator('[data-file-action="rename"]').click();
  await page.locator("#dialog-input").fill("Renamed"); await page.locator("#dialog-submit").click();
  await expect(file(page)).toHaveAttribute("data-file", root + "\\Renamed\\Plan.md");
  await expect(editor).toHaveAttribute("data-instance", "kept"); await expect(editor).toContainText("edits");
  await editor.click(); await page.keyboard.press("Control+z"); await expect(editor).not.toContainText("edits");
  await page.keyboard.type(" revised"); await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as any).calls.find((call: any) => call.command === "save_file")?.args.data.path)).toBe(root + "\\Renamed\\Plan.md");
});

test("deletion can be cancelled and failed trash leaves documents intact; success preserves dirty drafts", async ({ page }) => {
  await desktop(page); await file(page).click(); const editor = page.locator(".tab-editor:not([hidden]) .cm-content"); await editor.fill("Keep my unsaved changes");
  await menu(page); await page.locator('[data-file-action="trash"]').click(); await expect(page.getByRole("dialog")).toContainText("未保存的修改将保留为独立草稿");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).calls.some((call: any) => call.command === "trash_entry"))).toBe(false);
  await page.evaluate(() => (window as any).trashFail = true);
  await menu(page); await page.locator('[data-file-action="trash"]').click(); await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await expect(page.locator("#toasts")).toContainText("操作已取消"); await expect(file(page)).toBeVisible(); await expect(editor).toHaveText("Keep my unsaved changes");
  await page.evaluate(() => (window as any).trashFail = false);
  await menu(page); await page.locator('[data-file-action="trash"]').click(); await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await expect(file(page)).toHaveCount(0); await expect(editor).toHaveText("Keep my unsaved changes"); await expect(page.locator("#tabs .tab")).toContainText("保留草稿");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("znote:drafts")!)[0]?.path)).toBeUndefined();
});

test("deleting the last clean note shows the start page and does not reopen it", async ({ page }) => {
  await desktop(page); await file(page).click(); await menu(page); await page.locator('[data-file-action="trash"]').click(); await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await expect(page.locator("#start-page")).toBeVisible(); await expect(page.locator("#tabs .tab")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+t"); await expect(page.locator("#tabs .tab")).toHaveCount(0);
});

test("copy, properties, reveal and new window target the right-clicked file", async ({ page }) => {
  await desktop(page); await menu(page, "设置"); await page.locator('[data-file-action="copy-path"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).copied)).toBe(other);
  await menu(page, "设置"); await page.locator('[data-file-action="properties"]').click(); await expect(page.getByRole("dialog")).toContainText("1,234"); await expect(page.locator(".file-property-path")).toHaveText(other);
  await page.getByRole("button", { name: "完成", exact: true }).click(); await menu(page); await page.locator('[data-file-action="reveal"]').click();
  await menu(page); await page.locator('[data-file-action="window"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).calls.filter((call: any) => ["reveal_entry", "open_in_new_window"].includes(call.command)).map((call: any) => call.args.path))).toEqual([note, note]);
});

test("dirty copy choices cancel safely and can create a copy of the disk version", async ({ page }) => {
  await desktop(page); await file(page).click(); await page.locator(".cm-content").fill("Unsaved draft");
  await menu(page); await page.locator('[data-file-action="duplicate"]').click(); await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).calls.some((call: any) => call.command === "duplicate_note"))).toBe(false);
  await menu(page); await page.locator('[data-file-action="duplicate"]').click(); await page.getByRole("button", { name: "复制磁盘版本", exact: true }).click();
  await expect(page.locator("#tabs .tab")).toHaveCount(2); await expect(page.locator(".tab-editor:not([hidden]) .cm-content")).toHaveText("# Original");
  await page.locator("#tabs .tab").first().click(); await expect(page.locator(".tab-editor:not([hidden]) .cm-content")).toHaveText("Unsaved draft");
});

test("keyboard menu navigates, returns focus and stays inside a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 }); await desktop(page);
  await file(page).focus(); await page.keyboard.press("Shift+F10"); const popup = page.getByRole("menu", { name: "文件菜单" });
  await expect(popup).toBeVisible(); await expect(popup.getByRole("menuitem", { name: "打开", exact: true })).toBeFocused();
  await page.keyboard.press("End"); await expect(page.locator('[data-file-action="reveal"]')).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(page.locator('[data-file-action="open"]')).toBeFocused();
  const rect = await popup.boundingBox(); expect(rect!.y).toBeGreaterThanOrEqual(8); expect(rect!.y + rect!.height).toBeLessThanOrEqual(592);
  await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0); await expect(file(page)).toBeFocused();
  await page.keyboard.press("F2"); await expect(page.getByRole("dialog", { name: "重命名" })).toBeVisible();
});

test("English menu supports language switching without translating filenames; child startup opens the selected note", async ({ page }) => {
  await desktop(page, "en", true); await expect(page.locator("#tabs .tab")).toContainText("Plan.md");
  const popup = await menu(page, "设置"); await expect(popup.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible(); await expect(popup.locator("header")).toHaveText("设置.md");
  await expect(popup.getByRole("menuitem", { name: "Search files", exact: true })).toBeVisible();
  const labels = await popup.locator("button").allTextContents();
  expect(labels.join(" ")).not.toMatch(/\p{Script=Han}/u);
  await page.screenshot({ path: "build/qa/sidebar-menu-dark-en.png", animations: "disabled" });
  await page.keyboard.press("Escape"); await page.locator('[data-action="settings"]').first().click(); await page.locator("#language-choice").selectOption("zh-CN"); await page.getByRole("button", { name: "完成", exact: true }).click();
  await menu(page, "设置"); await expect(page.getByRole("menuitem", { name: "重命名", exact: true })).toBeVisible(); await expect(page.locator(".file-menu-heading")).toHaveText("设置.md");
});
