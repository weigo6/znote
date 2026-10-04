import type { EditorView } from "@codemirror/view";
import {
  formattingState,
  formattingSteps,
  type FormattingState,
} from "./editor-commands";
import {
  syntaxTree,
  syntaxTreeAvailable,
  ensureSyntaxTree,
} from "@codemirror/language";
import { editorCommand, commandShortcut } from "./editor-command-registry";
export { requiredExtensions } from "./editor-command-registry";
import { materialSnippets } from "./material-snippets";
import { tr } from "./i18n";
import { escapeHtml as esc } from "./preview";

type Menu = "paragraph" | "list" | "material" | "more" | "admonition";
interface Item {
  action?: string;
  label: string;
  icon?: string;
  shortcut?: string;
  checked?: boolean | "mixed";
  reason?: string;
  submenu?: Menu;
}
interface Options {
  editor(): EditorView | undefined;
  mode(): string;
  command(action: string): void;
  setMode(mode: "source" | "split" | "read"): void;
  missing(action: string): string[];
  icons(root?: ParentNode): void;
}
const icon = (name: string) =>
  `<i data-lucide="${name}" aria-hidden="true"></i>`;
const headingNames = [
  "段落",
  "一级标题",
  "二级标题",
  "三级标题",
  "四级标题",
  "五级标题",
  "六级标题",
];

