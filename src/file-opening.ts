import type { Mode } from "./types";
import { tr } from "./i18n";
export interface FileOpeningPreferences {
  mode: Mode | "last";
  focus: boolean;
  target: "current" | "new";
  startup: "home" | "restore";
}
export function normalizeFileOpening(value: unknown): FileOpeningPreferences {
  const stored = value && typeof value === "object" ? value as Partial<FileOpeningPreferences> : {};
  return {
    mode: ["source", "split", "read", "last"].includes(stored.mode ?? "") ? stored.mode! : "read",
    focus: stored.focus === true,
    target: stored.target === "current" ? "current" : "new",
    startup: stored.startup === "home" ? "home" : "restore",
  };
}
export interface OpenTicket { id: number; source: "system" | "internal"; initial: boolean; }
export function openRequestPolicy(ticket: OpenTicket, prefs: FileOpeningPreferences, last: Mode) {
  const external = ticket.source === "system";
  return {
    newWindow: !ticket.initial && (prefs.target === "new" || !external),
    mode: external && prefs.mode !== "last" ? prefs.mode : last,
    focus: external ? prefs.focus : false,
  };
}
export function fileOpeningMarkup(prefs: FileOpeningPreferences) {
  return `<div class="settings-section"><h3>${tr("从系统打开文件")}</h3><p class="muted">${tr("通过 Windows 打开方式或双击 Markdown 文件时，直接使用以下界面。")}</p><div class="setting-row"><label for="external-open-mode">${tr("打开后的显示模式")}</label><select id="external-open-mode"><option value="source">${tr("编辑")}</option><option value="split">${tr("对照")}</option><option value="read">${tr("阅读")}</option><option value="last">${tr("跟随上次使用")}</option></select></div><label class="setting-row"><span>${tr("打开时启用专注模式")}<small>${tr("隐藏侧栏与工具栏，保留退出专注和编辑入口。")}</small></span><input id="external-open-focus" type="checkbox" ${prefs.focus ? "checked" : ""}></label><div class="setting-row"><label for="external-open-target">${tr("软件运行时打开位置")}</label><select id="external-open-target"><option value="new">${tr("新窗口")}</option><option value="current">${tr("当前窗口")}</option></select></div><p class="muted">${tr("当前窗口的显示模式会一起切换；新窗口适合独立阅读。临时切换不会修改此预设。")}</p><button id="default-apps">${tr("前往 Windows 默认应用设置")}</button></div><div class="settings-section"><h3>${tr("直接启动软件")}</h3><div class="setting-row"><label for="startup-behavior">${tr("启动行为")}</label><select id="startup-behavior"><option value="home">${tr("显示起始页")}</option><option value="restore">${tr("恢复上次工作")}</option></select></div><p class="muted">${tr("外部打开文件时不恢复其他工作区和草稿。起始页启动时也会保留恢复草稿，可手动恢复。")}</p><button id="restore-drafts">${tr("恢复保存的草稿")}</button></div>`;
}
