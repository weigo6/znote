import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

export interface EditorCallbacks {
  change: (text: string) => void;
  cursor: () => void;
  save: () => void;
  image: (file: File) => void;
  command?: (action: string) => void;
}

/** One lossless Markdown source editor, reused in edit and split views. */
export class NoteEditor {
  readonly view: EditorView;
  constructor(parent: HTMLElement, text: string, callbacks: EditorCallbacks) {
    const shortcuts = [
      { key: "Mod-s", run: () => { callbacks.save(); return true; } },
      { key: "Mod-b", run: (view: EditorView) => wrap(view, "**") },
      { key: "Mod-i", run: (view: EditorView) => wrap(view, "*") },
      { key: "Mod-Shift-k", run: (view: EditorView) => {
        if (callbacks.command) { callbacks.command("codeblock"); return true; }
        return wrap(view, String.fromCharCode(96));
      } },
      { key: "Mod-Shift-i", run: () => { callbacks.command?.("image"); return !!callbacks.command; } },
      { key: "Mod-t", run: () => { callbacks.command?.("table"); return !!callbacks.command; } },
      { key: "Mod-Shift-m", run: () => { callbacks.command?.("math"); return !!callbacks.command; } },
      { key: "Mod-/", run: toggleComment },
    ];
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.phrases.of({
            Find: "查找",
            Replace: "替换",
            next: "下一个",
            previous: "上一个",
            all: "全选",
            "match case": "区分大小写",
            regexp: "正则",
            "by word": "全词",
            replace: "替换",
            "replace all": "全部替换",
            close: "关闭",
          }),
          markdown(), history(), drawSelection(), dropCursor(), indentOnInput(),
          bracketMatching(), closeBrackets(), highlightSelectionMatches(), highlightActiveLine(),
          syntaxHighlighting(defaultHighlightStyle), placeholder("写下你的第一个想法…"),
          EditorView.lineWrapping,
          keymap.of([...shortcuts, ...markdownKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.change(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) callbacks.cursor();
          }),
          EditorView.domEventHandlers({paste: (event) => {
            const image = Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith("image/"));
            if (!image) return false;
            event.preventDefault(); callbacks.image(image); return true;
          }}),
          EditorView.contentAttributes.of({"aria-label": "Markdown 编辑器", spellcheck: "false", autocapitalize: "off"}),
        ],
      }),
    });
  }
  insert(text: string) {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true});
    this.view.focus();
  }
  jump(from: number) {
    const pos = Math.min(from, this.view.state.doc.length);
    this.view.dispatch({selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 60 })});
    this.view.focus();
  }
  revealLine(line: number) {
    const doc = this.view.state.doc;
    const pos = doc.line(Math.max(1, Math.min(line, doc.lines))).from;
    this.view.dispatch({effects: EditorView.scrollIntoView(pos, {
      y: "start", yMargin: this.view.scrollDOM.clientHeight * 0.28,
    })});
  }
  destroy() { this.view.destroy(); }
}

export function wrap(view: EditorView, mark: string) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  view.dispatch({changes: { from, to, insert: mark + text + mark }, selection: { anchor: from + mark.length, head: to + mark.length }, scrollIntoView: true});
  view.focus();
  return true;
}

/** Prefix complete selected lines without discarding their source text. */
export function prefixLines(view: EditorView, prefix: string) {
  const selection = view.state.selection.main;
  const start = view.state.doc.lineAt(selection.from).from;
  const last = selection.empty || selection.to !== view.state.doc.lineAt(selection.to).from
    ? selection.to : selection.to - 1;
  const end = view.state.doc.lineAt(last).to;
  const old = view.state.sliceDoc(start, end);
  const lines = old.split("\n");
  const removing = lines.every(line => line.startsWith(prefix));
  const updated = lines.map(line => removing ? line.slice(prefix.length) : prefix + line).join("\n");
  const shift = removing ? -prefix.length : prefix.length;
  const cursor = Math.max(start, selection.head + shift);
  const range = selection.empty ? { anchor: cursor } : selection.anchor <= selection.head
    ? { anchor: start, head: start + updated.length }
    : { anchor: start + updated.length, head: start };
  view.dispatch({changes: { from: start, to: end, insert: updated }, selection: range, scrollIntoView: true});
  view.focus();
  return true;
}
