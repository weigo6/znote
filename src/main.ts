import { tr, getLanguage, setLanguage, normalizeLanguage, languagePacks, onLanguageChange, localizeUi, localizeError } from "./i18n";
import type { Language } from "./i18n";
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
  Smile,
  ArrowUpRight,
  Command,
  Sun,
  Moon,
  Monitor,
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
import { iconCollections, searchOnlineIcons } from "./icon-picker";
import type { IconCollection, OnlineIcon } from "./icon-picker";
import { IconPreviewLoader } from "./icon-preview-loader";
import { startPageMarkup, startRecentMarkup } from "./start-page";
import { commandPaletteMarkup, mountCommandPalette } from "./command-palette";
import { headings, wordCount } from "./syntax";
import { escapeHtml } from "./preview";
import { PreviewSurface } from "./preview-surface";
import { applyAppearanceToResult, sameRenderInputs } from "./render-appearance";
import { normalizeRenderSettings } from "./render-settings";
import { renderSettingsMarkup, mountRenderSettings } from "./render-settings-ui";
import type { RenderSettings } from "./render-settings";
import type { RenderPlan } from "./types";
import { applyAppTheme, normalizeThemeBindings, normalizeThemeMode, themeSettingsMarkup } from "./app-themes";
import type { ThemeMode, ThemeBindings } from "./app-themes";
import { mountSettingsNavigation, settingsNavigationMarkup, settingsPageHeading } from "./settings-navigation";
import { mountFileMenu, parentPath, isWithin, renamedPath } from "./sidebar-context-menu";
import type { FileView, FileTarget, FileAction } from "./sidebar-context-menu";
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
  Smile,
  ArrowUpRight,
  Command,
  Sun,
  Moon,
  Monitor,
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
  language: Language;
  render: RenderSettings;
  theme: ThemeMode;
  themeBindings: ThemeBindings;
  fontSize: number;
  autosave: boolean;
  syncPreview: boolean;
  syncEditorScroll: boolean;
  recent: string[];
  lastWorkspace?: string;
  sidebarWidth?: number;
  splitRatio: number;
  mode: Mode;
  fileView: FileView;
}
const initial: Preferences = {
  language: getLanguage(),
  render: normalizeRenderSettings(undefined),
  theme: "light",
  themeBindings: normalizeThemeBindings(undefined),
  fontSize: 17,
  autosave: false,
  syncPreview: true,
  syncEditorScroll: true,
  recent: [],
  splitRatio: 0.5,
  mode: "source",
  fileView: "tree",
};
let prefs: Preferences;
try {
  const stored = JSON.parse(localStorage.getItem("znote:preferences") || "{}");
  prefs = {
    ...initial,
    language: normalizeLanguage(stored.language),
    theme: normalizeThemeMode(stored.theme),
    themeBindings: normalizeThemeBindings(stored.themeBindings),
    fontSize: stored.fontSize ?? initial.fontSize,
    autosave: stored.autosave ?? initial.autosave,
    syncPreview: typeof stored.syncPreview === "boolean" ? stored.syncPreview : initial.syncPreview,
    syncEditorScroll: typeof stored.syncEditorScroll === "boolean" ? stored.syncEditorScroll : initial.syncEditorScroll,
    recent: Array.isArray(stored.recent)
      ? stored.recent.filter((path: unknown): path is string => typeof path === "string")
      : [],
    lastWorkspace: stored.lastWorkspace,
    sidebarWidth: typeof stored.sidebarWidth === "number" && Number.isFinite(stored.sidebarWidth)
      ? Math.max(180, Math.min(480, stored.sidebarWidth))
      : undefined,
    splitRatio: typeof stored.splitRatio === "number" && Number.isFinite(stored.splitRatio)
      ? Math.max(0, Math.min(1, stored.splitRatio))
      : initial.splitRatio,
    mode: stored.mode ?? initial.mode,
    fileView: stored.fileView === "list" ? "list" : "tree",
    render: normalizeRenderSettings(stored.render ?? { mathEngine: stored.mathEngine }),
  };
} catch {
  prefs = initial;
}
// Migrate 0.1.x preferences that still point to the removed live editor.
if (!["source", "split", "read"].includes(prefs.mode)) prefs.mode = "source";
let workspace: Workspace | undefined;
let dismissFileMenu: (() => void) | undefined;
let fileOperationBusy = false;
let tabs: Tab[] = [],
  activeId = "",
  mode: Mode = prefs.mode,
  side: "files" | "outline" | "search" = "files";
let closedFiles: string[] = [];
let startRecentFiles: string[] = [];
let startPageGeneration = 0;
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
  el.setAttribute("role", error ? "alert" : "status");
  el.innerHTML =
    icon(error ? "alert-triangle" : "check") +
    `<span>${escapeHtml(message)}</span>`;
  $("#toasts").append(el);
  icons();
  setTimeout(() => el.remove(), error ? 8500 : 3500);
  return el;
}
function fail(error: unknown) {
  toast(localizeError(error), true);
}
function requireNative() {
  if (!native) {
    toast(tr("请在 ZNote 桌面应用中使用文件和 Python 渲染功能。"), true);
    return false;
  }
  return true;
}

