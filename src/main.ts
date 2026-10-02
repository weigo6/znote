import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createIcons,
  FolderOpen,
  FileText,
  Plus,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  X,
  Check,
  Bold,
  Italic,
  Code,
  Link,
  Image,
  List,
  ListTodo,
  Quote,
  Table,
  Columns2,
  BookOpen,
  Code2,
  Sparkles,
  ArrowUpRight,
  Command,
  Sun,
  Moon,
  Focus,
  Save,
  RefreshCw,
  AlertTriangle,
  FilePlus,
  ChevronLeft,
  Folder,
  NotebookPen,
  Hash,
  Download,
  ExternalLink,
  Scissors,
  Copy,
  Clipboard,
  Trash2,
  ListOrdered,
  CheckCircle2,
} from "lucide";
import { openSearchPanel } from "@codemirror/search";
import { NoteEditor, wrap, prefixLines } from "./editor";
import { welcome } from "./sample";
import { headings, wordCount } from "./syntax";
import { escapeHtml } from "./preview";
import { PreviewSurface } from "./preview-surface";
import { normalizeRenderSettings } from "./render-settings";
import { renderSettingsMarkup, mountRenderSettings } from "./render-settings-ui";
import type { RenderSettings } from "./render-settings";
import type { RenderPlan } from "./types";
import type {
  DiskDocument,
  Workspace,
  FileEntry,
  Mode,
  RenderResult,
} from "./types";
import "./style.css";

const iconSet = {
  FolderOpen,
  FileText,
  Plus,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  X,
  Check,
  Bold,
  Italic,
  Code,
  Link,
  Image,
  List,
  ListTodo,
  Quote,
  Table,
  Columns2,
  BookOpen,
  Code2,
  Sparkles,
  ArrowUpRight,
  Command,
  Sun,
  Moon,
  Focus,
  Save,
  RefreshCw,
  AlertTriangle,
  FilePlus,
  ChevronLeft,
  Folder,
  NotebookPen,
  Hash,
  Download,
  ExternalLink,
  Scissors,
  Copy,
  Clipboard,
  Trash2,
  ListOrdered,
  CheckCircle2,
};
const icons = () =>
  createIcons({ icons: iconSet, attrs: { "stroke-width": 1.7 } });
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const native = isTauri();
const previewSurface = new PreviewSurface();
function openEditorSearchPanel(view: NoteEditor["view"]) {
  openSearchPanel(view);
  view.dom.querySelectorAll<HTMLInputElement>(".cm-search input").forEach((input) => {
    input.autocomplete = "off";
  });
}
interface Tab {
  plan?: RenderPlan;
  id: string;
  name: string;
  path?: string;
  text: string;
  revision: number;
  base: string;
  hash: string;
  bom: boolean;
  eol: string;
  dirty: boolean;
  conflict: boolean;
  editor?: NoteEditor;
  host?: HTMLElement;
  saving?: boolean;
}
interface Preferences {
  render: RenderSettings;
  theme: "light" | "dark" | "system";
  fontSize: number;
  autosave: boolean;
  syncPreview: boolean;
  syncEditorScroll: boolean;
  recent: string[];
  lastWorkspace?: string;
  sidebarWidth?: number;
  splitRatio: number;
  mode: Mode;
}
const initial: Preferences = {
  render: normalizeRenderSettings(undefined),
  theme: "light",
  fontSize: 17,
  autosave: false,
  syncPreview: true,
  syncEditorScroll: true,
  recent: [],
  splitRatio: 0.5,
  mode: "source",
};
let prefs: Preferences;
try {
  const stored = JSON.parse(localStorage.getItem("znote:preferences") || "{}");
  prefs = {
    ...initial,
    theme: stored.theme ?? initial.theme,
    fontSize: stored.fontSize ?? initial.fontSize,
    autosave: stored.autosave ?? initial.autosave,
    syncPreview: typeof stored.syncPreview === "boolean" ? stored.syncPreview : initial.syncPreview,
    syncEditorScroll: typeof stored.syncEditorScroll === "boolean" ? stored.syncEditorScroll : initial.syncEditorScroll,
    recent: Array.isArray(stored.recent) ? stored.recent : [],
    lastWorkspace: stored.lastWorkspace,
    sidebarWidth: typeof stored.sidebarWidth === "number" && Number.isFinite(stored.sidebarWidth)
      ? Math.max(180, Math.min(480, stored.sidebarWidth))
      : undefined,
    splitRatio: typeof stored.splitRatio === "number" && Number.isFinite(stored.splitRatio)
      ? Math.max(0, Math.min(1, stored.splitRatio))
      : initial.splitRatio,
    mode: stored.mode ?? initial.mode,
    render: normalizeRenderSettings(stored.render ?? { mathEngine: stored.mathEngine }),
  };
} catch {
  prefs = initial;
}
// Migrate 0.1.x preferences that still point to the removed live editor.
if (!["source", "split", "read"].includes(prefs.mode)) prefs.mode = "source";
let workspace: Workspace | undefined;
let tabs: Tab[] = [],
  activeId = "",
  mode: Mode = prefs.mode,
  side: "files" | "outline" | "search" = "files";
let renderTimer: ReturnType<typeof setTimeout>,
  recoveryTimer: ReturnType<typeof setTimeout>,
  saveTimer: ReturnType<typeof setTimeout>;
let renderGeneration = 0,
  renderedKey = "",
  collapsed = new Set<string>();
let renderInFlight = false;
let queuedRenderGeneration: number | undefined;
let mounted = false,
  restoring = true,
  recoveryQueue = Promise.resolve();
const current = () => tabs.find((t) => t.id === activeId);
const persistPrefs = () =>
  localStorage.setItem("znote:preferences", JSON.stringify(prefs));
function toast(message: string, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.innerHTML =
    icon(error ? "alert-triangle" : "check") +
    `<span>${escapeHtml(message)}</span>`;
  $("#toasts").append(el);
  icons();
  setTimeout(() => el.remove(), error ? 8500 : 3500);
}
function fail(error: unknown) {
  toast(String(error), true);
}
function requireNative() {
  if (!native) {
    toast("请在 ZNote 桌面应用中使用文件和 Python 渲染功能。", true);
    return false;
  }
  return true;
}

