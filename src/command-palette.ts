import { tr, onLanguageChange } from "./i18n";
import { escapeHtml } from "./preview";

type Group = "笔记" | "写作" | "界面";
interface Command {
  id: string;
  label: string;
  description: string;
  icon: string;
  group: Group;
  keys?: string[];
  aliases: string;
  needs?: "note" | "workspace" | "closed";
}
interface Context {
  note: boolean;
  workspace: boolean;
  closed: boolean;
}
const commands: Command[] = [
  { id: "new", label: "新建笔记", description: "从空白开始，写下一个想法", icon: "plus", group: "笔记", keys: ["Ctrl", "N"], aliases: "new create note 新建" },
  { id: "open", label: "打开笔记", description: "继续编辑一篇已有的笔记", icon: "file-text", group: "笔记", keys: ["Ctrl", "O"], aliases: "open file markdown 打开文件" },
  { id: "folder", label: "打开文件夹", description: "在左侧浏览和切换你的笔记", icon: "folder-open", group: "笔记", keys: ["Ctrl", "Shift", "O"], aliases: "open folder workspace 文件夹" },
  { id: "save", label: "保存笔记", description: "将当前笔记保存到本地", icon: "save", group: "笔记", keys: ["Ctrl", "S"], aliases: "save 保存", needs: "note" },
  { id: "saveas", label: "另存为", description: "选择新位置，保存一份副本", icon: "file-plus", group: "笔记", keys: ["Ctrl", "Shift", "S"], aliases: "save as copy 另存副本", needs: "note" },
  { id: "reopen-closed", label: "重新打开关闭的文件", description: "找回最近关闭的一篇笔记", icon: "refresh-cw", group: "笔记", keys: ["Ctrl", "Shift", "T"], aliases: "reopen closed 恢复关闭", needs: "closed" },
  { id: "print", label: "打印当前笔记", description: "打印排版后的笔记正文", icon: "download", group: "笔记", keys: ["Ctrl", "P"], aliases: "print 打印", needs: "note" },
  { id: "close-workspace", label: "关闭文件夹", description: "保留已打开的笔记和未保存内容", icon: "folder", group: "笔记", aliases: "close folder workspace 关闭文件夹", needs: "workspace" },
  { id: "find", label: "查找内容", description: "在当前笔记中查找文字", icon: "search", group: "写作", keys: ["Ctrl", "F"], aliases: "find search 查找搜索", needs: "note" },
  { id: "replace", label: "查找与替换", description: "查找文字并替换为新的内容", icon: "refresh-cw", group: "写作", keys: ["Ctrl", "H"], aliases: "find replace 替换", needs: "note" },
  { id: "insert", label: "插入扩展内容", description: "插入提示框、公式或其他内容", icon: "sparkles", group: "写作", aliases: "insert extension math 插入扩展公式", needs: "note" },
  { id: "icons", label: "在线选择图标", description: "搜索图标并插入笔记", icon: "smile", group: "写作", keys: ["Ctrl", "Shift", "E"], aliases: "icon 图标", needs: "note" },
  { id: "cards", label: "网格卡片", description: "创建 Material 网格卡片，保留可编辑的 Markdown 原文。", icon: "table", group: "写作", aliases: "grid cards material 卡片", needs: "note" },
  { id: "welcome", label: "返回起始页", description: "浏览最近使用记录，开始新的笔记", icon: "notebook-pen", group: "界面", aliases: "home start welcome 起始欢迎" },
  { id: "settings", label: "设置", description: "调整语言、主题和阅读习惯", icon: "settings", group: "界面", aliases: "settings preferences theme language 设置主题语言" },
  { id: "sidebar", label: "切换侧边栏", description: "显示或收起左侧导航", icon: "panel-left-close", group: "界面", keys: ["Ctrl", "Shift", "L"], aliases: "sidebar navigation 侧边导航" },
  { id: "focus", label: "切换专注模式", description: "收起界面，专心写作", icon: "focus", group: "界面", keys: ["Ctrl", "Shift", "F"], aliases: "focus 专注", needs: "note" },
  { id: "theme", label: "切换颜色模式", description: "切换亮色、暗色或跟随系统", icon: "sun", group: "界面", aliases: "theme light dark system 颜色明暗主题" },
  { id: "render-info", label: "查看当前渲染配置", description: "查看当前笔记的预览参数", icon: "code-2", group: "界面", aliases: "render configuration preview 渲染预览配置", needs: "note" },
];
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim();

export function commandPaletteMarkup() {
  return `<div class="command-search-wrap">${icon("search")}<input class="command-search" id="command-query" role="combobox" aria-label="${tr("搜索操作")}" aria-expanded="true" aria-controls="command-list" aria-autocomplete="list" placeholder="${tr("搜索操作或输入关键词…")}" autocomplete="off" spellcheck="false"><button class="command-clear icon-btn" aria-label="${tr("清空搜索")}" hidden>${icon("x")}</button></div>
    <div class="command-filters" role="group" aria-label="${tr("筛选操作")}"><button data-command-group="all" aria-pressed="true">${tr("全部")}</button>${(["笔记", "写作", "界面"] as Group[]).map(group => `<button data-command-group="${group}" aria-pressed="false">${tr(group)}</button>`).join("")}</div>
    <div class="command-results"><div class="command-list" id="command-list" role="listbox" aria-label="${tr("可用操作")}"></div><div class="command-empty" hidden>${icon("search")}<strong>${tr("没有找到匹配的操作")}</strong><span>${tr("试试「打开」「设置」或其他关键词。")}</span></div></div>
    <div class="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> ${tr("选择")}<kbd>Enter</kbd> ${tr("执行")}<kbd>Esc</kbd> ${tr("关闭")}</span><span id="command-count" role="status" aria-live="polite"></span></div>`;
}