/** Menus retain the source selection; commands only run on the document that opened them. */
export class EditorToolbar {
  private menu?: Menu;
  private opener?: HTMLButtonElement;
  private saved?: {
    view: EditorView;
    doc: EditorView["state"]["doc"];
    selection: EditorView["state"]["selection"];
  };
  private popover: HTMLDivElement;
  private size = "wide";
  private readonly session = new AbortController();
  private readonly observer: ResizeObserver;
  private frame = 0;
  private scanTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private renderedState = "";
  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document | Window,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    capture = false,
  ) {
    target.addEventListener(type, handler as EventListener, {
      capture,
      signal: this.session.signal,
    });
  }
  private parentMenu(): Menu {
    return this.opener?.dataset.toolbarMenu === "paragraph"
      ? "paragraph"
      : "material";
  }
  destroy() {
    this.generation++;
    clearTimeout(this.scanTimer);
    cancelAnimationFrame(this.frame);
    this.session.abort();
    this.observer.disconnect();
    this.close(false);
    this.popover.remove();
  }
  private schedulePosition() {
    if (!this.menu || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.position();
    });
  }
  constructor(
    private root: HTMLElement,
    private options: Options,
  ) {
    root.classList.add("structured-toolbar");
    this.popover = document.createElement("div");
    this.popover.className = "editor-toolbar-menu";
    this.popover.hidden = true;
    document.body.append(this.popover);
    this.render();
    this.listen(root, "pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button"))
        event.preventDefault();
    });
    this.listen(root, "click", (event) => {
      event.stopPropagation();
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      );
      if (!button || button.disabled) return;
      if (button.dataset.toolbarMenu)
        this.open(button.dataset.toolbarMenu as Menu, button, false);
      else if (button.dataset.command) {
        this.close(false);
        options.command(button.dataset.command);
      } else if (button.hasAttribute("data-toolbar-return")) {
        this.close(false);
        options.setMode("source");
        options.editor()?.focus();
      } else if (button.dataset.mode) {
        this.close(false);
        options.setMode(button.dataset.mode as "source" | "split" | "read");
      }
    });
    this.listen(root, "keydown", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-toolbar-menu]",
      );
      if (button && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        this.open(button.dataset.toolbarMenu as Menu, button, true);
      }
    });
    this.listen(root, "change", (event) => {
      const select = (event.target as HTMLElement).closest<HTMLSelectElement>(
        "[data-toolbar-mode]",
      );
      if (select) options.setMode(select.value as "source" | "split" | "read");
    });
    this.listen(this.popover, "pointerdown", (event) =>
      event.stopPropagation(),
    );
    this.listen(this.popover, "click", (event) => {
      event.stopPropagation();
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      );
      if (!button || button.disabled) return;
      if (button.dataset.submenu) {
        this.showMenu(button.dataset.submenu as Menu);
        this.focusItem(0);
        return;
      }
      if (button.dataset.back) {
        this.showMenu(button.dataset.back as Menu);
        this.focusItem(0);
        return;
      }
      if (!this.restore()) {
        this.close(false);
        return;
      }
      const action = button.dataset.command;
      this.close(false);
      if (action) options.command(action);
    });
    this.listen(this.popover, "keydown", (event) => {
      const buttons = this.buttons(),
        index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        this.focusItem(
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length,
        );
      } else if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        this.close(event.key === "Escape", true);
      } else if (event.key === "ArrowRight") {
        const target = document.activeElement as HTMLButtonElement;
        if (target.dataset.submenu) {
          event.preventDefault();
          this.showMenu(target.dataset.submenu as Menu);
          this.focusItem(0);
        }
      } else if (event.key === "ArrowLeft" && this.menu === "admonition") {
        event.preventDefault();
        this.showMenu(this.parentMenu());
        this.focusItem(0);
      }
    });
    this.listen(document, "pointerdown", (event) => {
      if (
        !root.contains(event.target as Node) &&
        !this.popover.contains(event.target as Node)
      )
        this.close(false);
    });
    this.listen(
      document,
      "keydown",
      (event) => {
        if (event.key === "Escape" && this.menu) {
          event.preventDefault();
          this.close(true);
        }
      },
      true,
    );
    this.listen(window, "resize", () => this.schedulePosition());
    this.listen(document, "scroll", () => this.schedulePosition(), true);
    this.observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      const size = width >= 780 ? "wide" : width >= 600 ? "compact" : "narrow";
      if (this.size !== size) {
        this.size = size;
        root.dataset.size = size;
        this.close(false);
      }
    });
    this.observer.observe(root);
    this.refresh();
  }
  private render() {
    const command = (action: string, name: string, glyph: string, extra = "") =>
      `<button type="button" class="toolbar-button ${extra}" data-command="${action}" data-format="${action}" aria-label="${esc(tr(name))}" title="${esc(tr(name))}">${icon(glyph)}</button>`;
    const menu = (key: Menu, name: string, glyph?: string, iconOnly = false) =>
      `<button type="button" class="toolbar-button toolbar-dropdown${iconOnly ? " toolbar-icon-dropdown" : ""}" data-toolbar-menu="${key}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(tr(name))}">${glyph ? icon(glyph) : ""}${iconOnly ? "" : `<span>${esc(tr(name))}</span>`}${icon("chevron-down")}</button>`;
    this.root.innerHTML = `<div class="format-tools" role="toolbar" aria-label="${tr("编辑工具栏")}">
      <div class="toolbar-group">${menu("paragraph", "段落")}</div>
      <div class="toolbar-group toolbar-inline">${command("bold", "粗体 Ctrl+B", "bold")}${command("italic", "斜体 Ctrl+I", "italic")}${command("inline-code", "行内代码", "code")}${command("link", "插入链接", "link", "toolbar-secondary")}</div>
      <div class="toolbar-group toolbar-media">${command("image", "插入图片", "image")}${command("quote", "引用", "quote")}</div>
      <div class="toolbar-group toolbar-list">${menu("list", "列表", "list", true)}</div>
      <div class="toolbar-group toolbar-features"><button type="button" class="toolbar-button toolbar-feature" data-command="icons" aria-label="${tr("在线选择图标")}" data-tooltip="${tr("在线选择图标 Ctrl+Shift+E")}">${icon("smile")}</button><button type="button" class="toolbar-button toolbar-feature" data-command="cards" aria-label="${tr("卡片")}" data-tooltip="${tr("网格卡片")}">${icon("layout-grid")}</button>${menu("material", "Material", "sparkles", true)}</div>
      <div class="toolbar-group">${menu("more", "更多")}</div></div>
      <button type="button" class="toolbar-return" data-toolbar-return>${icon("code-2")}${tr("返回编辑")}</button>
      <div class="view-modes" role="group" aria-label="${tr("编辑模式")}">${(["source", "split", "read"] as const).map((mode, i) => `<button type="button" data-mode="${mode}" aria-label="${tr(["Markdown 编辑", "Python Markdown 对照预览", "阅读模式"][i])}">${icon(["code-2", "columns-2", "book-open"][i])}<span>${tr(["编辑", "对照", "阅读"][i])}</span></button>`).join("")}</div>
      <select class="toolbar-mode-select" data-toolbar-mode aria-label="${tr("编辑模式")}"><option value="source">${tr("编辑")}</option><option value="split">${tr("对照")}</option><option value="read">${tr("阅读")}</option></select>`;
    this.renderedState = "";
    this.options.icons(this.root);
  }
  refreshLanguage() {
    this.close(false);
    this.render();
    this.refresh();
  }
  showMaterial() {
    const opener = this.root.querySelector<HTMLButtonElement>(
      '[data-toolbar-menu="material"]',
    );
    if (opener && !opener.disabled) this.open("material", opener, true);
  }
  refresh() {
    if (this.session.signal.aborted) return;
    const generation = ++this.generation;
    clearTimeout(this.scanTimer);
    const view = this.options.editor();
    if (
      this.saved &&
      (this.saved.view !== view || this.saved.doc !== view?.state.doc)
    )
      this.close(false);
    if (!view) {
      this.root.removeAttribute("aria-busy");
      this.renderState();
      return;
    }
    const state = view.state;
    let steps = syntaxTreeAvailable(state, state.selection.main.to)
      ? formattingSteps(
          state,
          ensureSyntaxTree(state, state.selection.main.to, 0) ??
            syntaxTree(state),
        )
      : undefined;
    const later = () => {
      this.root.setAttribute("aria-busy", "true");
      this.scanTimer = setTimeout(scan, 0);
    };
    const scan = () => {
      if (
        generation !== this.generation ||
        this.options.editor() !== view ||
        view.state.doc !== state.doc ||
        !view.state.selection.eq(state.selection)
      )
        return;
      // Parsing distant selections happens after dispatch, in bounded slices.
      // Never infer a definitive mixed/false state from an incomplete tree.
      if (!steps) {
        const parsed = ensureSyntaxTree(state, state.selection.main.to, 3);
        if (!parsed) {
          later();
          return;
        }
        steps = formattingSteps(state, parsed);
        later();
        return;
      }
      const deadline = performance.now() + 3;
      let result;
      do {
        result = steps.next();
      } while (!result.done && performance.now() < deadline);
      if (result.done) {
        this.root.removeAttribute("aria-busy");
        this.renderState(result.value);
      } else {
        later();
      }
    };
    if (steps) scan();
    else later();
  }
  private renderState(state?: FormattingState) {
    const view = this.options.editor();
    const buttons = this.root.querySelectorAll<HTMLButtonElement>(
      "[data-command], [data-toolbar-menu]",
    );
    const missingByAction = new Map(
      Array.from(buttons, (button) => [
        button.dataset.command,
        button.dataset.command
          ? this.options.missing(button.dataset.command)
          : [],
      ]),
    );
    const key = JSON.stringify([
      !!view,
      this.options.mode(),
      state,
      [...missingByAction],
    ]);
    if (key === this.renderedState) return;
    this.renderedState = key;
    if (
      this.saved &&
      (this.saved.view !== view || this.saved.doc !== view?.state.doc)
    )
      this.close(false);
    this.root.dataset.read = String(this.options.mode() === "read");
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-command], [data-toolbar-menu]",
    )) {
      const action = button.dataset.command;
      const missing = missingByAction.get(action) ?? [];
      button.disabled = !view || (missing.length > 0 && action !== "cards");
      button.title = missing.length
        ? tr("需要启用：{0}", [missing.join(", ")])
        : button.dataset.tooltip ||
          button.getAttribute("aria-label") ||
          tr("网格卡片");
      if (action && ["bold", "italic", "inline-code", "quote"].includes(action))
        button.setAttribute(
          "aria-pressed",
          String(
            state?.[
              action === "inline-code"
                ? "code"
                : (action as "bold" | "italic" | "quote")
            ] ?? false,
          ),
        );
    }
    const paragraph = this.root.querySelector<HTMLButtonElement>(
      '[data-toolbar-menu="paragraph"]',
    )!;
    const label =
      state?.block === "mixed"
        ? tr("混合格式")
        : tr(headingNames[Number(state?.block.slice(8)) || 0]);
    paragraph.querySelector("span")!.textContent = label;
    paragraph.setAttribute("aria-label", label);
    const list = this.root.querySelector<HTMLButtonElement>(
      '[data-toolbar-menu="list"]',
    )!;
    list.setAttribute("aria-pressed", String(!!state?.list));
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-mode]",
    )) {
      button.classList.toggle(
        "active",
        button.dataset.mode === this.options.mode(),
      );
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.mode === this.options.mode()),
      );
    }
    this.root.querySelector<HTMLSelectElement>("[data-toolbar-mode]")!.value =
      this.options.mode();
  }
  private items(menu: Menu): (Item | null)[] {
    const state = this.saved && formattingState(this.saved.view.state, true);
    const item = (
      action: string,
      label: string,
      glyph?: string,
      checked?: boolean | "mixed",
      shortcut?: string,
    ): Item => {
      const missing = this.options.missing(action);
      return {
        action,
        label: tr(
          action.startsWith("material:")
            ? label
            : (editorCommand(action)?.label ?? label),
        ),
        icon: glyph,
        checked,
        shortcut: commandShortcut(action) ?? shortcut,
        reason: missing.length
          ? tr("需要启用：{0}", [missing.join(", ")])
          : undefined,
      };
    };
    if (menu === "paragraph")
      return [
        ...headingNames
          .slice(1)
          .map((name, i) =>
            item(
              `heading-${i + 1}`,
              name,
              undefined,
              state?.block === `heading-${i + 1}`,
              `Ctrl+Alt+${i + 1}`,
            ),
          ),
        item(
          "paragraph",
          "段落",
          undefined,
          state?.block === "paragraph",
          "Ctrl+Alt+0",
        ),
        null,
        item("table", "表格", "table"),
        item("codeblock", "代码块", "code-2", undefined, "Ctrl+Shift+K"),
        item("math", "公式块", "sigma"),
        { label: tr("提示框"), icon: "message-square", submenu: "admonition" },
        item("rule", "水平分割线", "minus"),
      ];
    if (menu === "list")
      return [
        item("ordered", "有序列表", "list-ordered", state?.list === "ordered"),
        item("list", "无序列表", "list", state?.list === "list"),
        item("task", "任务列表", "list-todo", state?.list === "task"),
      ];
    if (menu === "admonition")
      return materialSnippets
        .filter((s) => s.id.startsWith("admonition-"))
        .map((s) => item(`material:${s.id}`, s.name, s.icon));
    if (menu === "material")
      return [
        { label: tr("提示框"), icon: "message-square", submenu: "admonition" },
        ...materialSnippets
          .filter((s) => !s.id.startsWith("admonition-"))
          .map((s) => item(`material:${s.id}`, s.name, s.icon)),
        null,
        item("settings", "渲染设置", "settings"),
      ];
    return [
      ...(this.size === "narrow"
        ? [
            item("bold", "粗体 Ctrl+B", "bold", state?.bold),
            item("italic", "斜体 Ctrl+I", "italic", state?.italic),
            item("inline-code", "行内代码", "code", state?.code),
          ]
        : []),
      ...(this.size !== "wide"
        ? [
            item("link", "插入链接", "link"),
            item("image", "插入图片", "image"),
            item("quote", "引用", "quote", state?.quote),
            ...this.items("list"),
            null,
          ]
        : []),
      item("strikethrough", "删除线", undefined, state?.strikethrough),
      item("footnote", "脚注"),
      item("reference", "引用链接"),
      item("toc", "目录"),
      item("yaml", "YAML Front Matter"),
      null,
      item("settings", "渲染设置", "settings"),
    ];
  }
  private open(menu: Menu, opener: HTMLButtonElement, focus: boolean) {
    if (this.menu === menu && this.opener === opener) {
      this.close(true);
      return;
    }
    const view = this.options.editor();
    if (!view) return;
    this.close(false);
    this.saved = { view, doc: view.state.doc, selection: view.state.selection };
    this.opener = opener;
    opener.setAttribute("aria-expanded", "true");
    this.showMenu(menu);
    if (focus) this.focusItem(0);
  }
  private showMenu(menu: Menu) {
    this.menu = menu;
    const back =
      menu === "admonition"
        ? `<button type="button" role="menuitem" data-back="${this.parentMenu()}">${icon("chevron-left")}<span>${tr("返回")}</span></button><div role="separator"></div>`
        : "";
    const items = this.items(menu);
    const hasLeadingIcon = items.some(
      (item) => item?.checked !== undefined || !!item?.icon,
    );
    const menuLabel = tr(
      menu === "admonition"
        ? "提示框"
        : menu === "material"
          ? "Material"
          : menu === "list"
            ? "列表"
            : menu === "more"
              ? "更多"
              : "段落",
    );
    const rows = items
      .map((item) => {
        if (!item) return '<div role="separator"></div>';
        const role =
          item.checked === undefined
            ? "menuitem"
            : /^(heading-\d|paragraph|ordered|list|task)$/.test(
                  item.action ?? "",
                )
              ? "menuitemradio"
              : "menuitemcheckbox";
        const checked =
          item.checked !== undefined ? `aria-checked="${item.checked}"` : "";
        const action = item.action
          ? `data-command="${item.action}"`
          : `data-submenu="${item.submenu}" aria-haspopup="menu"`;
        const disabled = item.reason
          ? `disabled title="${esc(item.reason)}"`
          : "";
        const leadingIcon =
          item.checked === "mixed"
            ? "−"
            : item.checked
              ? icon("check")
              : item.icon
                ? icon(item.icon)
                : "";
        const glyph = hasLeadingIcon
          ? `<span class="toolbar-menu-icon" aria-hidden="true">${leadingIcon}</span>`
          : "";
        const description = item.reason
          ? `<small class="toolbar-menu-description">${esc(item.reason)}</small>`
          : "";
        const trailing = item.submenu
          ? icon("chevron-right")
          : item.shortcut
            ? `<kbd>${esc(item.shortcut)}</kbd>`
            : "";
        return `<button type="button" role="${role}" ${checked} ${action} ${disabled}>${glyph}<span class="toolbar-menu-label">${esc(item.label)}</span><span class="toolbar-menu-trailing">${trailing}</span>${description}</button>`;
      })
      .join("");
    this.popover.innerHTML = `<div role="menu" aria-label="${esc(menuLabel)}" data-has-leading-icon="${hasLeadingIcon}">${back}${rows}</div>`;
    this.popover.hidden = false;
    this.options.icons(this.popover);
    this.position();
  }
  private buttons() {
    return Array.from(
      this.popover.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
  }
  private focusItem(index: number) {
    this.buttons()[index]?.focus({ preventScroll: true });
  }
  private position() {
    if (!this.menu || !this.opener) return;
    const anchor = this.opener.getBoundingClientRect();
    const box = this.popover.getBoundingClientRect(),
      gap = 6;
    this.popover.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8))}px`;
    const below = anchor.bottom + gap;
    this.popover.style.top = `${Math.max(8, Math.min(below, innerHeight - box.height - 8))}px`;
  }
  private restore() {
    const saved = this.saved;
    if (
      !saved ||
      this.options.editor() !== saved.view ||
      saved.view.state.doc !== saved.doc
    )
      return false;
    if (!saved.view.state.selection.eq(saved.selection))
      saved.view.dispatch({ selection: saved.selection });
    return true;
  }
  close(restore: boolean, focusButton = false) {
    const opener = this.opener;
    if (restore && this.restore()) this.saved!.view.focus();
    this.popover.hidden = true;
    opener?.setAttribute("aria-expanded", "false");
    this.menu = undefined;
    this.saved = undefined;
    this.opener = undefined;
    if (focusButton) opener?.focus();
  }
}