$("#app").innerHTML = `
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-nav" role="group" aria-label="导航视图"><button class="activity active" title="笔记文件" aria-label="笔记文件" data-side="files">${icon("notebook-pen")}<span>文件</span></button><button class="activity" title="搜索当前文档" aria-label="搜索当前文档" data-side="search">${icon("search")}<span>搜索</span></button><button class="activity" title="文档大纲" aria-label="文档大纲" data-side="outline">${icon("list")}<span>大纲</span></button></div>
    <div class="filter-wrap"><input id="file-filter" placeholder="筛选文件…" aria-label="筛选笔记文件" autocomplete="off"><input id="document-search" placeholder="搜索当前文档…" aria-label="搜索当前文档" autocomplete="off" hidden></div>
    <nav id="sidebar-content" aria-label="笔记列表"></nav>
    <div class="sidebar-footer"><button class="sidebar-add" data-action="new" title="新建笔记 Ctrl+N" aria-label="新建笔记">${icon("plus")}</button><button class="workspace-switch" data-action="folder" title="打开或切换文件夹">${icon("folder")}<span id="workspace-name">选择文件夹</span></button><button class="icon-btn sidebar-more" data-action="sidebar-menu" title="更多文件操作" aria-label="更多文件操作" aria-expanded="false">${icon("more-horizontal")}</button><span id="engine-label" class="visually-hidden">正在连接渲染器…</span></div>
    <div class="sidebar-menu" id="sidebar-menu" hidden><div class="sidebar-menu-title">文件操作</div><button data-action="new">${icon("plus")}新建笔记</button><button data-action="search">${icon("search")}搜索当前文档</button><button data-action="open">${icon("file-plus")}打开文件</button><button data-action="folder">${icon("folder-open")}打开文件夹</button><button data-action="refresh">${icon("refresh-cw")}刷新文件</button><button data-action="close-workspace">${icon("x")}关闭文件夹</button></div>
    <div class="sidebar-resizer" role="separator" aria-label="调整侧边栏宽度" aria-orientation="vertical" aria-controls="sidebar" title="拖动调整侧边栏宽度"></div>
  </aside>
  <main class="main">
    <div class="tabs-bar"><div id="tabs" role="tablist"></div><button class="icon-btn" data-action="new" title="新建笔记">${icon("plus")}</button><div class="tabs-spacer"></div><button class="icon-btn" data-action="commands" title="快速操作 Ctrl+K" aria-label="快速操作">${icon("command")}</button><button class="icon-btn save-btn" data-action="save" title="保存 Ctrl+S" aria-label="保存">${icon("save")}</button><button class="icon-btn" data-action="settings" title="渲染设置" aria-label="渲染设置">${icon("settings")}</button><div class="focus-mode-controls"><button class="icon-btn" data-action="theme" title="切换明暗主题" aria-label="切换明暗主题">${icon("sun")}</button><button class="icon-btn" data-action="focus" title="专注模式 Ctrl+Shift+F" aria-label="专注模式" aria-pressed="false">${icon("focus")}</button></div></div>
    <div class="editor-toolbar"><div class="format-tools"><button class="icon-btn" data-format="heading" title="标题">H<span>1</span></button><button class="icon-btn" data-format="bold" title="粗体 Ctrl+B">${icon("bold")}</button><button class="icon-btn" data-format="italic" title="斜体 Ctrl+I">${icon("italic")}</button><span class="separator"></span><button class="icon-btn" data-format="quote" title="引用">${icon("quote")}</button><button class="icon-btn" data-format="list" title="列表">${icon("list")}</button><button class="icon-btn" data-format="task" title="任务列表">${icon("list-todo")}</button><button class="icon-btn" data-format="link" title="插入链接">${icon("link")}</button><button class="icon-btn" data-format="image" title="插入图片">${icon("image")}</button><button class="icon-btn" data-format="code" title="代码块">${icon("code")}</button><button class="icon-btn" data-format="table" title="表格">${icon("table")}</button><button class="insert-extension" data-action="insert">${icon("sparkles")}<span>扩展</span></button></div><div class="view-modes" role="group" aria-label="编辑模式"><button data-mode="source" title="Markdown 编辑">${icon("code-2")}<span>编辑</span></button><button data-mode="split" title="Python Markdown 对照预览">${icon("columns-2")}<span>对照</span></button><button data-mode="read" title="阅读模式">${icon("book-open")}<span>阅读</span></button></div></div>
    <div id="conflict-banner" class="banner conflict" hidden></div>
    <div id="workspace-notice" class="banner" hidden></div>
    <div class="writing-area" dir="ltr"><section id="editor-stage" aria-label="编辑区域"></section><div class="split-resizer" role="separator" aria-label="调整编辑区与渲染区宽度" aria-orientation="vertical" aria-controls="editor-stage preview-panel" title="拖动调整编辑区与渲染区宽度"></div><section id="preview-panel"><div id="preview-find" class="preview-find" role="search" aria-label="在预览中查找" hidden><input id="preview-find-input" type="search" autocomplete="off" placeholder="在预览中查找" aria-label="在预览中查找"><span id="preview-find-count" aria-live="polite">0/0</span><button type="button" data-preview-find="previous" title="上一个" aria-label="上一个">${icon("chevron-up")}</button><button type="button" data-preview-find="next" title="下一个" aria-label="下一个">${icon("chevron-down")}</button><button type="button" data-preview-find="close" title="关闭查找" aria-label="关闭查找">${icon("x")}</button></div><div id="preview-warnings" hidden></div><article id="preview-content"></article></section></div>
    <footer class="statusbar"><div><button class="status-sidebar-toggle" data-action="sidebar" title="收起导航 Ctrl+Shift+L" aria-label="收起导航">${icon("panel-left-close")}</button><span id="save-status">${icon("check")}所有更改已保存</span><span id="word-count"></span></div><div><span id="cursor-position"></span><span id="encoding">UTF-8</span><span id="eol">LF</span><button data-action="settings" title="设置渲染配置" id="profile-status">Zensical 默认语法</button></div></footer>
  </main>
  <div id="selection-toolbar" class="selection-toolbar" role="toolbar" aria-label="选中文本操作" hidden><span id="selection-summary"></span><span class="selection-toolbar-divider"></span><button type="button" data-selection-action="copy" title="复制 Ctrl+C" aria-label="复制选中文本">${icon("copy")}</button><button type="button" data-selection-action="bold" title="粗体 Ctrl+B" aria-label="将选中文本设为粗体">${icon("bold")}</button><button type="button" data-selection-action="italic" title="斜体 Ctrl+I" aria-label="将选中文本设为斜体">${icon("italic")}</button><button type="button" data-selection-action="code" title="行内代码" aria-label="将选中文本设为代码">${icon("code")}</button><button type="button" data-selection-action="link" title="插入链接" aria-label="将选中文本设为链接">${icon("link")}</button></div>
  <div id="toasts" aria-live="polite"></div><div id="modal-root"></div><div id="editor-context-root"></div><input id="image-picker" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
`;

const sidebar = $<HTMLElement>("#sidebar");
const sidebarResizer = $<HTMLElement>(".sidebar-resizer");
const sidebarMinWidth = 180;
let sidebarResizePointer: number | null = null;
const sidebarMaxWidth = () =>
  Math.max(sidebarMinWidth, Math.min(480, innerWidth - 480));
const clampSidebarWidth = (width: number) =>
  Math.round(Math.max(sidebarMinWidth, Math.min(width, sidebarMaxWidth())));
function syncSidebarWidth() {
  if (prefs.sidebarWidth === undefined) {
    sidebar.style.removeProperty("--sidebar-width");
  } else {
    sidebar.style.setProperty("--sidebar-width", `${clampSidebarWidth(prefs.sidebarWidth)}px`);
  }
}
function setSidebarWidth(width: number) {
  prefs.sidebarWidth = clampSidebarWidth(width);
  syncSidebarWidth();
}
function finishSidebarResize() {
  if (sidebarResizePointer === null) return;
  if (sidebarResizer.hasPointerCapture(sidebarResizePointer))
    sidebarResizer.releasePointerCapture(sidebarResizePointer);
  sidebarResizePointer = null;
  document.body.classList.remove("sidebar-resizing");
  persistPrefs();
}
sidebarResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || sidebarResizePointer !== null) return;
  sidebarResizePointer = event.pointerId;
  sidebarResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("sidebar-resizing");
  event.preventDefault();
});
sidebarResizer.addEventListener("pointermove", (event) => {
  if (event.pointerId !== sidebarResizePointer) return;
  setSidebarWidth(event.clientX - $("#app").getBoundingClientRect().left);
});
sidebarResizer.addEventListener("pointerup", (event) => {
  if (event.pointerId === sidebarResizePointer) finishSidebarResize();
});
sidebarResizer.addEventListener("pointercancel", (event) => {
  if (event.pointerId === sidebarResizePointer) finishSidebarResize();
});
window.addEventListener("blur", finishSidebarResize);
window.addEventListener("resize", syncSidebarWidth);

const writingArea = $<HTMLElement>(".writing-area");
const splitResizer = $<HTMLElement>(".split-resizer");
const splitMinPaneWidth = 240;
let splitResizePointer: number | null = null;
function splitAvailableWidth() {
  return writingArea.getBoundingClientRect().width;
}
function clampSplitEditorWidth(width: number, available: number) {
  const minPaneWidth = Math.min(splitMinPaneWidth, available / 2);
  return Math.round(Math.max(minPaneWidth, Math.min(width, available - minPaneWidth)));
}
function syncSplitWidth() {
  const available = splitAvailableWidth();
  if (available === 0) return;
  writingArea.style.setProperty(
    "--split-editor-width",
    `${clampSplitEditorWidth(available * prefs.splitRatio, available)}px`,
  );
}
function finishSplitResize() {
  if (splitResizePointer === null) return;
  if (splitResizer.hasPointerCapture(splitResizePointer))
    splitResizer.releasePointerCapture(splitResizePointer);
  splitResizePointer = null;
  document.body.classList.remove("split-resizing");
  persistPrefs();
}
splitResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || splitResizePointer !== null) return;
  splitResizePointer = event.pointerId;
  splitResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("split-resizing");
  event.preventDefault();
});
splitResizer.addEventListener("pointermove", (event) => {
  if (event.pointerId !== splitResizePointer) return;
  const available = splitAvailableWidth();
  if (available === 0) return;
  const width = event.clientX - writingArea.getBoundingClientRect().left;
  prefs.splitRatio = clampSplitEditorWidth(width, available) / available;
  syncSplitWidth();
});
splitResizer.addEventListener("pointerup", (event) => {
  if (event.pointerId === splitResizePointer) finishSplitResize();
});
splitResizer.addEventListener("pointercancel", (event) => {
  if (event.pointerId === splitResizePointer) finishSplitResize();
});
window.addEventListener("blur", finishSplitResize);
new ResizeObserver(syncSplitWidth).observe(writingArea);