export function mountCommandPalette(
  root: HTMLElement,
  context: Context,
  callbacks: { execute: (id: string) => void; close: () => void; icons: () => void },
  previousFocus: HTMLElement | null,
) {
  const session = new AbortController();
  root.parentElement?.addEventListener("pointerdown", event => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      callbacks.close();
    }
  }, { signal: session.signal });
  const input = root.querySelector<HTMLInputElement>("#command-query")!;
  const list = root.querySelector<HTMLElement>(".command-list")!;
  const clear = root.querySelector<HTMLButtonElement>(".command-clear")!;
  let available: Command[] = [];
  let selected: string | undefined;
  let group: Group | "all" = "all";
  const disabled = (command: Command) => command.needs !== undefined && !context[command.needs];
  const disabledReason = (command: Command) => tr(command.needs === "closed" ? "没有最近关闭的文件" : command.needs === "workspace" ? "先打开一个文件夹" : "先打开一篇笔记");
  const select = (id: string | undefined, scroll = false, focus = false) => {
    selected = id;
    list.querySelectorAll<HTMLButtonElement>("[data-command]").forEach(button => {
      const active = button.dataset.command === id;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const button = id ? list.querySelector<HTMLElement>(`[data-command="${id}"]`) : null;
    if (button) input.setAttribute("aria-activedescendant", button.id);
    else input.removeAttribute("aria-activedescendant");
    if (scroll) button?.scrollIntoView({ block: "nearest" });
    if (focus) button?.focus({ preventScroll: true });
  };
  const render = () => {
    const query = normalize(input.value);
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = commands.filter(command => {
      if (group !== "all" && command.group !== group) return false;
      const text = normalize([tr(command.label), tr(command.description), tr(command.group), command.label, command.aliases, command.keys?.join(" ")].join(" "));
      return terms.every(term => text.includes(term));
    });
    available = matches.filter(command => !disabled(command));
    list.innerHTML = (["笔记", "写作", "界面"] as Group[]).map(group => {
      const entries = matches.filter(command => command.group === group);
      if (!entries.length) return "";
      return `<div class="command-group" role="group" aria-label="${tr(group)}"><h3 aria-hidden="true">${tr(group)}</h3>${entries.map(command => {
        const inactive = disabled(command);
        return `<button class="command-row" id="command-${command.id}" data-command="${command.id}" role="option" aria-selected="false" ${inactive ? 'disabled aria-disabled="true"' : ""} tabindex="-1"><span class="command-icon">${icon(command.icon)}</span><span class="command-label"><strong>${escapeHtml(tr(command.label))}</strong><small>${escapeHtml(inactive ? disabledReason(command) : tr(command.description))}</small></span><span class="command-keys">${(command.keys || []).map(key => `<kbd>${key}</kbd>`).join("")}</span><span class="command-execute" aria-hidden="true">↵</span></button>`;
      }).join("")}</div>`;
    }).join("");
    root.querySelector<HTMLElement>(".command-empty")!.hidden = matches.length > 0;
    root.querySelector<HTMLElement>("#command-count")!.textContent = tr("{0} 个可用操作", [available.length]);
    clear.hidden = !input.value;
    root.querySelectorAll<HTMLButtonElement>("[data-command-group]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.commandGroup === group)));
    select(available.some(command => command.id === selected) ? selected : available[0]?.id);
    root.querySelector<HTMLElement>(".command-results")!.scrollTop = 0;
    callbacks.icons();
  };
  input.addEventListener("input", render, { signal: session.signal });
  clear.addEventListener("click", () => { input.value = ""; render(); input.focus(); }, { signal: session.signal });
  root.querySelectorAll<HTMLButtonElement>("[data-command-group]").forEach(button => {
    button.addEventListener("click", () => { group = button.dataset.commandGroup as Group | "all"; render(); input.focus(); }, { signal: session.signal });
  });
  list.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-command]");
    if (button && !button.disabled) callbacks.execute(button.dataset.command!);
  }, { signal: session.signal });
  list.addEventListener("pointermove", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-command]");
    if (button && !button.disabled && button.dataset.command !== selected) select(button.dataset.command);
  }, { signal: session.signal });
  root.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      callbacks.close();
    } else if (["ArrowDown", "ArrowUp"].includes(event.key) && (event.target === input || (event.target as Element).matches("[data-command]"))) {
      event.preventDefault();
      const index = available.findIndex(command => command.id === selected);
      const next = (index + (event.key === "ArrowDown" ? 1 : -1) + available.length) % available.length;
      select(available[next]?.id, true, (event.target as Element).matches("[data-command]"));
    } else if (event.key === "Enter" && (event.target === input || (event.target as Element).matches("[data-command]"))) {
      event.preventDefault();
      if (selected) callbacks.execute(selected);
    } else if (event.key === "Tab") {
      const controls = [...root.querySelectorAll<HTMLElement>("button, input")].filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, { signal: session.signal });
  render();
  input.focus();
  const disposeLanguage = onLanguageChange(render);
  return () => {
    session.abort();
    disposeLanguage();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
}
