import { tr } from "./i18n";

export interface MaterialSnippet {
  id: string;
  name: string;
  description: string;
  icon: string;
  requires: string[];
  text: (selected: string) => string;
}
const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => "    " + line)
    .join("\n");
export const materialSnippets: MaterialSnippet[] = [
  ...["note", "info", "tip", "warning", "danger"].map((type) => ({
    id: `admonition-${type}`,
    icon: (
      {
        note: "sticky-note",
        info: "info",
        tip: "lightbulb",
        warning: "alert-triangle",
        danger: "octagon-alert",
      } as Record<string, string>
    )[type],
    get name() {
      return tr(
        (
          {
            note: "提示",
            info: "信息",
            tip: "技巧",
            warning: "警告",
            danger: "危险",
          } as Record<string, string>
        )[type],
      );
    },
    get description() {
      return tr("突出一段重要内容");
    },
    requires: ["admonition"],
    text: (selected: string) =>
      `!!! ${type} "${tr("标题")}"\n\n${indent(selected || tr("在这里写下内容。"))}`,
  })),
  {
    id: "details",
    icon: "list-collapse",
    get name() {
      return tr("折叠详情");
    },
    get description() {
      return tr("收起补充信息");
    },
    requires: ["admonition", "pymdownx.details"],
    text: (selected) =>
      `???+ tip "${tr("展开了解更多")}"\n\n${indent(selected || tr("补充内容。"))}`,
  },
  {
    id: "tabs",
    icon: "panel-top",
    get name() {
      return tr("内容标签页");
    },
    get description() {
      return tr("并列展示多个方案");
    },
    requires: ["pymdownx.tabbed", "pymdownx.superfences"],
    text: (selected) =>
      `=== "${tr("方案一")}"\n\n${indent(selected || tr("第一组内容。"))}\n\n=== "${tr("方案二")}"\n\n${indent(tr("第二组内容。"))}`,
  },
  {
    id: "mermaid",
    icon: "workflow",
    get name() {
      return tr("Mermaid 图表");
    },
    get description() {
      return tr("流程图 · 结构与关系");
    },
    requires: ["pymdownx.superfences"],
    text: () =>
      "```mermaid\ngraph LR\n    A[" +
      tr("想法") +
      "] --> B[" +
      tr("写作") +
      "]\n    B --> C[" +
      tr("发布") +
      "]\n```",
  },
  {
    id: "button",
    icon: "square-arrow-out-up-right",
    get name() {
      return tr("按钮链接");
    },
    get description() {
      return tr("行动入口");
    },
    requires: ["attr_list"],
    text: (selected) =>
      `[${selected || tr("了解更多")}](https://zensical.org/){ .md-button }`,
  },
];
export interface GridCard {
  title: string;
  body: string;
  icon: string;
  link: string;
}
export const cardRequirements = ["attr_list", "md_in_html"];
export function validCardLink(value: string) {
  if (!value) return true;
  if (/[\s<>\u0000-\u001f]/.test(value)) return false;
  try {
    return ["http:", "https:", "mailto:"].includes(
      new URL(value, "https://znote.local/").protocol,
    );
  } catch {
    return false;
  }
}
export function validCardIcon(value: string) {
  return !value || /^:[a-z0-9]+(?:-[a-z0-9]+)+:$/.test(value);
}
const escapeTitle = (value: string) => value.replace(/[\\`*_[\]<>]/g, "\\$&");
export function gridCardsMarkdown(cards: GridCard[]) {
  return (
    '<div class="grid cards" markdown>\n\n' +
    cards
      .map((card) => {
        const heading = `${card.icon ? card.icon + " " : ""}**${escapeTitle(card.title)}**`;
        const content = card.body.trim()
          ? indent(card.body.trim()) + "\n\n"
          : "";
        const link = card.link.trim()
          ? `    [${tr("了解更多")}](${card.link.trim().replace(/\(/g, "%28").replace(/\)/g, "%29")})\n\n`
          : "";
        return `- ${heading}\n\n    ---\n\n${content}${link}`;
      })
      .join("") +
    "</div>"
  );
}