function applyPrefs() {
  document.documentElement.dataset.theme =
    prefs.theme === "system"
      ? matchMedia("(prefers-color-scheme:dark)").matches
        ? "dark"
        : "light"
      : prefs.theme;
  document
    .querySelectorAll<HTMLElement>(".znote-render-scope")
    .forEach(
      (el) =>
        (el.dataset.mdColorScheme =
          document.documentElement.dataset.theme === "dark"
            ? "slate"
            : "default"),
    );
  document.documentElement.style.setProperty(
    "--editor-font",
    prefs.fontSize + "px",
  );
  syncSidebarWidth();
  syncSplitWidth();
  const themeButton = document.querySelector<HTMLElement>('[data-action="theme"]');
  if (themeButton) {
    themeButton.innerHTML = icon(document.documentElement.dataset.theme === "dark" ? "moon" : "sun");
    icons();
  }
  persistPrefs();
  renderedKey = "";
  scheduleRender();
}
function closeSidebarMenu() {
  $("#sidebar-menu").hidden = true;
  $(".sidebar-more").setAttribute("aria-expanded", "false");
}
function toggleSidebarMenu() {
  const menu = $("#sidebar-menu");
  menu.hidden = !menu.hidden;
  $(".sidebar-more").setAttribute("aria-expanded", String(!menu.hidden));
  menu.querySelectorAll<HTMLButtonElement>("[data-action='refresh'], [data-action='close-workspace']")
    .forEach((button) => (button.disabled = !workspace));
}
function updatePreviewFind(state: ReturnType<PreviewSurface["find"]>) {
  $("#preview-find-count").textContent = state.count
    ? `${state.index + 1}/${state.count}${state.limited ? "+" : ""}`
    : "0/0";
}
function closePreviewFind() {
  $("#preview-find").hidden = true;
  previewSurface.clearFind();
}
function openPreviewFind() {
  $("#preview-find").hidden = false;
  const input = $<HTMLInputElement>("#preview-find-input");
  updatePreviewFind(previewSurface.find(input.value));
  input.focus();
  input.select();
}
previewSurface.onFindShortcut = openPreviewFind;
function flatten(entries: FileEntry[]): FileEntry[] {
  return entries.flatMap((e) => (e.directory ? flatten(e.children) : [e]));
}
function renderSidebar() {
  const host = $("#sidebar-content");
  const fileFilter = $<HTMLInputElement>("#file-filter");
  const documentSearch = $<HTMLInputElement>("#document-search");
  const query = (side === "search" ? documentSearch.value : fileFilter.value).toLowerCase();
  document
    .querySelectorAll<HTMLElement>("[data-side]")
    .forEach((b) => {
      const active = b.dataset.side === side;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
  $(".sidebar").dataset.side = side;
  host.setAttribute("aria-label", side === "outline" ? "文档大纲" : side === "search" ? "搜索结果" : "笔记列表");
  $(".filter-wrap").classList.toggle("hidden", side === "outline");
  fileFilter.hidden = side !== "files";
  documentSearch.hidden = side !== "search";
  if (side === "outline") {
    const hs = headings(current()?.text || "");
    host.innerHTML = hs.length
      ? hs
          .map(
            (h) =>
              `<button class="outline-item" style="padding-left:${16 + (h.level - 1) * 13}px" data-jump="${h.from}"><span>H${h.level}</span>${escapeHtml(h.text)}</button>`,
          )
          .join("")
      : '<div class="sidebar-empty">添加标题后，<br>在这里浏览文档结构。</div>';
    return;
  }
  if (side === "search") {
    const tab = current();
    if (!query.trim()) {
      host.innerHTML = '<div class="sidebar-empty">输入关键词，搜索当前文档</div>';
      return;
    }
    const results: string[] = [];
    let offset = 0;
    for (const [index, line] of (tab?.text ?? "").split("\n").entries()) {
      const match = line.toLowerCase().indexOf(query.trim());
      if (match >= 0) {
        const start = Math.max(0, match - 60);
        const end = Math.min(line.length, match + query.trim().length + 80);
        const excerpt = `${start ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
        results.push(`<button class="search-result" data-jump="${offset + match}"><strong>第 ${index + 1} 行</strong><span>${escapeHtml(excerpt)}</span></button>`);
        if (results.length >= 200) break;
      }
      offset += line.length + 1;
    }
    host.innerHTML = results.join("") || '<div class="sidebar-empty">当前文档没有匹配内容</div>';
    return;
  }
  if (!workspace) {
    host.innerHTML = `<button class="file-row active" data-action="welcome">${icon("file-text")}<span>欢迎使用 ZNote</span></button><div class="sidebar-empty"><span class="empty-illustration">${icon("folder-open")}</span><p>你的文字，留在本地</p><span>打开笔记文件夹，<br>开始一次专注的写作。</span><button data-action="folder">打开文件夹 ${icon("arrow-up-right")}</button></div>`;
    icons();
    return;
  }
  const row = (e: FileEntry, depth: number): string => {
    const matches =
      !query ||
      e.name.toLowerCase().includes(query) ||
      e.children.some((c) =>
        flatten([c]).some((f) => f.name.toLowerCase().includes(query)),
      );
    if (!matches) return "";
    if (e.directory)
      return `<button class="file-row folder-row" style="padding-left:${12 + depth * 14}px" data-folder="${escapeHtml(e.path)}">${icon(collapsed.has(e.path) ? "chevron-right" : "chevron-down")}${icon("folder")}<span>${escapeHtml(e.name)}</span></button>${!collapsed.has(e.path) || query ? e.children.map((c) => row(c, depth + 1)).join("") : ""}`;
    return `<button class="file-row ${current()?.path === e.path ? "active" : ""}" style="padding-left:${17 + depth * 14}px" data-file="${escapeHtml(e.path)}" title="${escapeHtml(e.path)}">${icon("file-text")}<span>${escapeHtml(e.name.replace(/\.md$/, ""))}</span>${tabs.some((t) => t.path === e.path && t.dirty) ? '<span class="dirty-dot"></span>' : ""}</button>`;
  };
  host.innerHTML =
    workspace.entries.map((e) => row(e, 0)).join("") ||
    '<div class="sidebar-empty">没有匹配的笔记</div>';
  icons();
}
function renderTabs() {
  $("#tabs").innerHTML = tabs
    .map(
      (t) =>
        `<div class="tab ${t.id === activeId ? "active" : ""}" role="tab" aria-selected="${t.id === activeId}" data-tab="${t.id}">${icon("file-text")}<span>${escapeHtml(t.name)}</span>${t.dirty ? '<span class="dirty-dot"></span>' : ""}<button class="tab-close" title="关闭笔记" data-close="${t.id}">${icon("x")}</button></div>`,
    )
    .join("");
  icons();
}
function status() {
  const tab = current();
  if (!tab) return;
  const count = wordCount(tab.text);
  $("#profile-status").textContent = `Markdown · ${tab.plan?.math.engine ?? prefs.render.math.engine}`;
  $("#word-count").textContent =
    `${count.toLocaleString()} 字 · 约 ${Math.max(1, Math.ceil(count / 450))} 分钟阅读`;
  cursorStatus();
  $("#encoding").textContent = tab.bom ? "UTF-8 BOM" : "UTF-8";
  $("#eol").textContent = tab.eol;
  $("#save-status").innerHTML =
    icon(
      tab.conflict ? "alert-triangle" : tab.dirty ? "more-horizontal" : "check",
    ) +
    (tab.saving
      ? "正在保存…"
      : tab.conflict
        ? "检测到外部修改"
        : tab.dirty
          ? "有未保存的更改"
          : tab.path
            ? "所有更改已保存"
            : "本地草稿");
  $("#save-status").classList.toggle("unsaved", tab.dirty);
  icons();
}
function cursorStatus() {
  const state = current()?.editor?.view.state;
  const pos = state?.selection.main.head || 0;
  const line = state?.doc.lineAt(pos);
  const range = state?.selection.main;
  const selected = range && !range.empty
    ? ` · 已选 ${Array.from(state!.sliceDoc(range.from, range.to)).length} 字符`
    : "";
  $("#cursor-position").textContent =
    `行 ${line?.number || 1}，列 ${pos - (line?.from || 0) + 1}${selected}`;
}
function syncPreviewToCursor() {
  const tab = current();
  if (!prefs.syncPreview || mode !== "split" || !tab?.editor || renderedKey !== previewKey(tab) || !previewSurface.followsEditor) return;
  const state = tab.editor.view.state;
  previewSurface.scrollToSource(tab.text, state.doc.lineAt(state.selection.main.head).number, "editor");
}
function syncEditorToPreview(line: number) {
  const tab = current();
  if (!prefs.syncEditorScroll || mode !== "split" || !tab?.editor || renderedKey !== previewKey(tab)) return;
  tab.editor.revealLine(line);
}
function mountTab(tab: Tab) {
  if (tab.editor) return;
  tab.host = document.createElement("div");
  tab.host.className = "tab-editor";
  $("#editor-stage").append(tab.host);
  tab.editor = new NoteEditor(tab.host, tab.text, {
    change: (text) => {
      tab.text = text;
      tab.revision++;
      tab.dirty = text !== tab.base;
      if (tab.id === activeId) {
        renderTabs();
        status();
        if (side === "outline" || side === "search") renderSidebar();
        scheduleRender();
      }
      scheduleRecovery();
      clearTimeout(saveTimer);
      if (prefs.autosave && tab.path && !tab.conflict)
        saveTimer = setTimeout(() => void save(tab, false, true), 1400);
    },
    cursor: () => {
      if (tab.id === activeId) {
        previewSurface.editorIntent();
        cursorStatus();
        syncPreviewToCursor();
        hideSelectionToolbar();
      }
    },
    save: () => void save(tab),
    image: (file) => void insertImage(file, tab),
    command: runEditorContextAction,
  });
}
function activate(id: string) {
  hideSelectionToolbar();
  if (activeId && activeId !== id) closePreviewFind();
  activeId = id;
  const tab = current();
  if (!tab) return;
  mountTab(tab);
  for (const t of tabs) if (t.host) t.host.hidden = t.id !== id;
  renderTabs();
  renderSidebar();
  status();
  showConflict();
  scheduleRender();
  if (native)
    void getCurrentWindow()
      .setTitle(`${tab.name} - ZNote`)
      .catch(() => {});
}
function addTab(doc?: DiskDocument, text = "") {
  const existing = doc && tabs.find((t) => t.path === doc.path);
  if (existing) {
    activate(existing.id);
    return existing;
  }
  const body = (doc?.text ?? text).replace(/\r\n/g, "\n");
  const tab: Tab = {
    id: crypto.randomUUID(),
    name: doc ? doc.path.split(/[\\/]/).pop()! : "未命名.md",
    path: doc?.path,
    text: body,
    revision: 0,
    base: body,
    hash: doc?.hash || "new",
    bom: doc?.bom || false,
    eol: doc?.eol || "LF",
    dirty: false,
    conflict: false,
  };
  tabs.push(tab);
  activate(tab.id);
  scheduleRecovery();
  return tab;
}
function showWelcome() {
  const tab = tabs.find((t) => t.id === "welcome");
  if (tab) {
    activate(tab.id);
    return;
  }
  const t = addTab(undefined, welcome);
  t.id = "welcome";
  t.name = "欢迎使用 ZNote";
  activate(t.id);
  t.editor?.jump(welcome.indexOf("# 让写作"));
}
async function openFile(path?: string) {
  if (!requireNative()) return;
  try {
    const doc = path
      ? await invoke<DiskDocument>("read_file", { path })
      : await invoke<DiskDocument | null>("choose_file");
    if (doc) addTab(doc);
  } catch (e) {
    fail(e);
  }
}
async function setWorkspace(next: Workspace) {
  workspace = next;
  for (const tab of tabs) {
    tab.plan = undefined;
  }
  renderedKey = "";
  prefs.lastWorkspace = next.root;
  prefs.recent = [
    next.root,
    ...prefs.recent.filter((p) => p !== next.root),
  ].slice(0, 7);
  persistPrefs();
  $("#workspace-name").textContent = next.name;
  renderSidebar();
  status();
  if (next.truncated)
    toast("文件列表达到 6000 项上限，请打开更小的笔记文件夹。", true);
  scheduleRender();
}
async function chooseFolder() {
  if (!requireNative()) return;
  try {
    const result = await invoke<Workspace | null>("choose_workspace");
    if (result) await setWorkspace(result);
  } catch (e) {
    fail(e);
  }
}
async function refresh() {
  if (!workspace) return;
  try {
    await setWorkspace(await invoke<Workspace>("refresh_workspace"));
  } catch (e) {
    fail(e);
  }
}
async function newNote() {
  if (!workspace) {
    addTab();
    return;
  }
  const name = await inputDialog(
    "新建笔记",
    "给这篇笔记起个名字",
    "未命名笔记",
  );
  if (!name) return;
  try {
    addTab(await invoke<DiskDocument>("create_note", { name }));
    await refresh();
  } catch (e) {
    fail(e);
  }
}
async function save(
  tab = current(),
  as = false,
  quiet = false,
): Promise<boolean> {
  if (!tab || !requireNative()) return false;
  if (tab.saving) return false;
  if (!as && tab.path && !tab.dirty) return true;
  const snapshot = tab.text;
  tab.saving = true;
  status();
  try {
    const doc =
      as || !tab.path
        ? await invoke<DiskDocument | null>("save_as", {
            text: snapshot,
            name: tab.name.endsWith(".md") ? tab.name : tab.name + ".md",
          })
        : await invoke<DiskDocument>("save_file", {
            data: {
              path: tab.path,
              text: snapshot,
              expectedHash: tab.hash,
              bom: tab.bom,
              eol: tab.eol,
            },
          });
    if (!doc) return false;
    const previousPath = tab.path;
    tab.path = doc.path;
    tab.name = doc.path.split(/[\\/]/).pop()!;
    tab.hash = doc.hash;
    tab.bom = doc.bom;
    tab.eol = doc.eol;
    tab.base = snapshot;
    tab.dirty = tab.text !== snapshot;
    tab.conflict = false;
    renderTabs();
    renderSidebar();
    showConflict();
    if (tab.id === activeId && previousPath !== doc.path) scheduleRender();
    await persistRecovery();
    if (!quiet) toast("笔记已保存");
    return true;
  } catch (e) {
    if (String(e).includes("CONFLICT:")) {
      tab.conflict = true;
      showConflict();
    } else fail(e);
    return false;
  } finally {
    tab.saving = false;
    status();
  }
}
function showConflict() {
  const tab = current();
  const el = $("#conflict-banner");
  el.hidden = !tab?.conflict;
  el.innerHTML = `${icon("alert-triangle")}<span>磁盘上的文件已改变。当前编辑内容仍然保留。</span><button data-action="external">查看外部版本</button><button data-action="saveas">另存为</button>`;
  icons();
}
async function showExternal() {
  const tab = current();
  if (!tab?.path) return;
  try {
    const doc = await invoke<DiskDocument>("read_file", { path: tab.path });
    modal(
      "检测到外部修改",
      `<p>左侧编辑内容未被替换。下面是磁盘上的版本；可以复制后合并，或明确重新加载。</p><textarea class="external-text" readonly>${escapeHtml(doc.text)}</textarea><div class="modal-actions"><button data-dismiss>保留当前编辑</button><button id="reload-external" class="primary">使用磁盘版本</button></div>`,
    );
    $("#reload-external").onclick = async () => {
      const result = await confirmDialog(
        "重新加载磁盘版本？",
        "当前未保存的修改会被替换。建议先另存为保留副本。",
        "重新加载",
      );
      if (!result) return;
      tab.editor?.destroy();
      tab.host?.remove();
      tab.editor = undefined;
      tab.text = doc.text.replace(/\r\n/g, "\n");
      tab.revision++;
      tab.base = tab.text;
      tab.hash = doc.hash;
      tab.bom = doc.bom;
      tab.eol = doc.eol;
      tab.dirty = false;
      tab.conflict = false;
      activate(tab.id);
      scheduleRecovery();
    };
  } catch (e) {
    fail(e);
  }
}
async function closeTab(id: string) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.dirty) {
    const result = await decisionDialog(
      "保存更改？",
      `「${tab.name}」还有未保存的内容。`,
      [
        { id: "save", label: "保存并关闭", primary: true },
        { id: "discard", label: "放弃更改" },
        { id: "cancel", label: "继续编辑" },
      ],
    );
    if (result === "save") {
      if (!(await save(tab))) return;
    } else if (result !== "discard") return;
  }
  tab.editor?.destroy();
  tab.host?.remove();
  tabs = tabs.filter((t) => t.id !== id);
  if (!tabs.length) showWelcome();
  else if (activeId === id) activate(tabs[tabs.length - 1].id);
  else renderTabs();
  await persistRecovery();
}
function recoveryData() {
  return tabs
    .filter(
      (t) =>
        t.dirty ||
        (t.path && t.id !== "welcome") ||
        (!t.path && t.text && t.id !== "welcome"),
    )
    .map((t) => ({
      id: t.id,
      path: t.path,
      name: t.name,
      text: t.text,
      base: t.base,
      hash: t.hash,
      bom: t.bom,
      eol: t.eol,
      dirty: t.dirty,
    }));
}
function scheduleRecovery() {
  if (restoring) return;
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => void persistRecovery(), 650);
}
function persistRecovery() {
  if (restoring) return recoveryQueue;
  const docs = recoveryData();
  try {
    localStorage.setItem("znote:drafts", JSON.stringify(docs));
  } catch {
    toast("本地草稿缓存空间不足，请及时保存。", true);
  }
  if (native) {
    recoveryQueue = recoveryQueue
      .catch(() => {})
      .then(() => invoke<void>("write_recovery", { documents: docs }))
      .catch((e) => fail("恢复快照写入失败：" + e));
  }
  return recoveryQueue;
}
async function restoreDrafts() {
  let saved: any[] = [];
  try {
    saved = native
      ? await invoke<any[]>("read_recovery")
      : JSON.parse(localStorage.getItem("znote:drafts") || "[]");
  } catch {}
  if (!Array.isArray(saved) || !saved.length) return;
  let recovered = 0;
  for (const item of saved.slice(0, 20)) {
    if (typeof item.text !== "string") continue;
    if (item.path) {
      try {
        const doc = await invoke<DiskDocument>("read_file", {
          path: item.path,
        });
        const tab = addTab(doc);
        if (item.dirty) {
          tab.editor?.destroy();
          tab.host?.remove();
          tab.editor = undefined;
          tab.text = item.text;
          tab.revision++;
          tab.base = item.base;
          tab.hash = item.hash;
          tab.dirty = true;
          tab.conflict = doc.hash !== item.hash;
          activate(tab.id);
          recovered++;
        }
      } catch {
        if (item.dirty) {
          const tab = addTab(undefined, item.text);
          tab.name = item.name + "（恢复副本）";
          tab.dirty = true;
          recovered++;
        }
      }
    } else {
      const tab = addTab(undefined, item.text);
      tab.name = item.name;
      tab.dirty = !!item.dirty;
      recovered++;
    }
  }
  if (recovered) toast(`已恢复 ${recovered} 篇本地草稿`);
}
function setMode(value: Mode) {
  if (mode === value && $(".writing-area").dataset.mode === value) return;
  hideSelectionToolbar();
  if (value === "source") closePreviewFind();
  mode = value;
  prefs.mode = value;
  persistPrefs();
  document
    .querySelectorAll<HTMLElement>("[data-mode]")
    .forEach((el) => el.classList.toggle("active", el.dataset.mode === value));
  $(".writing-area").dataset.mode = value;
  scheduleRender();
  if (value === "split") requestAnimationFrame(syncPreviewToCursor);
}
let renderSettingsRevision = 0;
function previewKey(tab: Tab) {
  return JSON.stringify([
    tab.id,
    tab.revision,
    renderSettingsRevision,
    tab.path,
  ]);
}
function scheduleRender() {
  clearTimeout(renderTimer);
  const generation = ++renderGeneration;
  previewSurface.cancel();
  const tab = current();
  const key = tab && previewKey(tab);
  if ((mode === "split" || mode === "read") && key && key !== renderedKey)
    renderTimer = setTimeout(() => void renderPreview(generation), 150);
}
async function renderPreview(generation: number) {
  if (generation !== renderGeneration) return;
  if (renderInFlight) {
    queuedRenderGeneration = generation;
    return;
  }
  renderInFlight = true;
  try {
    await renderPreviewNow(generation);
  } finally {
    renderInFlight = false;
    const queued = queuedRenderGeneration;
    queuedRenderGeneration = undefined;
    if (queued !== undefined && queued === renderGeneration)
      void renderPreview(queued);
  }
}
async function renderPreviewNow(generation: number) {
  const tab = current();
  if (!tab) return;
  const key = previewKey(tab);
  const source = tab.text;
  if (!native) {
    $("#preview-content").innerHTML =
      '<p class="empty-state">请在桌面应用中查看 Python Markdown 预览。</p>';
    renderedKey = key;
    return;
  }
  try {
    const result = await invoke<RenderResult>("render_markdown", {
      text: source,
      path: tab.path || null,
      settings: prefs.render,
    });
    if (generation !== renderGeneration || tab.id !== activeId) return;
    tab.plan = result.plan;
    const runtimeWarnings: string[] = [];
    await previewSurface.render(
      $("#preview-content"),
      result,
      tab.path,
      (message) => runtimeWarnings.push(message),
      { source, documentId: tab.id, onCommit: () => {
        if (generation !== renderGeneration || tab.id !== activeId) return;
        renderedKey = key;
        previewSurface.setScrollSync(source, syncEditorToPreview);
        syncPreviewToCursor();
      } },
    );
    if (generation !== renderGeneration || tab.id !== activeId) return;
    if (!$("#preview-find").hidden) updatePreviewFind(previewSurface.getFindState());
    result.warnings.push(...runtimeWarnings);
    renderedKey = key;
    previewSurface.setScrollSync(tab.text, syncEditorToPreview);
    syncPreviewToCursor();
    $("#profile-status").textContent =
      `${result.profile} · ${result.plan?.math.engine ?? "katex"}`;
    const warnings = $("#preview-warnings");
    warnings.hidden = !result.warnings.length;
    warnings.textContent = result.warnings.join(" ");
  } catch (e) {
    if (generation !== renderGeneration) return;
    if (!$("#preview-content").querySelector("iframe"))
      $("#preview-content").innerHTML =
        '<p class="empty-state">本次预览未生成，原文仍可继续编辑。</p>';
    $("#preview-warnings").hidden = false;
    $("#preview-warnings").textContent = String(e);
  }
}
async function insertImage(file: File, tab = current()) {
  if (!tab) return;
  if (!tab.path) {
    toast("请先保存笔记，再插入图片。", true);
    return;
  }
  try {
    const extension = file.type.split("/")[1].replace("jpeg", "jpg");
    const relative = await invoke<string>("import_image", {
      document: tab.path,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
      extension,
    });
    tab.editor?.insert(`![${file.name.replace(/[\[\]]/g, "")}](${relative})`);
  } catch (e) {
    fail(e);
  }
}

function modal(title: string, body: string) {
  $("#modal-root").innerHTML =
    `<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal-title"><h2>${escapeHtml(title)}</h2><button class="icon-btn" data-dismiss aria-label="关闭">${icon("x")}</button></div>${body}</section></div>`;
  icons();
  $("#modal-root")
    .querySelectorAll("[data-dismiss]")
    .forEach((b) => b.addEventListener("click", closeModal));
  setTimeout(
    () => $<HTMLInputElement>("#modal-root input, #modal-root button")?.focus(),
    30,
  );
}
let modalCancel: (() => void) | undefined;
let modalDispose: (() => void) | undefined;
function closeModal() {
  modalDispose?.();
  modalDispose = undefined;
  const cb = modalCancel;
  modalCancel = undefined;
  $("#modal-root").innerHTML = "";
  cb?.();
}
function decisionDialog(
  title: string,
  message: string,
  buttons: { id: string; label: string; primary?: boolean }[],
): Promise<string> {
  closeModal();
  return new Promise((resolve) => {
    modal(
      title,
      `<p>${escapeHtml(message)}</p><div class="modal-actions">${buttons.map((b) => `<button class="${b.primary ? "primary" : ""}" data-decision="${b.id}">${escapeHtml(b.label)}</button>`).join("")}</div>`,
    );
    modalCancel = () => resolve("cancel");
    document.querySelectorAll<HTMLElement>("[data-decision]").forEach(
      (b) =>
        (b.onclick = () => {
          modalCancel = undefined;
          closeModal();
          resolve(b.dataset.decision!);
        }),
    );
  });
}
async function confirmDialog(title: string, message: string, label: string) {
  return (
    (await decisionDialog(title, message, [
      { id: "cancel", label: "取消" },
      { id: "confirm", label, primary: true },
    ])) === "confirm"
  );
}
function inputDialog(
  title: string,
  label: string,
  value: string,
): Promise<string | null> {
  closeModal();
  return new Promise((resolve) => {
    modal(
      title,
      `<label class="field-label">${escapeHtml(label)}<input id="dialog-input" value="${escapeHtml(value)}" autocomplete="off"></label><div class="modal-actions"><button data-dismiss>取消</button><button class="primary" id="dialog-submit">创建</button></div>`,
    );
    modalCancel = () => resolve(null);
    const submit = () => {
      const val = $<HTMLInputElement>("#dialog-input").value.trim();
      if (!val) return;
      modalCancel = undefined;
      closeModal();
      resolve(val);
    };
    $("#dialog-submit").onclick = submit;
    $("#dialog-input").onkeydown = (e) => {
      if (e.key === "Enter") submit();
    };
    setTimeout(() => $<HTMLInputElement>("#dialog-input").select(), 50);
  });
}
function showSettings() {
  closeModal();
  modal(
    "Markdown 设置",
    `
  <div class="settings-section"><h3>外观</h3><div class="setting-row"><label for="theme-choice">界面主题</label><select id="theme-choice"><option value="light">浅色 · 纸白</option><option value="dark">深色 · 墨绿</option><option value="system">跟随系统</option></select></div><div class="setting-row"><label for="font-size">正文字号</label><div><input id="font-size" type="range" min="14" max="24" value="${prefs.fontSize}"><span id="font-value">${prefs.fontSize}px</span></div></div></div>
  ${renderSettingsMarkup(prefs.render)}
  <div class="settings-section"><h3>写作与保存</h3><label class="setting-row"><span>编辑时预览跟随光标<small>对照模式中，预览定位到光标所在段落。</small></span><input id="sync-preview" type="checkbox" ${prefs.syncPreview ? "checked" : ""}></label><label class="setting-row"><span>滚动预览时编辑区跟随<small>对照模式中，编辑区定位到预览正文对应位置。</small></span><input id="sync-editor-scroll" type="checkbox" ${prefs.syncEditorScroll ? "checked" : ""}></label><label class="setting-row"><span>自动保存已命名笔记<small>停顿后保存；检测到外部修改时暂停。</small></span><input id="autosave" type="checkbox" ${prefs.autosave ? "checked" : ""}></label><p class="muted">未保存的内容会自动保存本地恢复快照。快捷键 Ctrl+S 可随时保存原文件。</p></div>
  <div class="settings-section"><div class="engine-info" id="settings-engine">内置 Python Markdown 渲染器</div></div><div class="settings-footer"><span>ZNote · 本地 Markdown 编辑器</span><button class="primary" data-dismiss>完成</button></div>`,
  );
  modalDispose = mountRenderSettings($("#render-settings"), prefs.render, settings => {
    prefs.render = settings;
    renderSettingsRevision++;
    persistPrefs(); renderedKey = ""; scheduleRender(); status();
  });
  $("#modal-root .modal").classList.add("render-settings-modal");
  $<HTMLSelectElement>("#theme-choice").value = prefs.theme;
  $("#theme-choice").onchange = (e) => {
    prefs.theme = (e.target as HTMLSelectElement).value as Preferences["theme"];
    applyPrefs();
  };
  $("#font-size").oninput = (e) => {
    prefs.fontSize = Number((e.target as HTMLInputElement).value);
    $("#font-value").textContent = prefs.fontSize + "px";
    applyPrefs();
  };
  $("#autosave").onchange = (e) => {
    prefs.autosave = (e.target as HTMLInputElement).checked;
    persistPrefs();
  };
  $("#sync-preview").onchange = (e) => {
    prefs.syncPreview = (e.target as HTMLInputElement).checked;
    persistPrefs();
    syncPreviewToCursor();
  };
  $("#sync-editor-scroll").onchange = (e) => {
    prefs.syncEditorScroll = (e.target as HTMLInputElement).checked;
    persistPrefs();
  };
  if (native)
    void invoke<{ versions: Record<string, string>; python: string }>(
      "renderer_info",
    )
      .then((r) => {
        const el = $("#settings-engine");
        if (el)
          el.textContent = `Python ${r.python} · Zensical ${r.versions.zensical} · Markdown ${r.versions.Markdown} · PyMdown ${r.versions["pymdown-extensions"]}`;
      })
      .catch(() => {});
}
const snippets: { name: string; description: string; text: string }[] = [
  {
    name: "提示框",
    description: "admonition · 突出一段重要内容",
    text: '\n!!! note "标题"\n\n    在这里写下内容。\n',
  },
  {
    name: "折叠详情",
    description: "details · 收起补充信息",
    text: '\n???+ tip "展开了解更多"\n\n    补充内容。\n',
  },
  {
    name: "内容标签页",
    description: "tabbed · 并列展示多个方案",
    text: '\n=== "方案一"\n\n    第一组内容。\n\n=== "方案二"\n\n    第二组内容。\n',
  },
  {
    name: "数学公式",
    description: "arithmatex · LaTeX 公式",
    text: "\n$$\nE = mc^2\n$$\n",
  },
  {
    name: "Mermaid 图表",
    description: "流程图 · 结构与关系",
    text: "\n```mermaid\ngraph LR\n    A[想法] --> B[写作]\n    B --> C[发布]\n```\n",
  },
  {
    name: "网格卡片",
    description: "md_in_html · 内容卡片",
    text: '\n<div class="grid cards" markdown>\n\n- **卡片标题**\n\n    卡片内容。\n\n- **另一张卡片**\n\n    更多内容。\n\n</div>\n',
  },
  {
    name: "脚注",
    description: "footnotes · 补充参考",
    text: "正文[^note]\n\n[^note]: 脚注内容。\n",
  },
  {
    name: "按钮链接",
    description: "attr_list · 行动入口",
    text: "[了解更多](https://zensical.org/){ .md-button }",
  },
];
function insertMenu() {
  modal(
    "丰富你的表达",
    `<p class="muted">插入 Markdown 原文；可切换到「对照」查看渲染结果。</p><div class="snippet-grid">${snippets.map((s, i) => `<button data-snippet="${i}"><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.description)}</span></button>`).join("")}</div>`,
  );
  document.querySelectorAll<HTMLElement>("[data-snippet]").forEach(
    (b) =>
      (b.onclick = () => {
        const s = snippets[Number(b.dataset.snippet)];
        closeModal();
        if (mode === "read") setMode("source");
        current()?.editor?.insert(s.text);
      }),
  );
}
function format(kind: string) {
  const editor = current()?.editor;
  if (!editor) return;
  if (mode === "read") setMode("source");
  if (kind === "bold") wrap(editor.view, "**");
  else if (kind === "italic") wrap(editor.view, "*");
  else if (kind === "image") $("#image-picker").click();
  else if (kind === "heading") prefixLines(editor.view, "# ");
  else if (kind === "quote") prefixLines(editor.view, "> ");
  else if (kind === "list") prefixLines(editor.view, "- ");
  else if (kind === "task") prefixLines(editor.view, "- [ ] ");
  else if (kind === "link") {
    const { from, to } = editor.view.state.selection.main;
    const selected = editor.view.state.sliceDoc(from, to) || "链接文字";
    editor.insert(`[${selected}](https://)`);
  } else if (kind === "code") {
    const { from, to } = editor.view.state.selection.main;
    const selected = editor.view.state.sliceDoc(from, to);
    if (selected && !selected.includes("\n")) wrap(editor.view, "`");
    else editor.insert(`\n\`\`\`\n${selected}\n\`\`\`\n`);
  } else
    editor.insert(
      (
        {
          table: "\n| 名称 | 内容 |\n| --- | --- |\n| 示例 | 正文 |\n",
        } as Record<string, string>
      )[kind] || "",
    );
}
function setBlockStyle(editor: NoteEditor, style: string) {
  const view = editor.view;
  const selection = view.state.selection.main;
  const start = view.state.doc.lineAt(selection.from).from;
  const last =
    selection.empty || selection.to !== view.state.doc.lineAt(selection.to).from
      ? selection.to
      : selection.to - 1;
  const end = view.state.doc.lineAt(last).to;
  const lines = view.state.sliceDoc(start, end).split("\n");
  const updated = lines
    .map((line, index) => {
      const plain = line.replace(
        /^(?:#{1,6} |>\s?|- \[[ xX]\] |[-*+] |\d+\. )/,
        "",
      );
      const prefix =
        style === "paragraph"
          ? ""
          : style === "ordered"
            ? index + 1 + ". "
            : style === "heading-1"
              ? "# "
              : style === "heading-2"
                ? "## "
                : style === "heading-3"
                  ? "### "
                  : style === "quote"
                    ? "> "
                    : style === "task"
                      ? "- [ ] "
                      : "- ";
      return prefix + plain;
    })
    .join("\n");
  if (updated !== view.state.sliceDoc(start, end))
    view.dispatch({
      changes: { from: start, to: end, insert: updated },
      selection: selection.empty
        ? { anchor: start + updated.length }
        : { anchor: start, head: start + updated.length },
      scrollIntoView: true,
    });
  view.focus();
}
const contextRoot = $("#editor-context-root");
const selectionToolbar = $("#selection-toolbar");
function hideSelectionToolbar() {
  selectionToolbar.hidden = true;
}
function showSelectionToolbar() {
  const view = current()?.editor?.view;
  if (!view || mode === "read" || view.state.selection.main.empty) {
    hideSelectionToolbar();
    return;
  }
  const range = view.state.selection.main;
  const coords = view.coordsAtPos(range.head);
  if (!coords) {
    hideSelectionToolbar();
    return;
  }
  const length = Array.from(view.state.sliceDoc(range.from, range.to)).length;
  $("#selection-summary").textContent = `已选 ${length} 字符`;
  selectionToolbar.hidden = false;
  const { width, height } = selectionToolbar.getBoundingClientRect();
  const area = $(".writing-area").getBoundingClientRect();
  const left = Math.max(8, Math.min(coords.left - width / 2, innerWidth - width - 8));
  const above = coords.top - height - 10;
  const below = coords.bottom + 10;
  const top = above >= area.top + 8
    ? above
    : below + height <= Math.min(area.bottom, innerHeight) - 8
      ? below
      : Math.max(area.top + 8, above);
  selectionToolbar.style.left = `${left}px`;
  selectionToolbar.style.top = `${top}px`;
}
function closeEditorContextMenu() {
  contextRoot.replaceChildren();
}
function contextButton(
  label: string,
  action: string,
  shortcut = "",
  disabled = false,
) {
  return (
    '<button type="button" role="menuitem" data-context-action="' +
    action +
    '"' +
    (disabled ? " disabled" : "") +
    "><span>" +
    label +
    "</span><kbd>" +
    shortcut +
    "</kbd></button>"
  );
}
function contextSubmenu(label: string, children: string) {
  return (
    '<div class="editor-context-submenu"><button type="button" aria-haspopup="menu"><span>' +
    label +
    '</span><span aria-hidden="true">›</span></button><div class="editor-context-panel" role="menu">' +
    children +
    "</div></div>"
  );
}
function contextIcon(
  name: string,
  action: string,
  label: string,
  disabled = false,
) {
  return (
    '<button type="button" role="menuitem" data-context-action="' +
    action +
    '" aria-label="' +
    label +
    '" title="' +
    label +
    '"' +
    (disabled ? " disabled" : "") +
    ">" +
    icon(name) +
    "</button>"
  );
}
function positionEditorContextSubmenu(submenu: HTMLElement) {
  const panel = submenu.querySelector<HTMLElement>(":scope > .editor-context-panel");
  if (!panel) return;
  const main = contextRoot.firstElementChild as HTMLElement;
  const mainRect = main.getBoundingClientRect();
  const rightSpace = innerWidth - mainRect.right - 8;
  const leftSpace = mainRect.left - 8;
  const openLeft = rightSpace < 270 && leftSpace > rightSpace;
  const space = Math.max(0, openLeft ? leftSpace : rightSpace);
  submenu.classList.toggle("open-left", openLeft);
  panel.style.width = `${Math.min(270, space)}px`;
  panel.style.minWidth = space < 210 ? "0" : "";
  if (!panel.offsetHeight) return;
  const submenuTop = submenu.getBoundingClientRect().top;
  const top = Math.max(
    8,
    Math.min(submenuTop - 6, innerHeight - panel.offsetHeight - 8),
  );
  panel.style.top = `${top - submenuTop}px`;
}
function showEditorContextMenu(event: MouseEvent) {
  hideSelectionToolbar();
  const editor = current()?.editor;
  if (!editor || mode === "read") return;
  event.preventDefault();
  const view = editor.view;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const range = view.state.selection.main;
  if (pos !== null && (range.empty || pos < range.from || pos > range.to))
    view.dispatch({ selection: { anchor: pos } });
  const selected = !view.state.selection.main.empty;
  contextRoot.innerHTML = [
    '<div class="editor-context-panel editor-context-main" role="menu" aria-label="编辑菜单">',
    '<div class="editor-context-icons">',
    contextIcon("scissors", "cut", "剪切", !selected),
    contextIcon("copy", "copy", "复制", !selected),
    contextIcon("clipboard", "paste", "粘贴"),
    contextIcon("trash-2", "delete", "删除", !selected),
    "</div>",
    contextSubmenu(
      "复制 / 粘贴为…",
      [
        contextButton("复制 Markdown", "copy", "Ctrl+C", !selected),
        contextButton("粘贴纯文本", "paste", "Ctrl+V"),
        contextButton("粘贴为引用", "paste-quote"),
      ].join(""),
    ),
    '<div class="editor-context-divider"></div>',
    '<div class="editor-context-icons editor-context-format">',
    contextIcon("bold", "bold", "粗体"),
    contextIcon("italic", "italic", "斜体"),
    contextIcon("code", "inline-code", "行内代码"),
    contextIcon("link", "link", "链接"),
    contextIcon("quote", "quote", "引用"),
    contextIcon("list-ordered", "ordered", "有序列表"),
    contextIcon("list", "list", "无序列表"),
    contextIcon("check-circle-2", "task", "任务列表"),
    "</div>",
    '<div class="editor-context-divider"></div>',
    contextSubmenu(
      "段落",
      [
        contextButton("正文段落", "paragraph"),
        contextButton("一级标题", "heading-1"),
        contextButton("二级标题", "heading-2"),
        contextButton("三级标题", "heading-3"),
        contextButton("引用", "quote"),
        contextButton("有序列表", "ordered"),
        contextButton("无序列表", "list"),
        contextButton("任务列表", "task"),
      ].join(""),
    ),
    contextSubmenu(
      "插入",
      [
        contextButton("图像", "image", "Ctrl+Shift+I"),
        '<div class="editor-context-divider"></div>',
        contextButton("脚注", "footnote"),
        contextButton("链接引用", "reference"),
        contextButton("水平分割线", "rule"),
        contextButton("表格", "table", "Ctrl+T"),
        contextButton("代码块", "codeblock", "Ctrl+Shift+K"),
        contextButton("公式块", "math", "Ctrl+Shift+M"),
        contextButton("内容目录", "toc"),
        contextButton("YAML Front Matter", "yaml"),
        '<div class="editor-context-divider"></div>',
        contextButton("段落（上方）", "paragraph-above"),
        contextButton("段落（下方）", "paragraph-below"),
      ].join(""),
    ),
    "</div>",
  ].join("");
  icons();
  const main = contextRoot.firstElementChild as HTMLElement;
  const x =
    event.clientX ||
    view.coordsAtPos(view.state.selection.main.head)?.left ||
    0;
  const y =
    event.clientY ||
    view.coordsAtPos(view.state.selection.main.head)?.bottom ||
    0;
  main.style.left =
    Math.max(8, Math.min(x, innerWidth - main.offsetWidth - 8)) + "px";
  main.style.top =
    Math.max(8, Math.min(y, innerHeight - main.offsetHeight - 8)) + "px";
}
contextRoot.addEventListener("pointerover", (event) => {
  const submenu = (event.target as HTMLElement).closest<HTMLElement>(
    ".editor-context-submenu",
  );
  if (submenu && contextRoot.contains(submenu)) positionEditorContextSubmenu(submenu);
});
contextRoot.addEventListener("focusin", (event) => {
  const submenu = (event.target as HTMLElement).closest<HTMLElement>(
    ".editor-context-submenu",
  );
  if (submenu && contextRoot.contains(submenu)) positionEditorContextSubmenu(submenu);
});
async function editorClipboard(action: string, editor: NoteEditor) {
  const view = editor.view;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (action === "copy" || action === "cut") {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected);
    } catch {
      const field = document.createElement("textarea");
      field.value = selected;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      if (!copied) {
        toast("无法访问剪贴板", true);
        return;
      }
    }
    if (action === "cut" && current()?.editor === editor)
      view.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
      });
    view.focus();
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (current()?.editor !== editor) return;
    if (action === "paste-quote") {
      const quote = text
        .split("\n")
        .map((line) => "> " + line)
        .join("\n");
      editor.insert(quote);
    } else editor.insert(text);
  } catch {
    toast("无法读取剪贴板", true);
  }
}
function runEditorContextAction(action: string) {
  const editor = current()?.editor;
  if (!editor) return;
  closeEditorContextMenu();
  const view = editor.view;
  if (["copy", "cut", "paste", "paste-quote"].includes(action)) {
    void editorClipboard(action, editor);
    return;
  }
  if (action === "delete") {
    const { from, to } = view.state.selection.main;
    if (from !== to)
      view.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
      });
    view.focus();
  } else if (action === "inline-code") wrap(view, String.fromCharCode(96));
  else if (["bold", "italic", "link", "image", "table"].includes(action))
    format(action);
  else if (
    ["paragraph", "ordered", "quote", "list", "task"].includes(action) ||
    action.startsWith("heading-")
  )
    setBlockStyle(editor, action);
  else if (action === "codeblock") {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const fence = String.fromCharCode(96).repeat(3);
    editor.insert(
      "\n\n" +
        fence +
        "\n" +
        selected +
        (selected.endsWith("\n") ? "" : "\n") +
        fence +
        "\n\n",
    );
  } else if (action === "footnote")
    editor.insert("[^note]\n\n[^note]: 脚注内容");
  else if (action === "reference")
    editor.insert("[链接文字][ref]\n\n[ref]: https://");
  else if (action === "rule") editor.insert("\n\n---\n\n");
  else if (action === "math") editor.insert("\n\n$$\nE = mc^2\n$$\n\n");
  else if (action === "toc") editor.insert("\n\n[TOC]\n\n");
  else if (action === "yaml") {
    if (view.state.doc.sliceString(0, 4) === "---\n") {
      toast("文档已有 YAML Front Matter");
      return;
    }
    view.dispatch({
      changes: { from: 0, insert: "---\ntitle: 标题\n---\n\n" },
      selection: { anchor: 11 },
    });
    view.focus();
  } else if (action === "paragraph-above" || action === "paragraph-below") {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const at = action === "paragraph-above" ? line.from : line.to;
    const insert = action === "paragraph-above" ? "\n" : "\n\n";
    view.dispatch({
      changes: { from: at, insert },
      selection: {
        anchor: at + (action === "paragraph-above" ? 0 : insert.length),
      },
    });
    view.focus();
  }
}
$("#editor-stage").addEventListener("contextmenu", showEditorContextMenu);
$("#editor-stage").addEventListener("mouseup", (event) => {
  if (event.button !== 0) return;
  requestAnimationFrame(showSelectionToolbar);
});
selectionToolbar.addEventListener("pointerdown", (event) => event.preventDefault());
selectionToolbar.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-selection-action]");
  if (!button) return;
  const action = button.dataset.selectionAction!;
  hideSelectionToolbar();
  if (action === "copy") {
    const editor = current()?.editor;
    if (editor) void editorClipboard("copy", editor);
  } else format(action);
});
contextRoot.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-context-action]",
  );
  if (button) runEditorContextAction(button.dataset.contextAction!);
});
document.addEventListener("pointerdown", (event) => {
  if (!contextRoot.contains(event.target as Node)) closeEditorContextMenu();
  if (!selectionToolbar.contains(event.target as Node)) hideSelectionToolbar();
  if (!(event.target as HTMLElement).closest("#sidebar-menu, .sidebar-more")) closeSidebarMenu();
});
window.addEventListener("resize", () => {
  closeEditorContextMenu();
  hideSelectionToolbar();
});
$("#editor-stage").addEventListener("scroll", () => {
  closeEditorContextMenu();
  hideSelectionToolbar();
}, true);
const actions: Record<string, () => unknown> = {
  "sidebar-menu": toggleSidebarMenu,
  search: () => {
    side = "search";
    renderSidebar();
    $("#document-search").focus();
  },
  folder: chooseFolder,
  "close-workspace": async () => {
    if (native) await invoke("close_workspace");
    workspace = undefined;
    prefs.lastWorkspace = undefined;
    persistPrefs();
    for (const tab of tabs) {
      tab.plan = undefined;
    }
    $("#workspace-name").textContent = "选择文件夹";
    $("#workspace-notice").hidden = true;
    renderSidebar();
    renderedKey = "";
    scheduleRender();
    toast("已关闭文件夹，打开的文档与未保存内容已保留");
  },
  "render-info": () => {
    const tab = current();
    const plan = tab?.plan;
    modal(
      "当前渲染配置",
      `<p>${plan ? "下列配置已用于最近一次预览。" : "切换到阅读或分栏模式后生成有效配置。"}</p><pre class="build-log">${escapeHtml(JSON.stringify(plan ? { ...plan, styles: plan.styles.map((s) => ({ source: s.source })) } : { documentPath: tab?.path || null }, null, 2))}</pre><div class="modal-actions"><button data-dismiss>关闭</button></div>`,
    );
  },
  open: () => openFile(),
  new: newNote,
  save: () => save(),
  saveas: () => save(current(), true),
  refresh,
  welcome: showWelcome,
  sidebar: () => {
    const hidden = document.body.classList.toggle("sidebar-hidden");
    const button = $<HTMLButtonElement>(".status-sidebar-toggle");
    const label = hidden ? "展开导航" : "收起导航";
    button.title = `${label} Ctrl+Shift+L`;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon(hidden ? "panel-left-open" : "panel-left-close");
    icons();
  },
  focus: () => {
    const active = document.body.classList.toggle("focus-mode");
    $('[data-action="focus"]').setAttribute("aria-pressed", String(active));
  },
  settings: showSettings,
  theme: () => {
    prefs.theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyPrefs();
  },
  insert: insertMenu,
  commands: commandPalette,
  external: showExternal,
  find: () => {
    if (mode === "read") openPreviewFind();
    else if (current()?.editor) openEditorSearchPanel(current()!.editor!.view);
  },
  replace: () => {
    if (mode === "read") setMode("source");
    if (current()?.editor) openEditorSearchPanel(current()!.editor!.view);
  },
};
function commandPalette() {
  const commands = [
    ["new", "新建笔记", "Ctrl N"],
    ["open", "打开 Markdown 文件", "Ctrl O"],
    ["folder", "浏览 Markdown 文件夹", ""],
    ["close-workspace", "关闭文件夹，保留打开的文件", ""],
    ["render-info", "查看当前渲染配置", ""],
    ["save", "保存笔记", "Ctrl S"],
    ["saveas", "另存为", "Ctrl Shift S"],
    ["find", "查找内容", "Ctrl F"],
    ["replace", "查找与替换", "Ctrl H"],
    ["insert", "插入 Zensical 扩展", ""],
    ["sidebar", "切换侧边栏", "Ctrl Shift L"],
    ["focus", "切换专注模式", "Ctrl Shift F"],
    ["settings", "设置", ""],
  ];
  modal(
    "快速操作",
    `<input class="command-search" id="command-query" placeholder="输入命令名称…" autocomplete="off"><div class="command-list">${commands.map(([id, name, key]) => `<button data-command="${id}"><span>${name}</span><kbd>${key}</kbd></button>`).join("")}</div>`,
  );
  $("#command-query").oninput = (e) => {
    const q = (e.target as HTMLInputElement).value;
    document
      .querySelectorAll<HTMLElement>("[data-command]")
      .forEach((b) => (b.hidden = !b.textContent?.includes(q)));
  };
  $("#command-query").onkeydown = (e) => {
    if (e.key === "Enter")
      document
        .querySelector<HTMLButtonElement>("[data-command]:not([hidden])")
        ?.click();
  };
  document.querySelectorAll<HTMLElement>("[data-command]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.command!;
        closeModal();
        actions[id]?.();
      }),
  );
  setTimeout(() => $("#command-query").focus(), 40);
}

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const close = target.closest<HTMLElement>("[data-close]");
  if (close) {
    void closeTab(close.dataset.close!);
    return;
  }
  const tab = target.closest<HTMLElement>("[data-tab]");
  if (tab) {
    activate(tab.dataset.tab!);
    return;
  }
  const action = target.closest<HTMLElement>("[data-action]");
  if (action) {
    if (action.dataset.action !== "sidebar-menu") closeSidebarMenu();
    actions[action.dataset.action!]?.();
    return;
  }
  const modeButton = target.closest<HTMLElement>("[data-mode]");
  if (modeButton) {
    setMode(modeButton.dataset.mode as Mode);
    return;
  }
  const sideButton = target.closest<HTMLElement>(".sidebar-nav [data-side]");
  if (sideButton) {
    side = sideButton.dataset.side as typeof side;
    renderSidebar();
    if (side === "search") $("#document-search").focus();
    return;
  }
  const file = target.closest<HTMLElement>("[data-file]");
  if (file) {
    void openFile(file.dataset.file).then(() => {
      const line = Number(file.dataset.line);
      const editor = current()?.editor;
      if (line && editor)
        editor.jump(
          editor.view.state.doc.line(
            Math.min(line, editor.view.state.doc.lines),
          ).from,
        );
    });
    return;
  }
  const folder = target.closest<HTMLElement>("[data-folder]");
  if (folder) {
    const p = folder.dataset.folder!;
    collapsed.has(p) ? collapsed.delete(p) : collapsed.add(p);
    renderSidebar();
    return;
  }
  const jump = target.closest<HTMLElement>("[data-jump]");
  if (jump) {
    const tab = current();
    const position = Number(jump.dataset.jump);
    if (tab && mode !== "source" && renderedKey === previewKey(tab)) {
      const line = tab.text.slice(0, position).split("\n").length;
      previewSurface.scrollToSource(tab.text, line);
    }
    if (mode !== "read") tab?.editor?.jump(position);
    return;
  }
  const fmt = target.closest<HTMLElement>("[data-format]");
  if (fmt) format(fmt.dataset.format!);
});
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") {
      closeSidebarMenu();
      closeEditorContextMenu();
      hideSelectionToolbar();
      closeModal();
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    let action: string | undefined;
    if (key === "k" && !e.shiftKey) action = "commands";
    else if (key === "o") action = e.shiftKey ? "folder" : "open";
    else if (key === "n") action = "new";
    else if (key === "s") action = e.shiftKey ? "saveas" : "save";
    else if (key === "l" && e.shiftKey) action = "sidebar";
    else if (key === "f") action = e.shiftKey ? "focus" : "find";
    else if (key === "h") action = "replace";
    else if (key === "w") {
      e.preventDefault();
      void closeTab(activeId);
      return;
    }
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      actions[action]?.();
    }
  },
  true,
);
$("#file-filter").oninput = renderSidebar;
$("#document-search").oninput = renderSidebar;
$<HTMLInputElement>("#preview-find-input").oninput = (event) =>
  updatePreviewFind(previewSurface.find((event.target as HTMLInputElement).value));
