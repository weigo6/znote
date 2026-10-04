import type { EditorView } from "@codemirror/view";
import { tr } from "./i18n";
import { escapeHtml as esc } from "./preview";
import {
  applyEditorTransaction,
  captureEditorSelection,
  insertBlockTransaction,
  restoreEditorSelection,
} from "./editor-commands";
import {
  gridCardsMarkdown,
  validCardIcon,
  validCardLink,
  type GridCard,
} from "./material-snippets";

export function cardsDialogMarkup() {
  return `<form class="cards-builder">
    <div class="cards-builder-header">
      <p>${tr("将内容整理为卡片，适合导航、资源与功能介绍。")}</p>
      <label class="cards-count"><span>${tr("卡片数量")}</span><select name="count" aria-label="${tr("卡片数量")}">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === 2 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    </div>
    <div class="cards-dependencies" role="status" hidden></div>
    <div class="cards-fields"></div>
    <div class="cards-builder-footer">
      <div class="cards-builder-status"><span class="cards-summary"></span><p class="cards-error" role="alert"></p></div>
      <div class="modal-actions"><button type="button" data-dismiss>${tr("取消")}</button><button type="submit" class="primary">${tr("插入卡片")}</button></div>
    </div>
  </form>`;
}
export function mountCardsDialog(
  root: HTMLElement,
  view: EditorView,
  options: {
    current(): EditorView | undefined;
    missing(): string[];
    enable(extensions: string[]): void;
    pickIcon(input: HTMLInputElement): void;
    close(): void;
  },
) {
  root.classList.add("cards-dialog");
  const saved = captureEditorSelection(view);
  const selection = saved.selection;
  const form = root.querySelector<HTMLFormElement>("form")!;
  const fields = root.querySelector<HTMLElement>(".cards-fields")!;
  const count = form.elements.namedItem("count") as HTMLSelectElement;
  let submitted = false;
  const cards: GridCard[] = Array.from({ length: 6 }, (_, i) => ({
    title: tr("卡片 {0}", [i + 1]),
    body:
      i === 0
        ? view.state.sliceDoc(selection.main.from, selection.main.to)
        : "",
    icon: "",
    link: "",
  }));
  function read() {
    fields
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-card]")
      .forEach((input) => {
        cards[Number(input.dataset.card)][
          input.dataset.field as keyof GridCard
        ] = input.value;
      });
  }
  function render() {
    fields.dataset.count = count.value;
    fields.innerHTML = cards
      .slice(0, Number(count.value))
      .map(
        (
          card,
          i,
        ) => `<fieldset class="cards-card"><legend>${tr("卡片 {0}", [i + 1])}</legend>
      <div class="cards-card-heading" aria-hidden="true"><span class="cards-card-number">${String(i + 1).padStart(2, "0")}</span><span>${tr("卡片 {0}", [i + 1])}</span></div>
      <label><span class="cards-field-label">${tr("卡片标题")}<small>${tr("必填")}</small></span><input data-card="${i}" data-field="title" aria-label="${tr("卡片 {0} 标题", [i + 1])}" maxlength="120" value="${esc(card.title)}" placeholder="${tr("例如：快速开始")}" required></label>
      <label><span class="cards-field-label">${tr("内容")}<small>${tr("支持 Markdown")}</small></span><textarea data-card="${i}" data-field="body" aria-label="${tr("卡片 {0} 内容", [i + 1])}" rows="4" placeholder="${tr("写下这张卡片的介绍…")}">${esc(card.body)}</textarea></label>
      <div class="cards-optional"><div class="cards-icon-field"><label for="cards-icon-${i}"><span class="cards-field-label">${tr("图标短码")}<small>${tr("可选")}</small></span></label><div class="cards-icon-input"><input id="cards-icon-${i}" data-card="${i}" data-field="icon" aria-label="${tr("卡片 {0} 图标", [i + 1])}" placeholder=":material-star:" value="${esc(card.icon)}" spellcheck="false"><button type="button" data-card-icon="${i}" aria-label="${tr("为卡片 {0} 选择图标", [i + 1])}" title="${tr("选择图标")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></button></div></div>
      <label><span class="cards-field-label">${tr("链接")}<small>${tr("可选")}</small></span><input data-card="${i}" data-field="link" aria-label="${tr("卡片 {0} 链接", [i + 1])}" placeholder="https://…" value="${esc(card.link)}"></label></div></fieldset>`,
      )
      .join("");
    root.querySelector<HTMLElement>(".cards-summary")!.textContent = tr(
      "将插入 {0} 张卡片",
      [count.value],
    );
  }
  function dependencies() {
    const missing = options.missing();
    const notice = root.querySelector<HTMLElement>(".cards-dependencies")!;
    notice.hidden = missing.length === 0;
    notice.innerHTML = missing.length
      ? `<div><strong>${tr("插入前需要启用扩展")}</strong><p>${esc(tr("需要启用：{0}", [missing.join(", ")]))}</p></div><button type="button" data-enable>${tr("启用所需扩展")}</button>`
      : "";
    root.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled =
      missing.length > 0;
  }
  count.addEventListener("change", () => {
    read();
    render();
  });
  form.addEventListener("click", (event) => {
    const picker = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-card-icon]",
    );
    if (picker) {
      options.pickIcon(
        fields.querySelector<HTMLInputElement>(
          `[data-card="${picker.dataset.cardIcon}"][data-field="icon"]`,
        )!,
      );
      return;
    }
    if ((event.target as HTMLElement).closest("[data-enable]")) {
      options.enable(options.missing());
      dependencies();
    }
  });
  form.addEventListener("input", () => {
    form
      .querySelectorAll<HTMLInputElement>("input")
      .forEach((input) => input.setCustomValidity(""));
    root.querySelector<HTMLElement>(".cards-error")!.textContent = "";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    read();
    if (options.missing().length) return;
    if (!restoreEditorSelection(saved, options.current())) {
      root.querySelector<HTMLElement>(".cards-error")!.textContent =
        tr("笔记已变化，请重新插入。");
      return;
    }
    for (let i = 0; i < Number(count.value); i++) {
      const card = cards[i];
      let field: string | undefined,
        error = "";
      if (!card.title.trim()) {
        field = "title";
        error = tr("请填写卡片标题");
      } else if (!validCardIcon(card.icon.trim())) {
        field = "icon";
        error = tr("请输入有效的图标短码，例如 :material-star:");
      } else if (!validCardLink(card.link.trim())) {
        field = "link";
        error = tr("请输入网页、邮件或相对路径链接");
      }
      if (field) {
        const input = fields.querySelector<HTMLInputElement>(
          `[data-card="${i}"][data-field="${field}"]`,
        )!;
        input.setCustomValidity(error);
        input.reportValidity();
        return;
      }
    }
    submitted = applyEditorTransaction(
      view,
      insertBlockTransaction(
        view.state,
        gridCardsMarkdown(
          cards.slice(0, Number(count.value)).map((card) => ({
            ...card,
            title: card.title.trim(),
            icon: card.icon.trim(),
            link: card.link.trim(),
          })),
        ),
      ),
    );
    if (submitted) options.close();
  });
  render();
  dependencies();
  return () => {
    if (!submitted && restoreEditorSelection(saved, options.current())) {
      view.focus();
    }
  };
}