$("#app").innerHTML = `
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-nav" role="group" aria-label="${tr("导航视图")}"><button class="activity active" title="${tr("笔记文件")}" aria-label="${tr("笔记文件")}" data-side="files">${icon("notebook-pen")}<span>${tr("文件")}</span></button><button class="activity" title="${tr("搜索当前文档")}" aria-label="${tr("搜索当前文档")}" data-side="search">${icon("search")}<span>${tr("搜索")}</span></button><button class="activity" title="${tr("文档大纲")}" aria-label="${tr("文档大纲")}" data-side="outline">${icon("list")}<span>${tr("大纲")}</span></button></div>
    <div class="filter-wrap"><input id="file-filter" placeholder="${tr("筛选文件…")}" aria-label="${tr("筛选笔记文件")}" autocomplete="off"><input id="document-search" placeholder="${tr("搜索当前文档…")}" aria-label="${tr("搜索当前文档")}" autocomplete="off" hidden></div>
    <nav id="sidebar-content" aria-label="${tr("笔记列表")}"></nav>
    <div class="sidebar-footer"><button class="sidebar-add" data-action="new" title="${tr("新建笔记 Ctrl+N")}" aria-label="${tr("新建笔记")}">${icon("plus")}</button><button class="workspace-switch" data-action="folder" title="${tr("打开或切换文件夹")}">${icon("folder")}<span id="workspace-name">${tr("选择文件夹")}</span></button><button class="icon-btn sidebar-more" data-action="sidebar-menu" title="${tr("更多文件操作")}" aria-label="${tr("更多文件操作")}" aria-expanded="false">${icon("more-horizontal")}</button><span id="engine-label" class="visually-hidden">${tr("正在连接渲染器…")}</span></div>
    <div class="sidebar-menu" id="sidebar-menu" hidden>
      <div class="sidebar-menu-title">${tr("文件操作")}</div>
      <button data-action="new">${icon("plus")}${tr("新建笔记")}</button>
      <button data-action="search">${icon("search")}${tr("搜索当前文档")}</button>
      <button data-action="open">${icon("file-plus")}${tr("打开文件")}</button>
      <button data-action="folder">${icon("folder-open")}${tr("打开文件夹")}</button>
      <button data-action="recent-menu" aria-expanded="false" aria-controls="recent-section">${icon("file-text")}${tr("最近打开")}${icon("chevron-right")}</button>
      <button data-action="refresh">${icon("refresh-cw")}${tr("刷新文件")}</button>
      <button data-action="close-workspace">${icon("x")}${tr("关闭文件夹")}</button>
    </div>
    <div class="sidebar-resizer" role="separator" aria-label="${tr("调整侧边栏宽度")}" aria-orientation="vertical" aria-controls="sidebar" title="${tr("拖动调整侧边栏宽度")}"></div>
  </aside>
  <div id="recent-section" class="recent-panel" aria-label="${tr("最近打开")}" hidden>
    <button data-action="reopen-closed">${icon("refresh-cw")}${tr("重新打开关闭的文件")}<kbd>Ctrl+Shift+T</kbd></button>
    <div class="sidebar-menu-title recent-group-title">${tr("文件")}</div>
    <div id="recent-files"></div>
    <div class="sidebar-menu-title recent-group-title">${tr("文件夹")}</div>
    <div id="recent-folders"></div>
    <button class="clear-recent" data-action="clear-recent">${tr("清空最近记录")}</button>
  </div>
  <main class="main">
    <div class="tabs-bar"><button class="icon-btn start-toggle" data-action="welcome" title="${tr("起始页")}" aria-label="${tr("起始页")}">${icon("notebook-pen")}</button><div id="tabs" role="tablist"></div><button class="icon-btn" data-action="new" title="${tr("新建笔记")}">${icon("plus")}</button><div class="tabs-spacer"></div><button class="icon-btn" data-action="commands" title="${tr("快速操作 Ctrl+K")}" aria-label="${tr("快速操作")}">${icon("command")}</button><button class="icon-btn save-btn" data-action="save" title="${tr("保存 Ctrl+S")}" aria-label="${tr("保存")}">${icon("save")}</button><button class="icon-btn" data-action="settings" title="${tr("渲染设置")}" aria-label="${tr("渲染设置")}">${icon("settings")}</button><div class="focus-mode-controls"><button class="icon-btn" data-action="theme" title="${tr("切换界面主题")}" aria-label="${tr("切换界面主题")}">${icon("sun")}</button><button class="icon-btn" data-action="focus" title="${tr("专注模式 Ctrl+Shift+F")}" aria-label="${tr("专注模式")}" aria-pressed="false">${icon("focus")}</button></div></div>
    <div class="editor-toolbar"><div class="format-tools"><button class="icon-btn" data-format="heading" title="${tr("标题")}">H<span>1</span></button><button class="icon-btn" data-format="bold" title="${tr("粗体 Ctrl+B")}">${icon("bold")}</button><button class="icon-btn" data-format="italic" title="${tr("斜体 Ctrl+I")}">${icon("italic")}</button><span class="separator"></span><button class="icon-btn" data-format="quote" title="${tr("引用")}">${icon("quote")}</button><button class="icon-btn" data-format="list" title="${tr("列表")}">${icon("list")}</button><button class="icon-btn" data-format="task" title="${tr("任务列表")}">${icon("list-todo")}</button><button class="icon-btn" data-format="link" title="${tr("插入链接")}">${icon("link")}</button><button class="icon-btn" data-format="image" title="${tr("插入图片")}">${icon("image")}</button><button class="icon-btn" data-format="code" title="${tr("代码块")}">${icon("code")}</button><button class="icon-btn" data-format="table" title="${tr("表格")}">${icon("table")}</button><button class="insert-extension" data-action="insert">${icon("sparkles")}<span>${tr("扩展")}</span></button></div><div class="view-modes" role="group" aria-label="${tr("编辑模式")}"><button data-mode="source" title="${tr("Markdown 编辑")}">${icon("code-2")}<span>${tr("编辑")}</span></button><button data-mode="split" title="${tr("Python Markdown 对照预览")}">${icon("columns-2")}<span>${tr("对照")}</span></button><button data-mode="read" title="${tr("阅读模式")}">${icon("book-open")}<span>${tr("阅读")}</span></button></div></div>
    <section id="start-page" aria-label="${tr("欢迎使用 ZNote")}" hidden></section>
    <div id="conflict-banner" class="banner conflict" hidden></div>
    <div id="workspace-notice" class="banner" hidden></div>
    <div class="writing-area" dir="ltr"><section id="editor-stage" aria-label="${tr("编辑区域")}"></section><div class="split-resizer" role="separator" aria-label="${tr("调整编辑区与渲染区宽度")}" aria-orientation="vertical" aria-controls="editor-stage preview-panel" title="${tr("拖动调整编辑区与渲染区宽度")}"></div><section id="preview-panel"><div id="preview-find" class="preview-find" role="search" aria-label="${tr("在预览中查找")}" hidden><input id="preview-find-input" type="search" autocomplete="off" placeholder="${tr("在预览中查找")}" aria-label="${tr("在预览中查找")}"><span id="preview-find-count" aria-live="polite">0/0</span><button type="button" data-preview-find="previous" title="${tr("上一个")}" aria-label="${tr("上一个")}">${icon("chevron-up")}</button><button type="button" data-preview-find="next" title="${tr("下一个")}" aria-label="${tr("下一个")}">${icon("chevron-down")}</button><button type="button" data-preview-find="close" title="${tr("关闭查找")}" aria-label="${tr("关闭查找")}">${icon("x")}</button></div><div id="preview-warnings" hidden></div><article id="preview-content"></article></section></div>
    <footer class="statusbar"><div><button class="status-sidebar-toggle" data-action="sidebar" title="${tr("收起导航 Ctrl+Shift+L")}" aria-label="${tr("收起导航")}">${icon("panel-left-close")}</button><span id="save-status">${icon("check")}${tr("所有更改已保存")}</span><span id="word-count"></span></div><div><span id="cursor-position"></span><span id="encoding">UTF-8</span><span id="eol">LF</span><button data-action="settings" title="${tr("设置渲染配置")}" id="profile-status">${tr("Zensical 默认语法")}</button></div></footer>
  </main>
  <div id="selection-toolbar" class="selection-toolbar" role="toolbar" aria-label="${tr("选中文本操作")}" hidden><span id="selection-summary"></span><span class="selection-toolbar-divider"></span><button type="button" data-selection-action="copy" title="${tr("复制 Ctrl+C")}" aria-label="${tr("复制选中文本")}">${icon("copy")}</button><button type="button" data-selection-action="bold" title="${tr("粗体 Ctrl+B")}" aria-label="${tr("将选中文本设为粗体")}">${icon("bold")}</button><button type="button" data-selection-action="italic" title="${tr("斜体 Ctrl+I")}" aria-label="${tr("将选中文本设为斜体")}">${icon("italic")}</button><button type="button" data-selection-action="code" title="${tr("行内代码")}" aria-label="${tr("将选中文本设为代码")}">${icon("code")}</button><button type="button" data-selection-action="link" title="${tr("插入链接")}" aria-label="${tr("将选中文本设为链接")}">${icon("link")}</button></div>
  <div id="toasts" aria-live="polite"></div><div id="modal-root"></div><div id="editor-context-root"></div><div id="file-context-root"></div><input id="image-picker" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
`;

$<HTMLElement>(".format-tools .insert-extension").insertAdjacentHTML(
  "beforebegin",
  `<button class="insert-extension" data-action="icons" title="${tr("在线选择图标 Ctrl+Shift+E")}" aria-label="${tr("在线选择图标")}">${icon("smile")}<span>${tr("图标")}</span></button>`,
);

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

const systemTheme = matchMedia("(prefers-color-scheme: dark)");
systemTheme.addEventListener("change", () => {
  if (prefs.theme === "system") applyPrefs();
});