$<HTMLInputElement>("#preview-find-input").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    updatePreviewFind(previewSurface.nextFind(event.shiftKey ? -1 : 1));
  } else if (event.key === "Escape") {
    event.preventDefault();
    closePreviewFind();
  }
};
$("#preview-find").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-preview-find]");
  if (!button) return;
  if (button.dataset.previewFind === "close") closePreviewFind();
  else {
    const direction = button.dataset.previewFind === "previous" ? -1 : 1;
    updatePreviewFind(previewSurface.nextFind(direction));
  }
});
$<HTMLInputElement>("#image-picker").onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void insertImage(file);
  input.value = "";
};
$("#app").addEventListener("note-link", (event) => {
  const href = (event as CustomEvent<string>).detail.split("#")[0];
  const tab = current();
  if (!href || !tab?.path) return;
  try {
    void invoke<DiskDocument>("open_note_link", {
      document: tab.path,
      relative: decodeURIComponent(href),
    })
      .then((doc) => addTab(doc))
      .catch(fail);
  } catch (error) {
    fail(error);
  }
});
window.addEventListener("blur", () => void persistRecovery());
let checkingDisk = false;
async function checkDisk() {
  if (!native || !mounted || checkingDisk) return;
  const tab = current();
  if (!tab?.path || tab.saving) return;
  checkingDisk = true;
  try {
    const value = await invoke<string>("file_hash", { path: tab.path });
    if (tab.saving || value === tab.hash) return;
    if (tab.dirty) {
      tab.conflict = true;
      if (tab.id === activeId) {
        showConflict();
        status();
      }
    } else {
      const doc = await invoke<DiskDocument>("read_file", { path: tab.path });
      // A keystroke during disk I/O must never be overwritten.
      if (tab.dirty || tab.saving) {
        tab.conflict = true;
        if (tab.id === activeId) showConflict();
        return;
      }
      const position = tab.editor?.view.state.selection.main.head || 0;
      tab.editor?.destroy();
      tab.host?.remove();
      tab.editor = undefined;
      tab.text = doc.text.replace(/\r\n/g, "\n");
      tab.revision++;
      tab.base = tab.text;
      tab.hash = doc.hash;
      tab.bom = doc.bom;
      tab.eol = doc.eol;
      if (tab.id === activeId) {
        activate(tab.id);
        current()?.editor?.jump(Math.min(position, tab.text.length));
      }
      toast("已同步磁盘上的更改");
      scheduleRecovery();
    }
  } catch {
    /* A disappeared file remains recoverable; save reports the conflict. */
  } finally {
    checkingDisk = false;
  }
}
window.addEventListener("focus", () => {
  void checkDisk();
});
setInterval(() => {
  if (document.hasFocus()) {
    void checkDisk();
  }
}, 3000);

