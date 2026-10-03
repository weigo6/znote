import { tr, onLanguageChange } from "./i18n";
import { escapeHtml } from "./preview";

export type FileView = "tree" | "list";
export interface FileTarget { path: string; name: string; kind: "file" | "folder" | "root" }
export type FileAction = "open" | "window" | "new" | "folder" | "search" | "list" | "tree" | "rename" | "duplicate" | "trash" | "properties" | "copy-path" | "reveal";

export function parentPath(path: string) {
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  const parent = path.slice(0, separator);
  return separator === 0 || /(?:^|\\)[a-z]:$/i.test(parent) ? path.slice(0, separator + 1) : parent;
}
export function isWithin(path: string | undefined, ancestor: string) {
  if (!path) return false;
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  const source = normalize(path), root = normalize(ancestor);
  return source === root || source.startsWith(root + "/");
}
export function renamedPath(path: string, source: string, destination: string) {
  return isWithin(path, source) ? destination + path.slice(source.length) : path;
}

export function mountFileMenu(root: HTMLElement, target: FileTarget, view: FileView,
  point: { x: number; y: number }, origin: HTMLElement,
  callbacks: { execute: (action: FileAction, target: FileTarget) => void; icons: () => void; closed: () => void }) {
  const item = (action: FileAction, label: string, glyph: string, shortcut = "") => {
    const radio = action === "tree" || action === "list";
    return `<button type="button" role="${radio ? "menuitemradio" : "menuitem"}" ${radio ? `aria-checked="${view === action}"` : ""} data-file-action="${action}" class="${action === "trash" ? "danger" : ""}" tabindex="-1"><span class="file-menu-icon" aria-hidden="true"><i data-lucide="${radio ? view === action ? "check" : "" : glyph}"></i></span><span>${escapeHtml(tr(label))}</span><kbd aria-hidden="true">${shortcut}</kbd></button>`;
  };
  const divider = '<div class="file-menu-divider" role="separator"></div>';
  root.innerHTML = `<section class="file-context-menu" role="menu" aria-label="${tr("文件菜单")}"><header class="file-menu-heading" title="${escapeHtml(target.path)}"><i data-lucide="${target.kind === "file" ? "file-text" : "folder"}"></i><span>${escapeHtml(target.name)}</span></header>
    ${target.kind === "file" ? item("open", "打开", "file-text", "Enter") + item("window", "在新窗口中打开", "external-link") + divider : ""}
    ${item("new", "新建文件", "file-plus")}${item("folder", "新建文件夹", "folder")}${divider}
    ${item("search", "搜索文件", "search")}${divider}
    ${item("list", "文档列表", "list")}${item("tree", "文档树", "folder")}${divider}
    ${target.kind !== "root" ? item("rename", "重命名", "notebook-pen", "F2") + (target.kind === "file" ? item("duplicate", "创建副本", "copy") : "") + divider + item("trash", "删除", "trash-2", "Del") + divider : ""}
    ${item("properties", "属性", "file-text")}${item("copy-path", "复制文件路径", "copy")}${item("reveal", "打开文件位置", "folder-open")}</section>`;
  callbacks.icons();
  const menu = root.firstElementChild as HTMLElement;
  menu.style.maxHeight = `${innerHeight - 16}px`;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(point.x, innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(point.y, innerHeight - bounds.height - 8))}px`;
  const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
  let selected = 0, disposed = false;
  const select = (index: number, focus = true) => {
    selected = (index + buttons.length) % buttons.length;
    buttons.forEach((button, i) => { button.tabIndex = i === selected ? 0 : -1; });
    if (focus) { buttons[selected].focus({ preventScroll: true }); buttons[selected].scrollIntoView({ block: "nearest" }); }
  };
  const dispose = (restoreFocus = true) => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("focusin", blur);
    window.removeEventListener("resize", resize);
    document.removeEventListener("scroll", scroll, true);
    unsubscribe();
    root.replaceChildren();
    origin.classList.remove("context-target");
    if (restoreFocus && origin.isConnected) origin.focus({ preventScroll: true });
    callbacks.closed();
  };
  const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) dispose(false); };
  const blur = (event: FocusEvent) => { if (!menu.contains(event.target as Node)) dispose(false); };
  const resize = () => dispose();
  const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) dispose(false); };
  const unsubscribe = onLanguageChange(() => dispose(false));
  origin.classList.add("context-target");
  menu.addEventListener("pointermove", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (button && document.activeElement !== button) select(buttons.indexOf(button));
  });
  menu.addEventListener("click", event => {
    const action = (event.target as Element).closest<HTMLElement>("[data-file-action]")?.dataset.fileAction as FileAction | undefined;
    if (action) { dispose(); callbacks.execute(action, target); }
  });
  menu.addEventListener("keydown", event => {
    if (event.isComposing) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index >= 0) selected = index;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); select(selected + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); select(event.key === "Home" ? 0 : buttons.length - 1);
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault(); event.stopPropagation(); dispose();
    }
  });
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("focusin", blur);
  document.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", resize);
  select(0);
  return dispose;
}
