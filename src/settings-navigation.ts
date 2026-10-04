import { tr } from "./i18n";
const settingsPages = [
  { id: "appearance", get label() { return tr("外观"); }, icon: "sun", get description() { return tr("为亮色与暗色模式选择配色，调整界面与正文的显示。"); }, get group() { return tr("常用设置"); } },
  { id: "reading", get label() { return tr("阅读"); }, icon: "book-open", get description() { return tr("调整正文排版与阅读时的交互，预览会实时更新。"); }, get group() { return tr("常用设置"); } },
  { id: "writing", get label() { return tr("写作与保存"); }, icon: "notebook-pen", get description() { return tr("设置编辑与预览的同步方式，以及笔记保存习惯。"); }, get group() { return tr("常用设置"); } },
  { id: "files", get label() { return tr("文件打开"); }, icon: "folder-open", get description() { return tr("设置系统打开文件时的界面，以及正常启动时的行为。"); }, get group() { return tr("常用设置"); } },
  { id: "math", get label() { return tr("公式"); }, icon: "hash", get description() { return tr("选择数学公式引擎，设置排版规则与自定义命令。"); }, group: "Markdown" },
  { id: "extensions", get label() { return tr("语法扩展"); }, icon: "sparkles", get description() { return tr("按需启用 Markdown 扩展，并调整每项扩展的选项。"); }, group: "Markdown" },
  { id: "advanced", get label() { return tr("高级"); }, icon: "code-2", get description() { return tr("调整组件样式、自定义 CSS，或导入与导出渲染配置。"); }, group: "Markdown" },
  { id: "profiles", get label() { return tr("配置管理"); }, icon: "folder", get description() { return tr("保存常用的渲染配置，方便在不同类型的笔记之间切换。"); }, group: "Markdown" },
  { id: "updates", get label() { return tr("关于与更新"); }, icon: "info", get description() { return tr("查看版本信息，检查 GitHub 上的新版本。"); }, get group() { return tr("应用"); } },
] as const;

export function settingsNavigationMarkup() {
  return `<aside class="settings-sidebar"><nav class="settings-navigation" role="tablist" aria-label="${tr("设置分类")}" aria-orientation="vertical">${settingsPages.map((page, i) => `${!i || page.group !== settingsPages[i - 1].group ? `<span class="settings-nav-group" aria-hidden="true">${page.group}</span>` : ""}<button type="button" role="tab" id="settings-tab-${page.id}" data-settings-tab="${page.id}" aria-controls="settings-panel-${page.id}" aria-selected="${!i}" tabindex="${i ? -1 : 0}"><i data-lucide="${page.icon}"></i><span>${page.label}</span></button>`).join("")}</nav><div class="settings-sidebar-caption">ZNote<span>${tr("本地 Markdown 编辑器")}</span></div></aside>`;
}

export function settingsPageHeading(id: string) {
  const page = settingsPages.find(page => page.id === id)!;
  return `<header class="settings-page-heading"><h2>${page.label}</h2><p>${page.description}</p></header>`;
}

/** Switch visibility without replacing controls, retaining drafts and per-page scroll. */
export function mountSettingsNavigation(root: HTMLElement) {
  const session = new AbortController();
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"));
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-settings-panel]"));
  const content = root.querySelector<HTMLElement>(".settings-content")!;
  const navigation = root.querySelector<HTMLElement>(".settings-navigation")!;
  const narrowWindow = matchMedia("(max-width: 540px)");
  const syncOrientation = () => navigation.setAttribute("aria-orientation", narrowWindow.matches ? "horizontal" : "vertical");
  syncOrientation();
  narrowWindow.addEventListener("change", syncOrientation, { signal: session.signal });
  const scrollPositions = new Map<string, number>();
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  let selected = "appearance";

  for (const panel of panels) {
    panel.id = `settings-panel-${panel.dataset.settingsPanel}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `settings-tab-${panel.dataset.settingsPanel}`);
    panel.tabIndex = 0;
  }
  const select = (tab: HTMLButtonElement, focus = false) => {
    const next = tab.dataset.settingsTab!;
    scrollPositions.set(selected, content.scrollTop);
    selected = next;
    for (const item of tabs) {
      item.setAttribute("aria-selected", String(item === tab));
      item.tabIndex = item === tab ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.settingsPanel !== next;
    content.scrollTop = scrollPositions.get(next) ?? 0;
    if (focus) tab.focus();
  };
  select(tabs[0]);

  root.addEventListener("click", event => {
    const tab = (event.target as Element).closest<HTMLButtonElement>("[data-settings-tab]");
    if (tab) select(tab);
  }, { signal: session.signal });
  root.addEventListener("keydown", event => {
    const tab = (event.target as Element).closest<HTMLButtonElement>("[data-settings-tab]");
    if (tab) {
      const index = tabs.indexOf(tab);
      let next: number | undefined;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        select(tabs[next], true);
      }
    }
    if (event.key === "Tab") {
      const controls = Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], iframe, [tabindex]'))
        .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }, { signal: session.signal });
  return () => {
    session.abort();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
}