async function start() {
  applyPrefs();
  showWelcome();
  setMode(mode);
  icons();
  if (native) {
    if (prefs.lastWorkspace)
      try {
        await setWorkspace(
          await invoke<Workspace>("restore_workspace", {
            path: prefs.lastWorkspace,
          }),
        );
      } catch {}
    await restoreDrafts();
    void invoke<{ versions: Record<string, string> }>("renderer_info")
      .then((r) => {
        $("#engine-label").textContent =
          `Zensical ${r.versions.zensical} · 已就绪`;
      })
      .catch((e) => {
        $("#engine-label").textContent = "渲染器未就绪";
        fail(e);
      });
    await getCurrentWindow().onCloseRequested(async (e) => {
      e.preventDefault();
      await persistRecovery();
      if (tabs.some((t) => t.dirty)) {
        const choice = await decisionDialog(
          "还有未保存的笔记",
          "可以保存所有更改后退出，或保留恢复草稿，下次打开继续。",
          [
            { id: "save", label: "保存全部并退出", primary: true },
            { id: "draft", label: "保留草稿退出" },
            { id: "cancel", label: "继续写作" },
          ],
        );
        if (choice === "cancel") return;
        if (choice === "save") {
          for (const t of tabs.filter((t) => t.dirty))
            if (!(await save(t))) return;
        }
      }
      await persistRecovery();
      await getCurrentWindow().destroy();
    });
  } else $("#engine-label").textContent = "浏览器演示 · 请运行桌面版";
  restoring = false;
  mounted = true;
  scheduleRecovery();
}
void start();