function applyPrefs() {
  applyAppTheme(document.documentElement, prefs.theme, prefs.themeBindings, systemTheme.matches);
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
    const next = prefs.theme === "light" ? tr("深色") : prefs.theme === "dark" ? tr("跟随系统") : tr("浅色");
    const current = prefs.theme === "light" ? tr("浅色") : prefs.theme === "dark" ? tr("深色") : tr("跟随系统");
    themeButton.innerHTML = icon(prefs.theme === "system" ? "monitor" : prefs.theme === "dark" ? "moon" : "sun");
    themeButton.setAttribute("aria-label", tr("界面主题：{0}，点击切换到{1}", [current, next]));
    themeButton.title = tr("界面主题：{0}，点击切换到{1}", [current, next]);
    themeButton.dataset.themeMode = prefs.theme;
    icons();
  }
  const themeChoice = document.querySelector<HTMLSelectElement>("#theme-choice");
  if (themeChoice) themeChoice.value = prefs.theme;
  document.querySelectorAll<HTMLInputElement>("[data-theme-binding]").forEach(input => {
    input.checked = prefs.themeBindings[input.dataset.themeBinding as keyof ThemeBindings] === input.value;
  });
  persistPrefs();
  previewSurface.refreshHostAppearance();
}
function refreshLanguageUi() {
  document.documentElement.lang = prefs.language;
  document.documentElement.dir = languagePacks[prefs.language].direction;
  localizeUi($("#app"), '.cm-editor, #preview-content, #sidebar-content, #tabs, #workspace-name, #recent-files, #recent-folders, textarea, #start-page, #file-context-root, [data-user-content], #render-profile option:not([value=""])');
  if (!current()) renderStartPage();
  if (!workspace) $("#workspace-name").textContent = tr("选择文件夹");
  const sidebarHidden = document.body.classList.contains("sidebar-hidden");
  const sidebarButton = $<HTMLButtonElement>(".status-sidebar-toggle");
  const sidebarLabel = sidebarHidden ? tr("展开导航") : tr("收起导航");
  sidebarButton.title = `${sidebarLabel} Ctrl+Shift+L`;
  sidebarButton.setAttribute("aria-label", sidebarLabel);
  renderSidebar();
  renderTabs();
  status();
  showConflict();
  applyPrefs();
}
onLanguageChange(refreshLanguageUi);
let recentMenuVersion = 0;
let recentCloseTimer: ReturnType<typeof setTimeout> | undefined;
function cancelRecentClose() {
  clearTimeout(recentCloseTimer);
  recentCloseTimer = undefined;
}
function closeRecentMenu() {
  cancelRecentClose();
  recentMenuVersion++;
  $("#recent-section").hidden = true;
  $('[data-action="recent-menu"]').setAttribute("aria-expanded", "false");
}
function scheduleRecentClose() {
  cancelRecentClose();
  recentCloseTimer = setTimeout(closeRecentMenu, 250);
}
function closeSidebarMenu() {
  closeRecentMenu();
  $("#sidebar-menu").hidden = true;
  $(".sidebar-more").setAttribute("aria-expanded", "false");
}
function toggleSidebarMenu() {
  const menu = $("#sidebar-menu");
  if (!menu.hidden) {
    closeSidebarMenu();
    return;
  }
  menu.hidden = !menu.hidden;
  $(".sidebar-more").setAttribute("aria-expanded", String(!menu.hidden));
  menu.querySelectorAll<HTMLButtonElement>("[data-action='refresh'], [data-action='close-workspace']")
    .forEach((button) => (button.disabled = !workspace));
}
function recentRow(path: string, kind: "file" | "folder") {
  const name = path.split(/[\\/]/).pop() || path;
  const directory = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  const attribute = kind === "file" ? "data-recent-file" : "data-recent-folder";
  return `<button class="recent-item" ${attribute}="${escapeHtml(path)}" title="${escapeHtml(path)}">${icon(kind === "file" ? "file-text" : "folder")}<span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(directory)}</small></span></button>`;
}
function renderRecentFolders() {
  $("#recent-folders").innerHTML = prefs.recent.length
    ? prefs.recent.map((path) => recentRow(path, "folder")).join("")
    : `<div class="recent-empty">${tr("暂无最近文件夹")}</div>`;
}
function positionRecentMenu() {
  const section = $("#recent-section");
  if (section.hidden) return;
  const trigger = $('[data-action="recent-menu"]').getBoundingClientRect();
  const menu = $("#sidebar-menu").getBoundingClientRect();
  const gap = 6;
  const availableRight = innerWidth - menu.right - gap - 8;
  const preferredWidth = Math.min(460, innerWidth - 16);
  const fitsRight = availableRight >= Math.min(280, preferredWidth);
  const width = fitsRight ? Math.min(preferredWidth, availableRight) : preferredWidth;
  section.style.width = `${width}px`;
  section.style.left = `${fitsRight ? menu.right + gap : Math.max(8, innerWidth - width - 8)}px`;
  section.style.top = `${Math.max(8, Math.min(trigger.top - 8, innerHeight - section.offsetHeight - 8))}px`;
}
async function openRecentMenu() {
  cancelRecentClose();
  const section = $("#recent-section");
  if (!section.hidden) return;
  section.hidden = false;
  $('[data-action="recent-menu"]').setAttribute("aria-expanded", "true");
  recentMenuVersion++;
  $<HTMLButtonElement>('[data-action="reopen-closed"]').disabled = !closedFiles.length;
  renderRecentFolders();
  positionRecentMenu();
  if (!native) {
    $("#recent-files").innerHTML = `<div class="recent-empty">${tr("桌面版中显示最近文件")}</div>`;
    icons();
    positionRecentMenu();
    return;
  }
  $("#recent-files").innerHTML = `<div class="recent-files-empty">${tr("正在加载…")}</div>`;
  const version = recentMenuVersion;
  try {
    const files = await invoke<string[]>("list_recent_files");
    if (version !== recentMenuVersion || section.hidden) return;
    $("#recent-files").innerHTML = files.length
      ? files.map((path) => recentRow(path, "file")).join("")
      : `<div class="recent-empty">${tr("暂无最近文件")}</div>`;
    icons();
    positionRecentMenu();
  } catch (error) {
    if (version !== recentMenuVersion) return;
    $("#recent-files").innerHTML = `<div class="recent-empty">${tr("无法读取最近文件")}</div>`;
    positionRecentMenu();
    fail(error);
  }
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
previewSurface.onPrintShortcut = () => void printCurrent();
function flatten(entries: FileEntry[]): FileEntry[] {
  return entries.flatMap((e) => (e.directory ? flatten(e.children) : [e]));
}
function renderSidebar() {
  dismissFileMenu?.();
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
  host.setAttribute("aria-label", side === "outline" ? tr("文档大纲") : side === "search" ? tr("搜索结果") : tr("笔记列表"));
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
      : `<div class="sidebar-empty">${tr("添加标题后，")}<br>${tr("在这里浏览文档结构。")}</div>`;
    return;
  }
  if (side === "search") {
    const tab = current();
    if (!query.trim()) {
      host.innerHTML = `<div class="sidebar-empty">${tr("输入关键词，搜索当前文档")}</div>`;
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
        results.push(`<button class="search-result" data-jump="${offset + match}"><strong>${tr("第")} ${index + 1} ${tr("行")}</strong><span>${escapeHtml(excerpt)}</span></button>`);
        if (results.length >= 200) break;
      }
      offset += line.length + 1;
    }
    host.innerHTML = results.join("") || `<div class="sidebar-empty">${tr("当前文档没有匹配内容")}</div>`;
    return;
  }
  if (!workspace) {
    host.innerHTML = `<button class="file-row ${!current() ? "active" : ""}" data-action="welcome">${icon("notebook-pen")}<span>${tr("起始页")}</span></button><div class="sidebar-empty"><span class="empty-illustration">${icon("folder-open")}</span><p>${tr("你的文字，留在本地")}</p><span>${tr("打开笔记文件夹，")}<br>${tr("开始一次专注的写作。")}</span><button data-action="folder">${tr("打开文件夹")} ${icon("arrow-up-right")}</button></div>`;
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
    (prefs.fileView === "list" ? flatten(workspace.entries).filter(e => !query || e.path.toLowerCase().includes(query)).map(e => {
      const relative = parentPath(e.path).slice(workspace!.root.length).replace(/^[\\/]/, "").replace(/\\/g, " / ");
      return `<button class="file-row flat-file-row ${current()?.path === e.path ? "active" : ""}" data-file="${escapeHtml(e.path)}" title="${escapeHtml(e.path)}">${icon("file-text")}<span class="flat-file-label"><span>${escapeHtml(e.name.replace(/\.md$/, ""))}</span>${relative ? `<small>${escapeHtml(relative)}</small>` : ""}</span>${tabs.some(t => t.path === e.path && t.dirty) ? '<span class="dirty-dot"></span>' : ""}</button>`;
    }).join("") : workspace.entries.map((e) => row(e, 0)).join("")) ||
    `<div class="sidebar-empty">${tr("没有匹配的笔记")}</div>`;
  icons();
}
function renderTabs() {
  $("#tabs").innerHTML = tabs
    .map(
      (t) =>
        `<div class="tab ${t.id === activeId ? "active" : ""}" role="tab" aria-selected="${t.id === activeId}" data-tab="${t.id}">${icon("file-text")}<span>${escapeHtml(t.name)}</span>${t.dirty ? '<span class="dirty-dot"></span>' : ""}<button class="tab-close" title="${tr("关闭笔记")}" data-close="${t.id}">${icon("x")}</button></div>`,
    )
    .join("");
  icons();
}
function status() {
  const tab = current();
  if (!tab) {
    for (const selector of ["#save-status", "#word-count", "#cursor-position", "#encoding", "#eol"]) $(selector).textContent = "";
    $("#profile-status").textContent = tr("设置");
    $("#save-status").classList.remove("unsaved");
    return;
  }
  const count = wordCount(tab.text);
  $("#profile-status").textContent = `Markdown · ${tab.plan?.math.engine ?? prefs.render.math.engine}`;
  $("#word-count").textContent =
    tr("{0} 字 · 约 {1} 分钟阅读", [count.toLocaleString(prefs.language), Math.max(1, Math.ceil(count / 450))]);
  cursorStatus();
  $("#encoding").textContent = tab.bom ? "UTF-8 BOM" : "UTF-8";
  $("#eol").textContent = tab.eol;
  $("#save-status").innerHTML =
    icon(
      tab.conflict ? "alert-triangle" : tab.dirty ? "more-horizontal" : "check",
    ) +
    (tab.saving
      ? tr("正在保存…")
      : tab.conflict
        ? tr("检测到外部修改")
        : tab.dirty
          ? tr("有未保存的更改")
          : tab.path
            ? tr("所有更改已保存")
            : tr("本地草稿"));
  $("#save-status").classList.toggle("unsaved", tab.dirty);
  icons();
}
function cursorStatus() {
  if (!current()) { $("#cursor-position").textContent = ""; return; }
  const state = current()?.editor?.view.state;
  const pos = state?.selection.main.head || 0;
  const line = state?.doc.lineAt(pos);
  const range = state?.selection.main;
  const selected = range && !range.empty
    ? tr(" · 已选 {0} 字符", [Array.from(state!.sliceDoc(range.from, range.to)).length])
    : "";
  $("#cursor-position").textContent =
    tr("行 {0}，列 {1}{2}", [line?.number || 1, pos - (line?.from || 0) + 1, selected]);
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
  if (activeId && activeId !== id) {
    closePreviewFind();
    if (/^#__codelineno-[^:#]+-\d+(?::\d+)?$/.test(window.location.hash))
      window.history.replaceState(null, "", window.location.href.split("#")[0]);
  }
  activeId = id;
  const tab = current();
  if (!tab) return;
  setStartPageVisible(false);
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
  if (doc) closedFiles = closedFiles.filter((path) => path !== doc.path);
  const existing = doc && tabs.find((t) => t.path === doc.path);
  if (existing) {
    activate(existing.id);
    return existing;
  }
  const body = (doc?.text ?? text).replace(/\r\n/g, "\n");
  const tab: Tab = {
    id: crypto.randomUUID(),
    name: doc ? doc.path.split(/[\\/]/).pop()! : tr("未命名.md"),
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
function setStartPageVisible(visible: boolean) {
  $("#start-page").hidden = !visible;
  $(".editor-toolbar").hidden = visible;
  writingArea.hidden = visible;
  $<HTMLButtonElement>(".save-btn").disabled = visible;
  $<HTMLButtonElement>('[data-action="focus"]').disabled = visible;
  $('[data-action="welcome"]').setAttribute("aria-pressed", String(visible));
}
function renderStartPage() {
  $("#start-page").setAttribute("aria-label", tr("欢迎使用 ZNote"));
  $("#start-page").innerHTML = startPageMarkup();
  $("#start-recent-list").innerHTML = startRecentMarkup(startRecentFiles, prefs.recent);
  icons();
}
function showStartPage() {
  hideSelectionToolbar();
  closePreviewFind();
  closeSidebarMenu();
  activeId = "";
  for (const tab of tabs) if (tab.host) tab.host.hidden = true;
  clearTimeout(renderTimer);
  renderGeneration++;
  queuedRenderGeneration = undefined;
  renderedKey = "";
  previewSurface.dispose();
  $("#preview-content").replaceChildren();
  $("#preview-warnings").hidden = true;
  $("#conflict-banner").hidden = true;
  document.body.classList.remove("focus-mode");
  $('[data-action="focus"]').setAttribute("aria-pressed", "false");
  setStartPageVisible(true);
  renderStartPage();
  renderTabs();
  renderSidebar();
  status();
  if (native) {
    void getCurrentWindow().setTitle("ZNote").catch(() => {});
    const generation = ++startPageGeneration;
    void invoke<string[]>("list_recent_files").then(files => {
      if (generation !== startPageGeneration) return;
      startRecentFiles = Array.isArray(files) ? files.filter(path => typeof path === "string") : [];
      if (!current()) {
        $("#start-recent-list").innerHTML = startRecentMarkup(startRecentFiles, prefs.recent);
        icons();
      }
    }).catch(() => {});
  }
}
async function openFile(path?: string): Promise<boolean> {
  if (!requireNative()) return false;
  try {
    const doc = path
      ? await invoke<DiskDocument>("read_file", { path })
      : await invoke<DiskDocument | null>("choose_file", { filterLabel: tr("Markdown / 文本") });
    if (doc) {
      addTab(doc);
      await rememberRecentFile(doc.path);
      return true;
    }
  } catch (e) {
    fail(e);
  }
  return false;
}
async function rememberRecentFile(path: string) {
  try {
    await invoke<void>("remember_recent_file", { path });
  } catch (error) {
    fail(tr("最近文件记录失败：") + error);
  }
}
async function openRecentFile(path: string) {
  if (!requireNative()) return;
  try {
    addTab(await invoke<DiskDocument>("open_recent_file", { path }));
  } catch (error) {
    fail(error);
  }
}
async function openRecentFolder(path: string) {
  if (!requireNative()) return;
  try {
    await setWorkspace(await invoke<Workspace>("restore_workspace", { path }));
  } catch (error) {
    fail(error);
  }
}
async function reopenClosedFile() {
  const path = closedFiles.shift();
  if (!path) return;
  await openFile(path);
}
async function clearRecentHistory() {
  try {
    if (native) await invoke<void>("clear_recent_files");
    prefs.recent = [];
    closedFiles = [];
    persistPrefs();
    recentMenuVersion++;
    $("#recent-files").innerHTML = `<div class="recent-empty">${tr("暂无最近文件")}</div>`;
    renderRecentFolders();
    $<HTMLButtonElement>('[data-action="reopen-closed"]').disabled = true;
    positionRecentMenu();
    startPageGeneration++;
    startRecentFiles = [];
    if (!current()) renderStartPage();
    toast(tr("最近记录已清空"));
  } catch (error) {
    fail(error);
  }
}
async function setWorkspace(next: Workspace, remember = true) {
  workspace = next;
  for (const tab of tabs) {
    tab.plan = undefined;
  }
  renderedKey = "";
  prefs.lastWorkspace = next.root;
  if (remember)
    prefs.recent = [
      next.root,
      ...prefs.recent.filter((p) => p !== next.root),
    ].slice(0, 10);
  persistPrefs();
  $("#workspace-name").textContent = next.name;
  renderSidebar();
  status();
  if (!current()) renderStartPage();
  if (next.truncated)
    toast(tr("文件列表达到 6000 项上限，请打开更小的笔记文件夹。"), true);
  scheduleRender();
}
async function chooseFolder() {
  if (!requireNative()) return;
  try {
    const result = await invoke<Workspace | null>("choose_workspace", { dialogTitle: tr("浏览 Markdown 文件夹") });
    if (result) await setWorkspace(result);
  } catch (e) {
    fail(e);
  }
}
async function refresh() {
  if (!workspace) return;
  try {
    await setWorkspace(await invoke<Workspace>("refresh_workspace"), false);
  } catch (e) {
    fail(e);
  }
}
function fileTarget(element: Element): { target: FileTarget; origin: HTMLElement } | undefined {
  if (!workspace || side !== "files") return;
  const origin = element.closest<HTMLElement>("[data-file], [data-folder]") ?? $("#sidebar-content");
  const path = origin.dataset.file ?? origin.dataset.folder;
  if (!path) return { origin, target: { path: workspace.root, name: workspace.name, kind: "root" } };
  const find = (entries: FileEntry[]): FileEntry | undefined => {
    for (const entry of entries) {
      if (entry.path === path) return entry;
      const match = find(entry.children);
      if (match) return match;
    }
  };
  const entry = find(workspace.entries);
  if (entry) return { origin, target: { path, name: entry.name, kind: entry.directory ? "folder" : "file" } };
}
function showFileMenu(element: Element, x: number, y: number) {
  const context = fileTarget(element);
  if (!context || fileOperationBusy) return;
  dismissFileMenu?.();
  closeEditorContextMenu();
  closeSidebarMenu();
  dismissFileMenu = mountFileMenu($("#file-context-root"), context.target, prefs.fileView, { x, y }, context.origin,
    { execute: (action, target) => void fileAction(action, target), icons, closed: () => { dismissFileMenu = undefined; } });
}
async function copyFilePath(path: string) {
  const display = path.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");
  const previous = document.activeElement as HTMLElement | null;
  try { await navigator.clipboard.writeText(display); }
  catch {
    const input = document.createElement("textarea");
    input.value = display;
    input.style.cssText = "position:fixed;left:-10000px;top:0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    previous?.focus({ preventScroll: true });
    if (!copied) throw new Error(tr("无法复制路径，请从属性中手动复制。"));
  }
  toast(tr("文件路径已复制"));
}
async function fileAction(action: FileAction, target: FileTarget) {
  if (fileOperationBusy) return;
  if (action === "tree" || action === "list") {
    prefs.fileView = action; persistPrefs(); renderSidebar();
    const row = Array.from($("#sidebar-content").querySelectorAll<HTMLElement>("[data-file], [data-folder]")).find(row => (row.dataset.file ?? row.dataset.folder) === target.path);
    (row ?? $("#file-filter")).focus();
    return;
  }
  if (action === "search") { side = "files"; renderSidebar(); $("#file-filter").focus(); return; }
  if (action === "copy-path") { try { await copyFilePath(target.path); } catch (e) { fail(e); } return; }
  if (!requireNative()) return;
  const parent = target.kind === "file" ? parentPath(target.path) : target.path;
  try {
    if (action === "open") { await openFile(target.path); return; }
    if (action === "window") {
      const tab = tabs.find(tab => tab.path === target.path);
      if (tab?.dirty) {
        const choice = await decisionDialog(tr("在新窗口中打开"), tr("新窗口将打开磁盘中的文件。是否先保存当前更改？"), [
          { id: "save", label: tr("保存后打开"), primary: true }, { id: "disk", label: tr("打开磁盘版本") }, { id: "cancel", label: tr("取消") },
        ]);
        if (choice === "cancel" || choice === "save" && !await save(tab)) return;
      }
      await invoke("open_in_new_window", { path: target.path }); return;
    }
    if (action === "new") { collapsed.delete(parent); await newNote(parent); return; }
    if (action === "folder") {
      const name = await inputDialog(tr("新建文件夹"), tr("文件夹名称"), tr("未命名文件夹"));
      if (!name) return;
      await invoke("create_folder", { parent, name }); collapsed.delete(parent); await refresh(); return;
    }
    if (action === "reveal") { await invoke("reveal_entry", { path: target.path }); return; }
    if (action === "properties") {
      const info = await invoke<{ path: string; directory: boolean; size: number | null; created: number | null; modified: number | null }>("entry_properties", { path: target.path });
      const date = (value: number | null) => value == null ? tr("未知") : new Date(value * 1000).toLocaleString(getLanguage());
      closeModal();
      const displayPath = info.path.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");
      modal(tr("属性"), `<dl class="file-properties"><dt>${tr("名称")}</dt><dd data-user-content>${escapeHtml(target.name)}</dd><dt>${tr("类型")}</dt><dd>${tr(info.directory ? "文件夹" : "笔记文件")}</dd><dt>${tr("大小")}</dt><dd>${info.size == null ? "—" : tr("{0} 字节", [info.size.toLocaleString(getLanguage())])}</dd><dt>${tr("创建时间")}</dt><dd>${escapeHtml(date(info.created))}</dd><dt>${tr("修改时间")}</dt><dd>${escapeHtml(date(info.modified))}</dd><dt>${tr("路径")}</dt><dd data-user-content class="file-property-path">${escapeHtml(displayPath)}</dd></dl><div class="modal-actions"><button id="property-copy">${tr("复制文件路径")}</button><button class="primary" data-dismiss>${tr("完成")}</button></div>`);
      $("#property-copy").onclick = () => { void copyFilePath(info.path).catch(fail); };
      return;
    }
    if (tabs.some(tab => isWithin(tab.path, target.path) && tab.saving)) { toast(tr("请等待保存完成后再操作。"), true); return; }
    if (action === "duplicate") {
      const tab = tabs.find(tab => tab.path === target.path);
      if (tab?.dirty) {
        const choice = await decisionDialog(tr("创建副本"), tr("这篇笔记还有未保存的更改。请选择副本内容。"), [
          { id: "save", label: tr("保存后创建副本"), primary: true }, { id: "disk", label: tr("复制磁盘版本") }, { id: "cancel", label: tr("取消") },
        ]);
        if (choice === "cancel" || choice === "save" && !await save(tab)) return;
      }
      const doc = await invoke<DiskDocument>("duplicate_note", { path: target.path, suffix: tr("副本") });
      addTab(doc); await rememberRecentFile(doc.path); await refresh(); return;
    }
    if (action === "rename") {
      let name = await inputDialog(tr("重命名"), tr("新名称"), target.name, tr("重命名"));
      if (!name || name === target.name) return;
      if (target.kind === "file") {
        if (!name.includes(".")) name += target.name.match(/\.[^.]+$/)?.[0] ?? ".md";
        if (!/\.(md|markdown|txt)$/i.test(name)) throw new Error(tr("笔记文件请保留 .md、.markdown 或 .txt 扩展名。"));
      }
      if (tabs.some(tab => isWithin(tab.path, target.path) && tab.saving)) { toast(tr("请等待保存完成后再操作。"), true); return; }
      clearTimeout(saveTimer); fileOperationBusy = true;
      const destination = await invoke<string>("rename_entry", { path: target.path, name });
      for (const tab of tabs) if (isWithin(tab.path, target.path)) {
        tab.path = renamedPath(tab.path!, target.path, destination);
        tab.name = tab.path.split(/[\\/]/).pop()!; tab.plan = undefined;
      }
      closedFiles = closedFiles.map(path => renamedPath(path, target.path, destination));
      startRecentFiles = startRecentFiles.map(path => renamedPath(path, target.path, destination));
      collapsed = new Set([...collapsed].map(path => renamedPath(path, target.path, destination)));
      renderedKey = ""; renderTabs(); status(); scheduleRender(); await persistRecovery(); await refresh();
      if (native && current()) void getCurrentWindow().setTitle(`${current()!.name} - ZNote`);
      toast(tr("已重命名")); return;
    }
    if (action === "trash") {
      const hasDirty = tabs.some(tab => isWithin(tab.path, target.path) && tab.dirty);
      const message = tr("将「{0}」移入回收站？可在系统回收站中恢复。", [target.name]) + (hasDirty ? " " + tr("未保存的修改将保留为独立草稿。") : "");
      if (!await confirmDialog(tr("删除"), message, tr("移入回收站"))) return;
      if (tabs.some(tab => isWithin(tab.path, target.path) && tab.saving)) { toast(tr("请等待保存完成后再操作。"), true); return; }
      clearTimeout(saveTimer); fileOperationBusy = true;
      await invoke("trash_entry", { path: target.path });
      for (const tab of [...tabs]) if (isWithin(tab.path, target.path)) {
        if (tab.dirty) { tab.path = undefined; tab.base = ""; tab.hash = ""; tab.conflict = false; tab.plan = undefined; tab.name = tr("{0}（保留草稿）", [tab.name]); }
        else { tab.editor?.destroy(); tab.host?.remove(); tabs = tabs.filter(item => item !== tab); }
      }
      closedFiles = closedFiles.filter(path => !isWithin(path, target.path));
      startRecentFiles = startRecentFiles.filter(path => !isWithin(path, target.path));
      collapsed = new Set([...collapsed].filter(path => !isWithin(path, target.path)));
      renderedKey = "";
      if (!tabs.length) showStartPage();
      else if (!tabs.some(tab => tab.id === activeId) && activeId) activate(tabs[tabs.length - 1].id);
      else { renderTabs(); status(); showConflict(); scheduleRender(); if (current()) void getCurrentWindow().setTitle(`${current()!.name} - ZNote`); }
      await persistRecovery(); await refresh(); toast(tr("已移入回收站"));
    }
  } catch (e) { fail(e); }
  finally { fileOperationBusy = false; }
}
async function newNote(parent?: string) {
  if (!workspace) {
    if (mode === "read") setMode("source");
    addTab().editor?.view.focus();
    return;
  }
  const name = await inputDialog(
    tr("新建笔记"),
    tr("给这篇笔记起个名字"),
    tr("未命名笔记"),
  );
  if (!name) return;
  try {
    const doc = await invoke<DiskDocument>("create_note", { name, parent });
    if (mode === "read") setMode("source");
    addTab(doc).editor?.view.focus();
    await rememberRecentFile(doc.path);
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
  if (!tab || fileOperationBusy || !requireNative()) return false;
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
    if (previousPath !== doc.path) await rememberRecentFile(doc.path);
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
    if (!quiet) toast(tr("笔记已保存"));
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
  el.innerHTML = `${icon("alert-triangle")}<span>${tr("磁盘上的文件已改变。当前编辑内容仍然保留。")}</span><button data-action="external">${tr("查看外部版本")}</button><button data-action="saveas">${tr("另存为")}</button>`;
  icons();
}
async function showExternal() {
  const tab = current();
  if (!tab?.path) return;
  try {
    const doc = await invoke<DiskDocument>("read_file", { path: tab.path });
    modal(
      tr("检测到外部修改"),
      `<p>${tr("左侧编辑内容未被替换。下面是磁盘上的版本；可以复制后合并，或明确重新加载。")}</p><textarea class="external-text" readonly>${escapeHtml(doc.text)}</textarea><div class="modal-actions"><button data-dismiss>${tr("保留当前编辑")}</button><button id="reload-external" class="primary">${tr("使用磁盘版本")}</button></div>`,
    );
    $("#reload-external").onclick = async () => {
      const result = await confirmDialog(
        tr("重新加载磁盘版本？"),
        tr("当前未保存的修改会被替换。建议先另存为保留副本。"),
        tr("重新加载"),
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
      tr("保存更改？"),
      tr("「{0}」还有未保存的内容。", [tab.name]),
      [
        { id: "save", get label() { return tr("保存并关闭"); }, primary: true },
        { id: "discard", get label() { return tr("放弃更改"); } },
        { id: "cancel", get label() { return tr("继续编辑"); } },
      ],
    );
    if (result === "save") {
      if (!(await save(tab))) return;
    } else if (result !== "discard") return;
  }
  if (tab.path)
    closedFiles = [tab.path, ...closedFiles.filter((path) => path !== tab.path)].slice(0, 10);
  tab.editor?.destroy();
  tab.host?.remove();
  tabs = tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    clearTimeout(saveTimer);
    showStartPage();
    $("#start-page [data-action=\"new\"]").focus();
  }
  else if (activeId === id) activate(tabs[tabs.length - 1].id);
  else renderTabs();
  await persistRecovery();
}
function recoveryData() {
  return tabs
    .filter(
      (t) =>
        t.dirty ||
        t.path ||
        (!t.path && t.text),
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
    toast(tr("本地草稿缓存空间不足，请及时保存。"), true);
  }
  if (native) {
    recoveryQueue = recoveryQueue
      .catch(() => {})
      .then(() => invoke<void>("write_recovery", { documents: docs }))
      .catch((e) => fail(tr("恢复快照写入失败：") + e));
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
  for (const item of saved) {
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
          tab.name = item.name + tr("（恢复副本）");
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
  if (recovered) {
    renderTabs();
    renderSidebar();
    status();
    showConflict();
    toast(tr("已恢复 {0} 篇本地草稿", [recovered]));
  }
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
let renderInputsRevision = 0;
function previewKey(tab: Tab) {
  return JSON.stringify([
    tab.id,
    tab.revision,
    renderInputsRevision,
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
      `<p class="empty-state">${tr("请在桌面应用中查看 Python Markdown 预览。")}</p>`;
    renderedKey = key;
    return;
  }
  try {
    const result = await invoke<RenderResult>("render_markdown", {
      text: source,
      path: tab.path || null,
      settings: structuredClone(prefs.render),
    });
    if (generation !== renderGeneration || tab.id !== activeId) return;
    applyAppearanceToResult(result, prefs.render);
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
    previewSurface.updateAppearance(prefs.render);
    if (!$("#preview-find").hidden) updatePreviewFind(previewSurface.getFindState());
    result.warnings.push(...runtimeWarnings);
    renderedKey = key;
    previewSurface.setScrollSync(tab.text, syncEditorToPreview);
    syncPreviewToCursor();
    $("#profile-status").textContent =
      `Markdown · ${result.plan?.math.engine ?? "katex"}`;
    const warnings = $("#preview-warnings");
    warnings.hidden = !result.warnings.length;
    warnings.textContent = result.warnings.join(" ");
  } catch (e) {
    if (generation !== renderGeneration) return;
    if (!$("#preview-content").querySelector("iframe"))
      $("#preview-content").innerHTML =
        `<p class="empty-state">${tr("本次预览未生成，原文仍可继续编辑。")}</p>`;
    $("#preview-warnings").hidden = false;
    $("#preview-warnings").textContent = String(e);
  }
}
async function insertImage(file: File, tab = current()) {
  if (!tab) return;
  if (!tab.path) {
    toast(tr("请先保存笔记，再插入图片。"), true);
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
    `<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal-title"><h2>${escapeHtml(title)}</h2><button class="icon-btn" data-dismiss aria-label="${tr("关闭")}">${icon("x")}</button></div>${body}</section></div>`;
  icons();
  $("#modal-root")
    .querySelectorAll("[data-dismiss]")
    .forEach((b) => b.addEventListener("click", closeModal));
  const dialog = $("#modal-root .modal");
  setTimeout(() => {
    if (dialog.isConnected && !dialog.contains(document.activeElement))
      dialog.querySelector<HTMLElement>("input, button")?.focus();
  }, 30);
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
      { id: "cancel", get label() { return tr("取消"); } },
      { id: "confirm", label, primary: true },
    ])) === "confirm"
  );
}
function inputDialog(
  title: string,
  label: string,
  value: string,
  submitLabel = tr("创建"),
): Promise<string | null> {
  closeModal();
  return new Promise((resolve) => {
    modal(
      title,
      `<label class="field-label">${escapeHtml(label)}<input id="dialog-input" value="${escapeHtml(value)}" autocomplete="off"></label><div class="modal-actions"><button data-dismiss>${tr("取消")}</button><button class="primary" id="dialog-submit">${escapeHtml(submitLabel)}</button></div>`,
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
    tr("设置"),
    `
  <div class="settings-layout">${settingsNavigationMarkup()}<div class="settings-content">
  <div data-settings-panel="appearance">${settingsPageHeading("appearance")}<div class="settings-section"><h3>${tr("语言")}</h3><div class="setting-row"><label for="language-choice">${tr("界面语言")}</label><select id="language-choice">${Object.entries(languagePacks).map(([id, pack]) => `<option value="${id}">${pack.name}</option>`).join("")}</select></div><p class="muted">${tr("语言更改立即生效，不会修改笔记内容。")}</p></div><div class="settings-section"><h3>${tr("界面主题")}</h3><div class="setting-row"><label for="theme-choice">${tr("颜色模式")}</label><select id="theme-choice"><option value="light">${tr("亮色")}</option><option value="dark">${tr("暗色")}</option><option value="system">${tr("跟随系统")}</option></select></div>${themeSettingsMarkup(prefs.themeBindings)}</div><div class="settings-section"><h3>${tr("文字显示")}</h3><div class="setting-row"><label for="font-size">${tr("正文字号")}</label><div><input id="font-size" type="range" min="14" max="24" value="${prefs.fontSize}"><span id="font-value">${prefs.fontSize}px</span></div></div></div></div>
  ${renderSettingsMarkup(prefs.render)}
  <div data-settings-panel="writing" hidden>${settingsPageHeading("writing")}<div class="settings-section"><h3>${tr("对照模式同步")}</h3><label class="setting-row"><span>${tr("编辑时预览跟随光标")}<small>${tr("对照模式中，预览定位到光标所在段落。")}</small></span><input id="sync-preview" type="checkbox" ${prefs.syncPreview ? "checked" : ""}></label><label class="setting-row"><span>${tr("滚动预览时编辑区跟随")}<small>${tr("对照模式中，编辑区定位到预览正文对应位置。")}</small></span><input id="sync-editor-scroll" type="checkbox" ${prefs.syncEditorScroll ? "checked" : ""}></label></div><div class="settings-section"><h3>${tr("保存与恢复")}</h3><label class="setting-row"><span>${tr("自动保存已命名笔记")}<small>${tr("停顿后保存；检测到外部修改时暂停。")}</small></span><input id="autosave" type="checkbox" ${prefs.autosave ? "checked" : ""}></label><p class="muted">${tr("未保存的内容会自动保存本地恢复快照。快捷键 Ctrl+S 可随时保存原文件。")}</p></div></div>
  </div></div><div class="settings-footer"><span>${tr("常规选项自动保存")}<span class="engine-info" id="settings-engine">${tr("内置 Python Markdown 渲染器")}</span></span><button class="primary" data-dismiss>${tr("完成")}</button></div>`,
  );
  const disposeRenderSettings = mountRenderSettings($("#render-settings"), prefs.render, settings => {
    const previous = prefs.render;
    prefs.render = settings;
    persistPrefs();
    if (sameRenderInputs(previous, settings)) {
      if (!previewSurface.updateAppearance(settings) && !renderInFlight &&
          (mode === "read" || mode === "split")) {
        renderedKey = "";
        scheduleRender();
      }
    } else {
      renderInputsRevision++;
      renderedKey = "";
      scheduleRender();
    }
    status();
  });
  $("#modal-root .modal").classList.add("render-settings-modal");
  const disposeNavigation = mountSettingsNavigation($("#modal-root .modal"));
  modalDispose = () => {
    disposeRenderSettings();
    disposeNavigation();
  };
  $<HTMLSelectElement>("#language-choice").value = prefs.language;
  $("#language-choice").onchange = event => {
    prefs.language = normalizeLanguage((event.target as HTMLSelectElement).value);
    persistPrefs();
    setLanguage(prefs.language);
  };
  $<HTMLSelectElement>("#theme-choice").value = prefs.theme;
  $("#theme-choice").onchange = (e) => {
    prefs.theme = normalizeThemeMode((e.target as HTMLSelectElement).value);
    applyPrefs();
  };
  document.querySelectorAll<HTMLInputElement>("[data-theme-binding]").forEach(input => {
    input.onchange = () => {
      const binding = input.dataset.themeBinding as keyof ThemeBindings;
      prefs.themeBindings = normalizeThemeBindings({ ...prefs.themeBindings, [binding]: input.value });
      applyPrefs();
    };
  });
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
    get name() { return tr("提示框"); },
    get description() { return tr("admonition · 突出一段重要内容"); },
    get text() { return tr("\n!!! note \"标题\"\n\n    在这里写下内容。\n"); },
  },
  {
    get name() { return tr("折叠详情"); },
    get description() { return tr("details · 收起补充信息"); },
    get text() { return tr("\n???+ tip \"展开了解更多\"\n\n    补充内容。\n"); },
  },
  {
    get name() { return tr("内容标签页"); },
    get description() { return tr("tabbed · 并列展示多个方案"); },
    get text() { return tr("\n=== \"方案一\"\n\n    第一组内容。\n\n=== \"方案二\"\n\n    第二组内容。\n"); },
  },
  {
    get name() { return tr("数学公式"); },
    get description() { return tr("arithmatex · LaTeX 公式"); },
    text: "\n$$\nE = mc^2\n$$\n",
  },
  {
    get name() { return tr("Mermaid 图表"); },
    get description() { return tr("流程图 · 结构与关系"); },
    get text() { return tr("\n```mermaid\ngraph LR\n    A[想法] --> B[写作]\n    B --> C[发布]\n```\n"); },
  },
  {
    get name() { return tr("网格卡片"); },
    get description() { return tr("md_in_html · 内容卡片"); },
    get text() { return `
<div class="grid cards" markdown>

${tr("- **卡片标题**")}

    ${tr("卡片内容。")}

${tr("- **另一张卡片**")}

    ${tr("更多内容。")}

</div>
`; },
  },
  {
    get name() { return tr("脚注"); },
    get description() { return tr("footnotes · 补充参考"); },
    get text() { return tr("正文[^note]\n\n[^note]: 脚注内容。\n"); },
  },
  {
    get name() { return tr("按钮链接"); },
    get description() { return tr("attr_list · 行动入口"); },
    get text() { return tr("[了解更多](https://zensical.org/){ .md-button }"); },
  },
];
function insertMenu() {
  modal(
    tr("丰富你的表达"),
    `<p class="muted">${tr("插入 Markdown 原文；可切换到「对照」查看渲染结果。")}</p><div class="snippet-grid">${snippets.map((s, i) => `<button data-snippet="${i}"><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.description)}</span></button>`).join("")}</div>`,
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
function openIconPicker() {
  const tab = current();
  const editor = tab?.editor;
  if (!tab || !editor) {
    toast(tr("请先打开笔记后再插入图标"), true);
    return;
  }
  if (mode === "read") setMode("source");
  const { from, to } = editor.view.state.selection.main;
  closeModal();
  modal(
    tr("在线选择图标"),
    `<div class="icon-picker" id="icon-picker">
      <p class="muted">${tr("搜索在线图标库，选中后在光标处插入 Zensical 短码。")}</p>
      <div class="icon-picker-controls">
        <input id="icon-query" type="search" placeholder="${tr("搜索英文名称，如 home、star、github")}" aria-label="${tr("搜索图标")}" autocomplete="off" spellcheck="false">
        <select id="icon-collection" aria-label="${tr("筛选图标库")}"><option value="all">${tr("全部图标库")}</option>${iconCollections.map((item) => `<option value="${item.prefix}">${escapeHtml(item.label)}</option>`).join("")}</select>
      </div>
      <div class="icon-picker-examples">${tr("试试：")}${["home", "star", "heart", "github"].map((word) => `<button type="button" data-icon-example="${word}">${word}</button>`).join("")}</div>
      <p class="icon-picker-status" id="icon-picker-status" role="status" aria-live="polite">${tr("输入关键词开始搜索")}</p>
      <div class="icon-picker-grid" id="icon-picker-results" aria-label="${tr("图标搜索结果")}"></div>
    </div>`,
  );
  const root = $<HTMLElement>("#icon-picker");
  const input = $<HTMLInputElement>("#icon-query");
  const collection = $<HTMLSelectElement>("#icon-collection");
  const status = $<HTMLElement>("#icon-picker-status");
  const grid = $<HTMLElement>("#icon-picker-results");
  let results: OnlineIcon[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let previewLoader: IconPreviewLoader | undefined;
  let previewObserver: IntersectionObserver | undefined;
  let inserted = false;
  let searching = false;
  const setSearching = (value: boolean) => {
    searching = value;
    grid.inert = value;
    grid.setAttribute("aria-busy", String(value));
  };
  const stopPreviews = () => {
    previewObserver?.disconnect();
    previewObserver = undefined;
    previewLoader?.dispose();
    previewLoader = undefined;
  };
  modalDispose = () => {
    clearTimeout(timer);
    request?.abort();
    stopPreviews();
    if (!inserted && current()?.editor === editor) editor.view.focus();
  };
  const select = (index: number) => {
    const selected = results[index];
    if (searching || !selected || current()?.editor !== editor) return;
    inserted = true;
    closeModal();
    const end = Math.min(to, editor.view.state.doc.length);
    const start = Math.min(from, end);
    editor.view.dispatch({
      changes: { from: start, to: end, insert: selected.shortcode },
      selection: { anchor: start + selected.shortcode.length },
      scrollIntoView: true,
    });
    editor.view.focus();
  };
  const search = async () => {
    clearTimeout(timer);
    const query = input.value.trim();
    request?.abort();
    stopPreviews();
    if (!query) {
      setSearching(false);
      results = [];
      grid.innerHTML = "";
      status.textContent = tr("输入关键词开始搜索");
      return;
    }
    setSearching(true);
    const next = new AbortController();
    request = next;
    status.textContent = tr("正在搜索…");
    try {
      const icons = await searchOnlineIcons(query, collection.value as IconCollection | "all", next.signal);
      if (next.signal.aborted || !root.isConnected) return;
      results = icons;
      status.textContent = icons.length ? tr("找到 {0} 个候选（最多显示 64 个）", [icons.length]) : tr("没有找到图标，请换个关键词");
      grid.innerHTML = icons.map((item, index) =>
        `<button type="button" class="icon-picker-result" data-icon-index="${index}" title="${escapeHtml(item.shortcode)}" aria-label="${tr("插入")} ${escapeHtml(item.shortcode)}">
          <span class="icon-picker-preview"><img data-preview-index="${index}" alt="" width="28" height="28"></span>
          <span class="icon-picker-name">${escapeHtml(item.label)}</span>
          <span class="icon-picker-source">${escapeHtml(item.collection)}</span>
        </button>`,
      ).join("");
      setSearching(false);
      const loader = new IconPreviewLoader();
      previewLoader = loader;
      const loadPreview = (image: HTMLImageElement) => {
        const item = icons[Number(image.dataset.previewIndex)];
        if (!item) return;
        void loader.load(item.previewUrl).then((src) => {
          if (previewLoader === loader && image.isConnected) image.src = src;
        }).catch(() => {
          if (previewLoader === loader && image.isConnected)
            image.closest(".icon-picker-result")?.classList.add("preview-error");
        });
      };
      const images = grid.querySelectorAll<HTMLImageElement>("img[data-preview-index]");
      if (typeof IntersectionObserver === "undefined") images.forEach(loadPreview);
      else {
        previewObserver = new IntersectionObserver((entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            loadPreview(entry.target as HTMLImageElement);
          }
        }, { root: grid, rootMargin: "120px 0px" });
        images.forEach((image) => previewObserver!.observe(image));
      }
    } catch (error) {
      if (next.signal.aborted || !root.isConnected) return;
      results = [];
      grid.innerHTML = "";
      setSearching(false);
      status.textContent = tr("搜索失败：{0}", [error instanceof Error ? error.message : String(error)]);
    }
  };
  const scheduleSearch = () => {
    clearTimeout(timer);
    request?.abort();
    stopPreviews();
    if (!input.value.trim()) {
      results = [];
      grid.innerHTML = "";
      setSearching(false);
      status.textContent = tr("输入关键词开始搜索");
      return;
    }
    setSearching(true);
    status.textContent = tr("正在搜索…");
    timer = setTimeout(() => void search(), 250);
  };
  input.addEventListener("input", scheduleSearch);
  collection.addEventListener("change", () => void search());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      select(0);
    } else if (event.key === "ArrowDown") {
      const first = grid.querySelector<HTMLButtonElement>("button");
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
  grid.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-icon-index]");
    if (button) select(Number(button.dataset.iconIndex));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-icon-example]").forEach((button) => {
    button.onclick = () => { input.value = button.dataset.iconExample!; input.focus(); void search(); };
  });
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
    const selected = editor.view.state.sliceDoc(from, to) || tr("链接文字");
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
          table: tr("\n| 名称 | 内容 |\n| --- | --- |\n| 示例 | 正文 |\n"),
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
  $("#selection-summary").textContent = tr("已选 {0} 字符", [length]);
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
    `<div class="editor-context-panel editor-context-main" role="menu" aria-label="${tr("编辑菜单")}">`,
    '<div class="editor-context-icons">',
    contextIcon("scissors", "cut", tr("剪切"), !selected),
    contextIcon("copy", "copy", tr("复制"), !selected),
    contextIcon("clipboard", "paste", tr("粘贴")),
    contextIcon("trash-2", "delete", tr("删除"), !selected),
    "</div>",
    contextSubmenu(
      tr("复制 / 粘贴为…"),
      [
        contextButton(tr("复制 Markdown"), "copy", "Ctrl+C", !selected),
        contextButton(tr("粘贴纯文本"), "paste", "Ctrl+V"),
        contextButton(tr("粘贴为引用"), "paste-quote"),
      ].join(""),
    ),
    '<div class="editor-context-divider"></div>',
    '<div class="editor-context-icons editor-context-format">',
    contextIcon("bold", "bold", tr("粗体")),
    contextIcon("italic", "italic", tr("斜体")),
    contextIcon("code", "inline-code", tr("行内代码")),
    contextIcon("link", "link", tr("链接")),
    contextIcon("quote", "quote", tr("引用")),
    contextIcon("list-ordered", "ordered", tr("有序列表")),
    contextIcon("list", "list", tr("无序列表")),
    contextIcon("check-circle-2", "task", tr("任务列表")),
    "</div>",
    '<div class="editor-context-divider"></div>',
    contextSubmenu(
      tr("段落"),
      [
        contextButton(tr("正文段落"), "paragraph"),
        contextButton(tr("一级标题"), "heading-1"),
        contextButton(tr("二级标题"), "heading-2"),
        contextButton(tr("三级标题"), "heading-3"),
        contextButton(tr("引用"), "quote"),
        contextButton(tr("有序列表"), "ordered"),
        contextButton(tr("无序列表"), "list"),
        contextButton(tr("任务列表"), "task"),
      ].join(""),
    ),
    contextSubmenu(
      tr("插入"),
      [
        contextButton(tr("图像"), "image", "Ctrl+Shift+I"),
        '<div class="editor-context-divider"></div>',
        contextButton(tr("脚注"), "footnote"),
        contextButton(tr("链接引用"), "reference"),
        contextButton(tr("水平分割线"), "rule"),
        contextButton(tr("表格"), "table", "Ctrl+T"),
        contextButton(tr("代码块"), "codeblock", "Ctrl+Shift+K"),
        contextButton(tr("公式块"), "math", "Ctrl+Shift+M"),
        contextButton(tr("内容目录"), "toc"),
        contextButton("YAML Front Matter", "yaml"),
        '<div class="editor-context-divider"></div>',
        contextButton(tr("段落（上方）"), "paragraph-above"),
        contextButton(tr("段落（下方）"), "paragraph-below"),
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
        toast(tr("无法访问剪贴板"), true);
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
    toast(tr("无法读取剪贴板"), true);
  }
}
function runEditorContextAction(action: string) {
  const editor = current()?.editor;
  if (!editor) return;
  closeEditorContextMenu();
  if (action === "icons") {
    openIconPicker();
    return;
  }
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
    editor.insert(tr("[^note]\n\n[^note]: 脚注内容"));
  else if (action === "reference")
    editor.insert(tr("[链接文字][ref]\n\n[ref]: https://"));
  else if (action === "rule") editor.insert("\n\n---\n\n");
  else if (action === "math") editor.insert("\n\n$$\nE = mc^2\n$$\n\n");
  else if (action === "toc") editor.insert("\n\n[TOC]\n\n");
  else if (action === "yaml") {
    if (view.state.doc.sliceString(0, 4) === "---\n") {
      toast(tr("文档已有 YAML Front Matter"));
      return;
    }
    view.dispatch({
      changes: { from: 0, insert: tr("---\ntitle: 标题\n---\n\n") },
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
  if (!(event.target as HTMLElement).closest("#sidebar-menu, #recent-section, .sidebar-more")) closeSidebarMenu();
});
const recentTrigger = $('[data-action="recent-menu"]');
recentTrigger.addEventListener("pointerenter", (event) => {
  if (event.pointerType !== "touch") void openRecentMenu();
});
recentTrigger.addEventListener("pointerleave", scheduleRecentClose);
recentTrigger.addEventListener("focus", () => void openRecentMenu());
recentTrigger.addEventListener("blur", scheduleRecentClose);
$("#recent-section").addEventListener("pointerenter", cancelRecentClose);
$("#recent-section").addEventListener("pointerleave", scheduleRecentClose);
$("#recent-section").addEventListener("focusin", cancelRecentClose);
$("#recent-section").addEventListener("focusout", scheduleRecentClose);
$("#sidebar-menu").addEventListener("pointerover", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (button && button !== recentTrigger) closeRecentMenu();
});
$("#sidebar-menu").addEventListener("scroll", positionRecentMenu);
window.addEventListener("resize", positionRecentMenu);
window.addEventListener("resize", () => {
  closeEditorContextMenu();
  hideSelectionToolbar();
});
$("#editor-stage").addEventListener("scroll", () => {
  closeEditorContextMenu();
  hideSelectionToolbar();
}, true);
let printInProgress = false;
async function printCurrent() {
  const tab = current();
  if (!tab) return;
  if (!requireNative() || printInProgress) return;
  printInProgress = true;
  const source = tab.text;
  const path = tab.path;
  const settings = prefs.render;
  let surface: PreviewSurface | undefined;
  let host: HTMLElement | undefined;
  let finished = false;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const previousFocus = document.activeElement as HTMLElement | null;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearTimeout(cleanupTimer);
    surface?.dispose();
    host?.remove();
    printInProgress = false;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  try {
    const result = await invoke<RenderResult>("render_markdown", {
      text: source,
      path: path || null,
      settings,
    });
    host = document.createElement("div");
    host.className = "print-surface-host";
    host.setAttribute("aria-hidden", "true");
    document.body.append(host);
    surface = new PreviewSurface();
    await surface.render(host, result, path, () => {}, {
      source,
      documentId: tab.id,
      renderAll: true,
    });
    const view = host.querySelector("iframe")?.contentWindow;
    if (!view) throw new Error(tr("打印预览未能载入"));
    view.addEventListener("afterprint", cleanup, { once: true });
    cleanupTimer = setTimeout(cleanup, 300000);
    view.focus();
    view.print();
  } catch (error) {
    cleanup();
    fail(error);
  }
}

const actions: Record<string, () => unknown> = {
  "sidebar-menu": toggleSidebarMenu,
  "recent-menu": openRecentMenu,
  "reopen-closed": reopenClosedFile,
  "clear-recent": clearRecentHistory,
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
    $("#workspace-name").textContent = tr("选择文件夹");
    $("#workspace-notice").hidden = true;
    renderSidebar();
    if (!current()) renderStartPage();
    renderedKey = "";
    scheduleRender();
    toast(tr("已关闭文件夹，打开的文档与未保存内容已保留"));
  },
  "render-info": () => {
    const tab = current();
    const plan = tab?.plan;
    modal(
      tr("当前渲染配置"),
      `<p>${plan ? tr("下列运行参数已用于最近一次预览；完整有效配置可在渲染设置中查看。") : tr("切换到阅读或分栏模式后生成运行参数。")}</p><pre class="build-log">${escapeHtml(JSON.stringify(plan ? { documentPath: tab?.path || null, ...plan, styles: plan.styles.map((s) => ({ source: s.source })) } : { documentPath: tab?.path || null }, null, 2))}</pre><div class="modal-actions"><button data-dismiss>${tr("关闭")}</button></div>`,
    );
  },
  open: () => openFile(),
  new: newNote,
  save: () => save(),
  saveas: () => save(current(), true),
  print: () => void printCurrent(),
  refresh,
  welcome: showStartPage,
  "recent-history": () => {
    if (document.body.classList.contains("sidebar-hidden")) actions.sidebar();
    if ($("#sidebar-menu").hidden) toggleSidebarMenu();
    void openRecentMenu();
  },
  sidebar: () => {
    const hidden = document.body.classList.toggle("sidebar-hidden");
    const button = $<HTMLButtonElement>(".status-sidebar-toggle");
    const label = hidden ? tr("展开导航") : tr("收起导航");
    button.title = `${label} Ctrl+Shift+L`;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon(hidden ? "panel-left-open" : "panel-left-close");
    icons();
  },
  focus: () => {
    if (!current()) return;
    const active = document.body.classList.toggle("focus-mode");
    $('[data-action="focus"]').setAttribute("aria-pressed", String(active));
  },
  settings: showSettings,
  theme: () => {
    prefs.theme = prefs.theme === "light" ? "dark" : prefs.theme === "dark" ? "system" : "light";
    applyPrefs();
  },
  insert: insertMenu,
  icons: openIconPicker,
  commands: commandPalette,
  external: showExternal,
  find: () => {
    if (!current()) return;
    if (mode === "read") openPreviewFind();
    else if (current()?.editor) openEditorSearchPanel(current()!.editor!.view);
  },
  replace: () => {
    if (mode === "read") setMode("source");
    if (current()?.editor) openEditorSearchPanel(current()!.editor!.view);
  },
};
function commandPalette() {
  if (document.querySelector(".command-palette")) { closeModal(); return; }
  closeModal();
  const previousFocus = document.activeElement as HTMLElement | null;
  modal(tr("快速操作"), commandPaletteMarkup());
  const root = $("#modal-root .modal");
  root.classList.add("command-palette");
  root.querySelector(".modal-title h2")!.insertAdjacentHTML("afterend", '<span class="command-invocation"><kbd>Ctrl</kbd><kbd>K</kbd></span>');
  modalDispose = mountCommandPalette(root, {
    note: !!current(), workspace: !!workspace, closed: closedFiles.length > 0,
  }, {
    execute: id => { closeModal(); actions[id]?.(); },
    close: closeModal,
    icons,
  }, previousFocus);
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
    if (!["sidebar-menu", "recent-menu", "clear-recent"].includes(action.dataset.action!))
      closeSidebarMenu();
    actions[action.dataset.action!]?.();
    return;
  }
  const recentFile = target.closest<HTMLElement>("[data-recent-file]");
  if (recentFile) {
    closeSidebarMenu();
    void openRecentFile(recentFile.dataset.recentFile!);
    return;
  }
  const recentFolder = target.closest<HTMLElement>("[data-recent-folder]");
  if (recentFolder) {
    closeSidebarMenu();
    void openRecentFolder(recentFolder.dataset.recentFolder!);
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
    if (e.isComposing) return;
    if (e.key === "Escape") {
      dismissFileMenu?.();
      closeSidebarMenu();
      closeEditorContextMenu();
      hideSelectionToolbar();
      closeModal();
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    dismissFileMenu?.();
    const key = e.key.toLowerCase();
    let action: string | undefined;
    if (key === "k" && !e.shiftKey) action = "commands";
    else if (key === "o") action = e.shiftKey ? "folder" : "open";
    else if (key === "n") action = "new";
    else if (key === "s") action = e.shiftKey ? "saveas" : "save";
    else if (key === "p" && !e.shiftKey) action = "print";
    else if (key === "l" && e.shiftKey) action = "sidebar";
    else if (key === "f") action = e.shiftKey ? "focus" : "find";
    else if (key === "h") action = "replace";
    else if (key === "t" && e.shiftKey) action = "reopen-closed";
    else if (key === "w") {
      e.preventDefault();
      if (document.querySelector(".command-palette")) closeModal();
      void closeTab(activeId);
      return;
    }
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      if (action !== "commands" && document.querySelector(".command-palette")) closeModal();
      actions[action]?.();
    }
  },
  true,
);
$("#file-filter").oninput = renderSidebar;
$("#sidebar-content").tabIndex = -1;
$("#sidebar-content").addEventListener("contextmenu", event => {
  if (!workspace || side !== "files") return;
  event.preventDefault(); showFileMenu(event.target as Element, event.clientX, event.clientY);
});
$("#sidebar-content").addEventListener("keydown", event => {
  if (!workspace || side !== "files" || event.isComposing) return;
  const target = fileTarget(event.target as Element);
  if (!target) return;
  if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
    event.preventDefault(); const bounds = target.origin.getBoundingClientRect();
    showFileMenu(target.origin, bounds.left + 24, bounds.top + bounds.height / 2);
  } else if (target.target.kind !== "root" && (event.key === "F2" || event.key === "Delete")) {
    event.preventDefault(); void fileAction(event.key === "F2" ? "rename" : "trash", target.target);
  }
});
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
let copyToast: HTMLElement | undefined;
$("#app").addEventListener("code-copy-feedback", (event) => {
  const { success } = (event as CustomEvent<{ success: boolean }>).detail;
  copyToast?.remove();
  copyToast = toast(success ? tr("代码已复制到剪贴板") : tr("复制失败，无法访问剪贴板"), !success);
});
$("#app").addEventListener("note-link", (event) => {
  const [href, fragment] = (event as CustomEvent<string>).detail.split("#", 2);
  const tab = current();
  if (!href || !tab?.path) return;
  try {
    void invoke<DiskDocument>("open_note_link", {
      document: tab.path,
      relative: decodeURIComponent(href),
    })
      .then((doc) => {
        addTab(doc);
        void rememberRecentFile(doc.path);
        let codeFragment = fragment;
        if (fragment) try { codeFragment = decodeURIComponent(fragment); } catch { /* Preserve literal percent. */ }
        if (codeFragment && /^__codelineno-[^:#]+-\d+(?::\d+)?$/.test(codeFragment)) {
          window.history.replaceState(null, "", `#${codeFragment}`);
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      })
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
      toast(tr("已同步磁盘上的更改"));
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
  document.documentElement.lang = prefs.language;
  document.documentElement.dir = languagePacks[prefs.language].direction;
  applyPrefs();
  showStartPage();
  setMode(mode);
  icons();
  if (native) {
    if (prefs.lastWorkspace)
      try {
        await setWorkspace(
          await invoke<Workspace>("restore_workspace", {
            path: prefs.lastWorkspace,
          }),
          false,
        );
      } catch {}
    await restoreDrafts();
    try {
      const doc = await invoke<DiskDocument | null>("startup_document");
      if (doc) { addTab(doc); await rememberRecentFile(doc.path); }
    } catch (e) { fail(e); }
    void invoke<{ versions: Record<string, string> }>("renderer_info")
      .then((r) => {
        $("#engine-label").textContent =
          tr("Zensical {0} · 已就绪", [r.versions.zensical]);
      })
      .catch((e) => {
        $("#engine-label").textContent = tr("渲染器未就绪");
        fail(e);
      });
    await getCurrentWindow().onCloseRequested(async (e) => {
      e.preventDefault();
      await persistRecovery();
      if (tabs.some((t) => t.dirty)) {
        const choice = await decisionDialog(
          tr("还有未保存的笔记"),
          tr("可以保存所有更改后退出，或保留恢复草稿，下次打开继续。"),
          [
            { id: "save", get label() { return tr("保存全部并退出"); }, primary: true },
            { id: "draft", get label() { return tr("保留草稿退出"); } },
            { id: "cancel", get label() { return tr("继续写作"); } },
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
  } else $("#engine-label").textContent = tr("浏览器演示 · 请运行桌面版");
  restoring = false;
  mounted = true;
  scheduleRecovery();
}
void start();
