import type { EditorState, TransactionSpec } from "@codemirror/state";
import {
  availableReferenceLabel,
  blockStyleTransaction,
  inlineStyleTransaction,
  insertBlockTransaction,
  type InlineStyle,
  type BlockStyle,
} from "./editor-commands";
import { materialSnippets, cardRequirements } from "./material-snippets";
import { tr } from "./i18n";

export type EditorCommandId =
  | InlineStyle
  | BlockStyle
  | "table"
  | "codeblock"
  | "math"
  | "footnote"
  | "reference"
  | "rule"
  | "toc"
  | "link"
  | "image"
  | "icons"
  | "cards"
  | "settings"
  | "yaml"
  | `material:${string}`;
interface CommandDefinition {
  id: EditorCommandId;
  label: string;
  key?: string;
  requires?: readonly string[];
  transaction?: (state: EditorState) => TransactionSpec | null;
}
const block = (
  id: BlockStyle,
  label: string,
  key?: string,
  requires?: string[],
): CommandDefinition => ({
  id,
  label,
  key,
  requires,
  transaction: (state) => blockStyleTransaction(state, id),
});
const inline = (
  id: InlineStyle,
  label: string,
  key?: string,
  requires?: string[],
): CommandDefinition => ({
  id,
  label,
  key,
  requires,
  transaction: (state) => inlineStyleTransaction(state, id),
});
const insert = (
  id: EditorCommandId,
  label: string,
  text: (state: EditorState) => string,
  requires?: readonly string[],
  key?: string,
): CommandDefinition => ({
  id,
  label,
  requires,
  key,
  transaction: (state) => insertBlockTransaction(state, text(state)),
});
export const editorCommands: readonly CommandDefinition[] = [
  block("paragraph", "段落", "Mod-Alt-0"),
  ...([1, 2, 3, 4, 5, 6] as const).map((n, i) =>
    block(
      `heading-${n}`,
      ["一级标题", "二级标题", "三级标题", "四级标题", "五级标题", "六级标题"][
        i
      ],
      `Mod-Alt-${n}`,
    ),
  ),
  block("quote", "引用"),
  block("list", "无序列表"),
  block("ordered", "有序列表"),
  block("task", "任务列表", undefined, ["pymdownx.tasklist"]),
  inline("bold", "粗体 Ctrl+B", "Mod-b"),
  inline("italic", "斜体 Ctrl+I", "Mod-i"),
  inline("inline-code", "行内代码"),
  inline("strikethrough", "删除线", undefined, ["pymdownx.tilde"]),
  insert(
    "table",
    "表格",
    () => tr("\n| 名称 | 内容 |\n| --- | --- |\n| 示例 | 正文 |\n"),
    ["tables"],
    "Mod-t",
  ),
  insert(
    "math",
    "公式块",
    () => "$$\nE = mc^2\n$$",
    ["pymdownx.arithmatex"],
    "Mod-Shift-m",
  ),
  insert("rule", "水平分割线", () => "---"),
  insert("toc", "目录", () => "[TOC]", ["toc"]),
  insert(
    "codeblock",
    "代码块",
    (state) => {
      const { from, to } = state.selection.main;
      const text = state.sliceDoc(from, to);
      let length = 3;
      for (const match of text.matchAll(/`+/g))
        length = Math.max(length, match[0].length + 1);
      const fence = "`".repeat(length);
      return `${fence}\n${text}\n${fence}`;
    },
    undefined,
    "Mod-Shift-k",
  ),
  insert(
    "footnote",
    "脚注",
    (state) => {
      const label = availableReferenceLabel(state, "note");
      return tr("[^note]\n\n[^note]: 脚注内容").replace(
        /\[\^note\]/g,
        `[^${label}]`,
      );
    },
    ["footnotes"],
  ),
  insert("reference", "引用链接", (state) => {
    const label = availableReferenceLabel(state, "ref");
    return tr("[链接文字][ref]\n\n[ref]: https://").replace(
      /\[ref\]/g,
      `[${label}]`,
    );
  }),
  { id: "link", label: "插入链接" },
  { id: "image", label: "插入图片", key: "Mod-Shift-i" },
  {
    id: "icons",
    label: "在线选择图标",
    key: "Mod-Shift-e",
    requires: ["pymdownx.emoji"],
  },
  { id: "cards", label: "卡片", requires: cardRequirements },
  { id: "settings", label: "渲染设置" },
  { id: "yaml", label: "YAML Front Matter" },
  ...materialSnippets.map((snippet) =>
    insert(
      `material:${snippet.id}`,
      snippet.name,
      (state) => {
        const { from, to } = state.selection.main;
        return snippet.text(state.sliceDoc(from, to));
      },
      snippet.requires,
    ),
  ),
];
const commandsById = new Map<string, CommandDefinition>(
  editorCommands.map((command) => [command.id, command]),
);
export const editorCommand = (id: string) => commandsById.get(id);
export const requiredExtensions = (id: string): readonly string[] =>
  editorCommand(id)?.requires ?? [];
export function commandShortcut(id: string) {
  return editorCommand(id)
    ?.key?.replace("Mod", "Ctrl")
    .split("-")
    .map((part) => (part.length === 1 ? part.toUpperCase() : part))
    .join("+");
}
