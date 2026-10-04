import {
  EditorSelection,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree, language } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

export type InlineStyle = "bold" | "italic" | "inline-code" | "strikethrough";
export type BlockStyle =
  "paragraph" | "quote" | "list" | "ordered" | "task" | `heading-${number}`;
const inlineNodes = {
  bold: "StrongEmphasis",
  italic: "Emphasis",
  "inline-code": "InlineCode",
  strikethrough: "Strikethrough",
};
const markers = {
  bold: "**",
  italic: "*",
  "inline-code": "`",
  strikethrough: "~~",
};

type SyntaxTree = ReturnType<typeof syntaxTree>;
const commandTrees = new WeakMap<EditorState, SyntaxTree>();
function tree(state: EditorState) {
  let parsed = commandTrees.get(state);
  if (!parsed) {
    // Explicit commands need a complete context. Display-only updates never use
    // this path or force synchronous parsing on the input hot path.
    parsed =
      ensureSyntaxTree(state, state.doc.length, 100) ??
      state.facet(language)?.parser.parse(state.doc.toString()) ??
      syntaxTree(state);
    commandTrees.set(state, parsed);
  }
  return parsed;
}
function ancestors(state: EditorState, pos: number, parsed = tree(state)) {
  const nodes: SyntaxNode[] = [];
  for (
    let node: SyntaxNode | null = parsed.resolveInner(pos, 1);
    node;
    node = node.parent
  )
    nodes.push(node);
  return nodes;
}
function inlineNode(state: EditorState, style: InlineStyle) {
  const { from, to } = state.selection.main;
  let found: SyntaxNode | undefined;
  tree(state).iterate({
    from,
    to,
    enter(node) {
      if (
        node.name === inlineNodes[style] &&
        node.from <= from &&
        node.to >= to
      )
        found = node.node;
    },
  });
  return found;
}
function inlineStatus(
  state: EditorState,
  style: InlineStyle,
): boolean | "mixed" {
  if (inlineNode(state, style)) return true;
  const { from, to, empty } = state.selection.main;
  if (empty) return false;
  const nodes: SyntaxNode[] = [];
  tree(state).iterate({
    from,
    to,
    enter(ref) {
      if (ref.name === inlineNodes[style] && ref.from < to && ref.to > from) {
        nodes.push(ref.node);
        return false;
      }
    },
  });
  if (!nodes.length) return false;
  let cursor = from;
  const full =
    nodes.every((node) => {
      const gap = state.sliceDoc(cursor, Math.max(from, node.from));
      cursor = Math.min(to, node.to);
      return !gap.trim();
    }) && !state.sliceDoc(cursor, to).trim();
  return full ? true : "mixed";
}
function selectedLines(state: EditorState) {
  const { from, to, empty } = state.selection.main;
  const last =
    !empty && to === state.doc.lineAt(to).from ? Math.max(from, to - 1) : to;
  const lines = [];
  for (
    let n = state.doc.lineAt(from).number;
    n <= state.doc.lineAt(last).number;
    n++
  )
    lines.push(state.doc.line(n));
  return lines;
}
function splitLine(text: string) {
  const indent = /^[ \t]*/.exec(text)![0];
  // Spaces between quote markers belong to the quote container.
  const quote = /^(?:> ?)+/.exec(text.slice(indent.length))?.[0] ?? "";
  const container = indent + quote;
  const rest = text.slice(container.length);
  const list = /^(?:[-*+] |\d+[.)] )(?:\[[ xX]\] )?/.exec(rest)?.[0] ?? "";
  const afterList = rest.slice(list.length);
  const heading = /^#{1,6}(?:[ \t]+|$)/.exec(afterList)?.[0] ?? "";
  return {
    container,
    quote,
    indent,
    list,
    heading,
    body: afterList.slice(heading.length),
  };
}
function listType(marker: string): "list" | "ordered" | "task" | null {
  return /\[[ xX]\]/.test(marker)
    ? "task"
    : /^\d/.test(marker)
      ? "ordered"
      : marker
        ? "list"
        : null;
}
const frontMatterEnds = new WeakMap<EditorState["doc"], number>();
function frontMatterEnd(state: EditorState) {
  const cached = frontMatterEnds.get(state.doc);
  if (cached !== undefined) return cached;
  let end = 0;
  if (state.doc.line(1).text.trim() === "---") {
    for (let n = 2; n <= state.doc.lines; n++) {
      const line = state.doc.line(n);
      if (/^(---|\.\.\.)\s*$/.test(line.text)) {
        end = line.to;
        break;
      }
    }
  }
  frontMatterEnds.set(state.doc, end);
  return end;
}
function lineContext(state: EditorState, pos: number, parsed = tree(state)) {
  const line = state.doc.lineAt(pos),
    parts = splitLine(line.text);
  const nodes = ancestors(
    state,
    Math.min(
      line.to,
      Math.max(line.from + parts.container.length + parts.list.length, pos),
    ),
    parsed,
  );
  const item = nodes.find((node) => node.name === "ListItem");
  const mark = item?.getChild("ListMark");
  const list = listType(
    parts.list ||
      (mark
        ? state.sliceDoc(
            mark.from,
            Math.min(state.doc.lineAt(mark.from).to, mark.to + 5),
          )
        : ""),
  );
  return {
    parts,
    list,
    quoted: !!parts.quote || nodes.some((node) => node.name === "Blockquote"),
    item,
    setext:
      pos < frontMatterEnd(state)
        ? undefined
        : nodes.find((node) => /^SetextHeading[12]$/.test(node.name)),
    nodes,
  };
}
export interface FormattingState {
  block: string;
  list: "list" | "ordered" | "task" | "mixed" | null;
  quote: boolean;
  bold: boolean | "mixed";
  italic: boolean | "mixed";
  code: boolean | "mixed";
  strikethrough: boolean | "mixed";
}
const formatCache = new WeakMap<
  EditorState,
  { tree: SyntaxTree; value: FormattingState }
