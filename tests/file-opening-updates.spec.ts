import { test, expect, type Page } from "@playwright/test";

async function desktop(page: Page, options: { initial?: boolean; target?: "new" | "current"; home?: boolean; update?: "new" | "none" | "unpublished" | "error" } = {}) {
  await page.addInitScript(options => {
    const app = window as any;
    const path = "C:\\Notes\\中文 笔记.md";
    const doc = { path, text: "# Note", hash: "original", bom: false, eol: "LF" };
    localStorage.setItem("znote:preferences", JSON.stringify({ mode: "split", lastWorkspace: "C:\\Notes", fileOpening: { mode: "read", focus: true, target: options.target ?? "new", startup: options.home ? "home" : "restore" } }));
    let pending = options.initial ? [{ id: 0, initial: true, source: "system" }] : [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const events = new Map<string, number>();
    let callbackId = 0;
    app.isTauri = true; app.calls = [];
    app.emitOpen = () => {
      pending.push({ id: 1, initial: false, source: "system" });
      callbacks.get(events.get("open-requests-ready")!)?.({ payload: null });
    };
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++callbackId, callback); return callbackId; },
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        app.calls.push({ command, args });
        if (command === "plugin:event|listen") { events.set(args.event, args.handler); return args.handler; }
        if (command === "pending_open_requests") { const tickets = pending; pending = []; return tickets; }
        if (command === "complete_open_request") return { documents: args.newWindow ? [] : [doc], errors: [] };
        if (command === "read_recovery") return [];
        if (command === "restore_workspace") return { root: "C:\\Notes", name: "Notes", truncated: false, entries: [] };
        if (command === "list_recent_files") return [];
        if (command === "choose_file") return doc;
        if (command === "renderer_info") return { versions: { zensical: "test" } };
        if (command === "file_hash") return "original";
        if (command === "render_markdown") return { html: "<h1>Note</h1>", toc: [], meta: {}, warnings: [] };
        if (command === "check_for_updates") {
          if (options.update === "error") throw new Error("offline");
          return { currentVersion: "0.5.1", latestVersion: "0.6.0", available: options.update === "new", published: options.update !== "unpublished", title: "ZNote 0.6.0", notes: '<script>window.releaseInjected=true</script>\nChanges', url: "https://github.com/weigo6/znote/releases/tag/v0.6.0" };
        }
        return null;
      },
    };
  }, options);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as any).calls.some((call: any) => call.command === "renderer_info"))).toBe(true);
}

test("system startup applies focus reading, skips session restoration, and preserves working preferences", async ({ page }) => {
  await desktop(page, { initial: true });
  await expect(page.locator("body")).toHaveClass(/focus-mode/);
  await expect(page.locator(".writing-area")).toHaveAttribute("data-mode", "read");
  const calls = await page.evaluate(() => (window as any).calls.map((call: any) => call.command));
  expect(calls).not.toContain("restore_workspace"); expect(calls).not.toContain("read_recovery");
  await page.getByRole("button", { name: "切换到编辑", exact: true }).click();
  await expect(page.locator(".writing-area")).toHaveAttribute("data-mode", "source");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("znote:preferences")!).mode)).toBe("split");
  await page.locator('[data-action="focus"]').click();
  await expect(page.locator("body")).not.toHaveClass(/focus-mode/);
});

test("running app receives new requests without replacing dirty contents or duplicating tabs", async ({ page }) => {
  await desktop(page, { target: "current" });
  await page.keyboard.press("Control+o");
  await page.locator(".tab-editor:not([hidden]) .cm-content").fill("Unsaved text");
  await page.evaluate(() => (window as any).emitOpen());
  await expect(page.locator(".writing-area")).toHaveAttribute("data-mode", "read");
  await expect(page.locator("#tabs .tab")).toHaveCount(1);
  await page.locator('[data-action="focus-edit"]').click();
  await expect(page.locator(".tab-editor:not([hidden]) .cm-content")).toHaveText("Unsaved text");
});

test("running app routes independent reading requests into a new window", async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => (window as any).emitOpen());
  await expect.poll(() => page.evaluate(() => (window as any).calls.find((call: any) => call.command === "complete_open_request")?.args)).toEqual({ id: 1, newWindow: true });
  await expect(page.locator("#start-page")).toBeVisible();
  await expect(page.locator("#tabs .tab")).toHaveCount(0);
});

test("home startup preserves recovery snapshots and opening settings persist", async ({ page }) => {
  await desktop(page, { home: true });
  expect(await page.evaluate(() => (window as any).calls.some((call: any) => ["restore_workspace", "read_recovery"].includes(call.command)))).toBe(false);
  await page.locator('[data-action="settings"]').first().click();
  await page.getByRole("tab", { name: "文件打开", exact: true }).click();
  await page.locator("#external-open-mode").selectOption("source");
  await page.locator("#external-open-focus").uncheck();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("znote:preferences")!).fileOpening)).toMatchObject({ mode: "source", focus: false, startup: "home" });
});

for (const state of ["new", "none", "unpublished", "error"] as const) {
  test(`update check handles ${state} and requires an explicit download action`, async ({ page }) => {
    await desktop(page, { update: state });
    await page.locator('[data-action="settings"]').first().click();
    await page.getByRole("tab", { name: "关于与更新", exact: true }).click();
    await page.getByRole("button", { name: "检查更新", exact: true }).click();
    const expected = { new: "发现新版本", none: "当前已是最新", unpublished: "尚无可用", error: "检查失败" };
    await expect(page.locator("#update-status")).toContainText(expected[state]);
    await expect(page.locator("#check-updates")).toBeEnabled();
    expect(await page.evaluate(() => (window as any).releaseInjected)).toBeUndefined();
    if (state === "new") {
      await expect(page.locator("#update-notes")).toContainText("<script>");
      expect(await page.evaluate(() => (window as any).calls.some((call: any) => call.command === "open_url"))).toBe(false);
      await page.locator("#download-update").click();
      await expect.poll(() => page.evaluate(() => (window as any).calls.find((call: any) => call.command === "open_url")?.args.url)).toBe("https://github.com/weigo6/znote/releases/tag/v0.6.0");
    } else await expect(page.locator("#update-details")).toBeHidden();
  });
}