>();

/** A resumable, display-only scan of one immutable state/tree snapshot. */
export function* formattingSteps(
  state: EditorState,
  parsed = syntaxTree(state),
): Generator<void, FormattingState> {
  const cached = formatCache.get(state);
  if (cached?.tree === parsed) return cached.value;
  const { from, to, empty } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(
    !empty && to === state.doc.lineAt(to).from ? Math.max(from, to - 1) : to,
  ).number;
  let block: string | undefined,
    list: FormattingState["list"] | undefined,
    quote = true;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const context = lineContext(
      state,
      Math.min(line.to, line.from + splitLine(line.text).container.length),
      parsed,
    );
    const heading = context.setext
      ? `heading-${context.setext.name.slice(-1)}`
      : context.parts.heading
        ? `heading-${context.parts.heading.trim().length}`
        : "paragraph";
    block = block === undefined ? heading : block === heading ? block : "mixed";
    list =
      list === undefined
        ? context.list
        : list === context.list
          ? list
          : "mixed";
    quote &&= context.quoted;
    if ((n - first) % 64 === 63) yield;
  }
  const styles = Object.keys(inlineNodes) as InlineStyle[];
  const runs = Object.fromEntries(
    styles.map((style) => [
      style,
      { found: false, full: true, cursor: from, contains: false },
    ]),
  ) as Record<
    InlineStyle,
    { found: boolean; full: boolean; cursor: number; contains: boolean }
  >;
  const byName = new Map(styles.map((style) => [inlineNodes[style], style]));
  let scanRoot = parsed.resolveInner(from, 1);
  while (scanRoot.parent && scanRoot.to < to) scanRoot = scanRoot.parent;
  for (let node = scanRoot.parent; node; node = node.parent) {
    const style = byName.get(node.name);
    if (style && node.from <= from && node.to >= to)
      runs[style].contains = true;
  }
  const cursor = scanRoot.cursor();
  let depth = 0;
  let visits = 0;
  // Prune unrelated branches, traverse the selected tree only once for all styles.
  for (;;) {
    const intersects = cursor.from <= to && cursor.to >= from;
    if (intersects) {
      const style = byName.get(cursor.name);
      if (style) {
        const run = runs[style];
        if (cursor.from <= from && cursor.to >= to) run.contains = true;
        if (
          !empty &&
          cursor.from < to &&
          cursor.to > from &&
          cursor.to > run.cursor
        ) {
          run.found = true;
          if (
            cursor.from > run.cursor &&
            state.sliceDoc(run.cursor, cursor.from).trim()
          )
            run.full = false;
          run.cursor = Math.min(to, cursor.to);
        }
      }
      if (++visits % 128 === 0) yield;
      if (cursor.firstChild()) {
        depth++;
        continue;
      }
    }
    while (depth > 0 && !cursor.nextSibling()) {
      cursor.parent();
      depth--;
    }
    if (depth === 0) {
      const inline = (style: InlineStyle): boolean | "mixed" => {
        const run = runs[style];
        if (run.contains) return true;
        if (!run.found) return false;
        return run.full && !state.sliceDoc(run.cursor, to).trim()
          ? true
          : "mixed";
      };
      const value: FormattingState = {
        block: block ?? "paragraph",
        list: list ?? null,
        quote,
        bold: inline("bold"),
        italic: inline("italic"),
        code: inline("inline-code"),
        strikethrough: inline("strikethrough"),
      };
      formatCache.set(state, { tree: parsed, value });
      return value;
    }
  }
}
export function formattingState(
  state: EditorState,
  complete = false,
): FormattingState {
  const steps = formattingSteps(
    state,
    complete ? tree(state) : syntaxTree(state),
  );
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}
function transaction(
  state: EditorState,
  changes: { from: number; to?: number; insert: string }[],
  selection?: { anchor: number; head?: number },
): TransactionSpec {
  const mapped = state.changes(changes),
    range = state.selection.main;
  return {
    changes,
    selection:
      selection ??
      EditorSelection.single(
        mapped.mapPos(range.anchor, 1),
        mapped.mapPos(range.head, 1),
      ),
    scrollIntoView: true,
    annotations: isolateHistory.of("full"),
    userEvent: "input.format",
  };
}
function marked(text: string, mark: string) {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return match[2] ? match[1] + mark + match[2] + mark + match[3] : text;
}
export function inlineStyleTransaction(
  state: EditorState,
  style: InlineStyle,
): TransactionSpec | null {
  const range = state.selection.main,
    node = inlineNode(state, style);
  let mark = markers[style];
  if (
    style === "inline-code" &&
    state.sliceDoc(range.from, range.to).includes("\n")
  )
    return null;
  if (
    node?.firstChild &&
    node.lastChild &&
    node.firstChild !== node.lastChild
  ) {
    let start = node.firstChild.to,
      end = node.lastChild.from;
    const content = state.sliceDoc(start, end);
    if (
      style === "inline-code" &&
      content.startsWith(" ") &&
      content.endsWith(" ") &&
      content.trim()
    ) {
      start++;
      end--;
    }
    if (range.empty || (range.from <= start && range.to >= end)) {
      return transaction(state, [
        { from: node.from, to: start, insert: "" },
        { from: end, to: node.to, insert: "" },
      ]);
    }
    const delimiter = state.sliceDoc(node.from, start);
    const left = marked(state.sliceDoc(start, range.from), delimiter),
      middle = state.sliceDoc(range.from, range.to);
    const right = marked(state.sliceDoc(range.to, end), delimiter);
    const from = node.from + left.length,
      to = from + middle.length;
    return transaction(
      state,
      [{ from: node.from, to: node.to, insert: left + middle + right }],
      range.anchor <= range.head
        ? { anchor: from, head: to }
        : { anchor: to, head: from },
    );
  }
  if (range.empty)
    return transaction(state, [{ from: range.from, insert: mark + mark }], {
      anchor: range.from + mark.length,
    });
  // A selection spanning separate styled runs toggles all of them off together.
  const runs: SyntaxNode[] = [];
  const overlapping: SyntaxNode[] = [];
  tree(state).iterate({
    from: range.from,
    to: range.to,
    enter(ref) {
      if (
        ref.name === inlineNodes[style] &&
        ref.from < range.to &&
        ref.to > range.from
      ) {
        overlapping.push(ref.node);
        if (ref.from >= range.from && ref.to <= range.to) runs.push(ref.node);
        return false;
      }
    },
  });
  const partial = overlapping.some(
    (run) => run.from < range.from || run.to > range.to,
  );
  if (partial && inlineStatus(state, style) === true) {
    const pieces = overlapping.map((run) => {
      const start = run.firstChild!.to,
        end = run.lastChild!.from;
      const from = Math.max(start, Math.min(end, range.from)),
        to = Math.max(from, Math.min(end, range.to));
      const delimiter = state.sliceDoc(run.from, start);
      const left = marked(state.sliceDoc(start, from), delimiter),
        middle = state.sliceDoc(from, to);
      return {
        run,
        left,
        middle,
        insert: left + middle + marked(state.sliceDoc(to, end), delimiter),
      };
    });
    const changes = pieces.map((piece) => ({
      from: piece.run.from,
      to: piece.run.to,
      insert: piece.insert,
    }));
    const mapping = state.changes(changes);
    const endpoint = (pos: number, end: boolean) => {
      const piece = pieces.find(
        (piece) => pos >= piece.run.from && pos <= piece.run.to,
      );
      return piece
        ? mapping.mapPos(piece.run.from, -1) +
            piece.left.length +
            (end ? piece.middle.length : 0)
        : mapping.mapPos(pos, 1);
    };
    const from = endpoint(range.from, false),
      to = endpoint(range.to, true);
    return transaction(
      state,
      changes,
      range.anchor <= range.head
        ? { anchor: from, head: to }
        : { anchor: to, head: from },
    );
  }
  if (partial && style !== "inline-code") {
    // Merge new formatting with overlapping runs, keeping existing styled text
    // outside the selection and avoiding adjacent/nested copies of the markers.
    const from = Math.min(range.from, overlapping[0].from),
      to = Math.max(range.to, overlapping.at(-1)!.to);
    const expanded = state.update({
      selection: { anchor: from, head: to },
    }).state;
    const spec = inlineStyleTransaction(expanded, style);
    if (!spec) return null;
    const stripping = state.changes(
      overlapping.flatMap((run) => [
        { from: run.from, to: run.firstChild!.to, insert: "" },
        { from: run.lastChild!.from, to: run.to, insert: "" },
      ]),
    );
    const cleanFrom = stripping.mapPos(from, -1),
      cleanTo = stripping.mapPos(to, 1);
    const cleaned = stripping.apply(state.doc).sliceString(cleanFrom, cleanTo);
    const formattedOffset = (pos: number) => {
      let remaining = stripping.mapPos(pos, 1) - cleanFrom,
        result = 0;
      for (const line of cleaned.split("\n")) {
        const leading = /^\s*/.exec(line)![0].length,
          trailing = /\s*$/.exec(line)![0].length;
        const nonempty = !!line.trim();
        if (remaining <= line.length)
          return (
            result +
            remaining +
            (nonempty && remaining >= leading
              ? remaining <= line.length - trailing
                ? mark.length
                : mark.length * 2
              : 0)
          );
        remaining -= line.length + 1;
        result += line.length + 1 + (nonempty ? mark.length * 2 : 0);
      }
      return result;
    };
    return {
      ...spec,
      selection: {
        anchor: from + formattedOffset(range.anchor),
        head: from + formattedOffset(range.head),
      },
    };
  }
  let cursor = range.from;
  const fullyMarked =
    runs.length > 0 &&
    runs.every((run) => {
      const gap = state.sliceDoc(cursor, run.from);
      cursor = run.to;
      return !gap.trim();
    }) &&
    !state.sliceDoc(cursor, range.to).trim();
  if (fullyMarked)
    return transaction(
      state,
      runs.flatMap((run) => [
        { from: run.from, to: run.firstChild!.to, insert: "" },
        { from: run.lastChild!.from, to: run.to, insert: "" },
      ]),
    );
  if (style === "inline-code") {
    const lengths = Array.from(
      state.sliceDoc(range.from, range.to).matchAll(/`+/g),
      (match) => match[0].length,
    );
    mark = "`".repeat(Math.max(0, ...lengths) + 1);
    const selected = state.sliceDoc(range.from, range.to);
    const pad = selected.startsWith("`") || selected.endsWith("`") ? " " : "";
    const insert = mark + pad + selected + pad + mark,
      start = range.from + mark.length + pad.length;
    return transaction(
      state,
      [{ from: range.from, to: range.to, insert }],
      range.anchor <= range.head
        ? { anchor: start, head: start + selected.length }
        : { anchor: start + selected.length, head: start },
    );
  }
  let cleaned = "",
    next = range.from;
  for (const run of runs) {
    cleaned +=
      state.sliceDoc(next, run.from) +
      state.sliceDoc(run.firstChild!.to, run.lastChild!.from);
    next = run.to;
  }
  cleaned += state.sliceDoc(next, range.to);
  const lines = cleaned.split("\n"),
    insert = lines.map((text) => marked(text, mark)).join("\n");
  const changes = [{ from: range.from, to: range.to, insert }];
  // Select the formatted content, excluding the outer markers for a single line.
  if (lines.length === 1 && insert !== cleaned) {
    const leading = /^\s*/.exec(cleaned)![0].length;
    const trailing = /\s*$/.exec(cleaned)![0].length;
    const from = range.from + leading + mark.length,
      to = range.from + cleaned.length - trailing + mark.length;
    return transaction(
      state,
      changes,
      range.anchor <= range.head
        ? { anchor: from, head: to }
        : { anchor: to, head: from },
    );
  }
  const mapped = state.changes(changes),
    from = mapped.mapPos(range.from, -1),
    to = mapped.mapPos(range.to, 1);
  return transaction(
    state,
    changes,
    range.anchor <= range.head
      ? { anchor: from, head: to }
      : { anchor: to, head: from },
  );
}
export function blockStyleTransaction(
  state: EditorState,
  style: BlockStyle,
): TransactionSpec | null {
  const parsed = tree(state);
  let lines = selectedLines(state);
  const isList = ["list", "ordered", "task"].includes(style);
  // A continuation line acts on its owning item, even when the marker is not
  // selected. Deduplicate it when a range also includes the first line.
  if (isList) {
    const targets = new Map(lines.map((line) => [line.number, line]));
    for (const line of lines) {
      const context = lineContext(state, line.from, parsed);
      if (context.item && !context.parts.list) {
        const first = state.doc.lineAt(context.item.from);
        targets.set(first.number, first);
      }
    }
    lines = [...targets.values()].sort((a, b) => a.number - b.number);
  }
  const blocks = lines.map((line) => lineContext(state, line.from, parsed));
  // Setext's underline belongs to the heading, rather than being body text.
  const extra: { from: number; to: number; insert: string }[] = [];
  if (style === "paragraph" || style.startsWith("heading-")) {
    const headings = new Map<number, SyntaxNode>();
    for (const block of blocks)
      if (block.setext) headings.set(block.setext.from, block.setext);
    const targets = new Map(lines.map((line) => [line.number, line]));
    for (const heading of headings.values()) {
      const underline = state.doc.lineAt(heading.to);
      const first = state.doc.lineAt(heading.from);
      targets.delete(underline.number);
      targets.set(first.number, first);
      extra.push({ from: underline.from - 1, to: underline.to, insert: "" });
    }
    lines = [...targets.values()].sort((a, b) => a.number - b.number);
  }
  const contexts = lines.map((line) => lineContext(state, line.from, parsed));
  const removingQuote =
    style === "quote" && blocks.every((block) => block.quoted);
  const removingList =
    ["list", "ordered", "task"].includes(style) &&
    contexts.every((block) => block.list === style);
  const counters = new Map<string, number>();
  const changes = lines.flatMap((line, index) => {
    const { parts, list } = contexts[index];
    let text: string;
    if (style === "quote")
      text = removingQuote
        ? parts.indent +
          line.text.slice(parts.indent.length).replace(/^> ?/, "")
        : parts.indent + "> " + line.text.slice(parts.indent.length);
    else if (style === "paragraph" || style.startsWith("heading-")) {
      const level = style === "paragraph" ? 0 : Number(style.slice(8));
      if (level < 0 || level > 6 || !Number.isInteger(level)) return [];
      text =
        parts.container +
        parts.list +
        (level ? "#".repeat(level) + " " : "") +
        parts.body;
    } else {
      // Continuation lines already belong to a list item; preserve their nesting.
      if (list && !parts.list) return [];
      let prefix = "";
      if (!removingList) {
        const key = parts.container,
          count = (counters.get(key) ?? 0) + 1;
        counters.set(key, count);
        prefix =
          style === "ordered"
            ? `${count}. `
            : style === "task"
              ? `- [${/\[[xX]\]/.test(parts.list) ? "x" : " "}] `
              : "- ";
      }
      text = parts.container + prefix + parts.heading + parts.body;
    }
    if (text === line.text) return [];
    let start = 0,
      end = 0;
    while (
      start < line.text.length &&
      start < text.length &&
      line.text[start] === text[start]
    )
      start++;
    while (
      end < line.text.length - start &&
      end < text.length - start &&
      line.text[line.text.length - end - 1] === text[text.length - end - 1]
    )
      end++;
    return [
      {
        from: line.from + start,
        to: line.to - end,
        insert: text.slice(start, text.length - end),
      },
    ];
  });
  changes.push(...extra);
  changes.sort((a, b) => a.from - b.from);
  return changes.length ? transaction(state, changes) : null;
}

/** Reserve labels appearing anywhere, including unresolved references. */
export function availableReferenceLabel(
  state: EditorState,
  base: "note" | "ref",
) {
  const used = new Set<string>();
  for (const match of state.doc.toString().matchAll(/\[([^\]\r\n]+)\]/g))
    used.add(
      match[1].replace(/^\^/, "").trim().replace(/\s+/g, " ").toLowerCase(),
    );
  let label = base as string,
    index = 2;
  while (used.has(label)) label = `${base}-${index++}`;
  return label;
}
export function insertBlockTransaction(
  state: EditorState,
  text: string,
): TransactionSpec | null {
  const { from, to } = state.selection.main,
    sourceLine = state.doc.lineAt(from),
    line = splitLine(sourceLine.text);
  const contentStart = sourceLine.from + line.container.length;
  const container =
    from < contentStart
      ? line.indent
      : line.container +
        (line.list && from >= contentStart + line.list.length
          ? " ".repeat(line.list.length)
          : "");
  const before = state.sliceDoc(Math.max(0, from - 2), from),
    after = state.sliceDoc(to, Math.min(state.doc.length, to + 2));
  const lead =
    before && !before.endsWith("\n\n")
      ? `\n${container.trimEnd()}\n${container}`
      : container;
  const body = text
    .replace(/^\n+|\n+$/g, "")
    .split("\n")
    .join("\n" + container);
  const tail =
    after && !after.startsWith("\n\n")
      ? `\n${container.trimEnd()}\n${container}`
      : "\n";
  return transaction(state, [{ from, to, insert: lead + body + tail }], {
    anchor: from + lead.length + body.length,
  });
}
export function applyEditorTransaction(
  view: EditorView,
  spec: TransactionSpec | null,
) {
  if (!spec) return false;
  view.dispatch(spec);
  view.focus();
  return true;
}

/** Delayed insertions keep their original selection only while the document is unchanged. */
export function captureEditorSelection(view: EditorView) {
  return { view, doc: view.state.doc, selection: view.state.selection };
}

export function restoreEditorSelection(
  saved: ReturnType<typeof captureEditorSelection>,
  current: EditorView | undefined,
) {
  if (current !== saved.view || current.state.doc !== saved.doc) return false;
  if (!current.state.selection.eq(saved.selection))
    current.dispatch({ selection: saved.selection });
  return true;
}
