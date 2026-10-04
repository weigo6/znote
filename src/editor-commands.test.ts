import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  blockStyleTransaction,
  inlineStyleTransaction,
  formattingState,
  insertBlockTransaction,
  formattingSteps,
} from "./editor-commands";
import { editorCommand, requiredExtensions } from "./editor-command-registry";

const state = (text: string, anchor = 0, head = anchor) =>
  EditorState.create({
    doc: text,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  });
const apply = (value: EditorState, spec: TransactionSpec | null) =>
  spec ? value.update(spec).state : value;
describe("shared Markdown commands", () => {
  it("converts Setext headings without retaining their underline, including reverse selections and quotes", () => {
    for (const text of [
      "Heading\n=======",
      "Heading\n-------",
      "> Heading\n> =======",
    ]) {
      const value = state(text, text.length, 0);
      expect(formattingState(value).block).toBe(
        text.includes("-------") ? "heading-2" : "heading-1",
      );
      const plain = apply(value, blockStyleTransaction(value, "paragraph"));
      expect(plain.doc.toString()).toBe(
        text.startsWith(">") ? "> Heading" : "Heading",
      );
      const heading = apply(value, blockStyleTransaction(value, "heading-3"));
      expect(heading.doc.toString()).toBe(
        text.startsWith(">") ? "> ### Heading" : "### Heading",
      );
      expect(heading.selection.main.anchor).toBeGreaterThanOrEqual(
        heading.selection.main.head,
      );
    }
  });
  it("applies list commands to the owning item when only its continuation is selected", () => {
    const value = state("- parent\n  continuation\n- sibling", 15);
    expect(
      apply(value, blockStyleTransaction(value, "list")).doc.toString(),
    ).toBe("parent\n  continuation\n- sibling");
    expect(
      apply(value, blockStyleTransaction(value, "ordered")).doc.toString(),
    ).toBe("1. parent\n  continuation\n- sibling");
    const nested = state("- outer\n  - child\n    continuation", 28);
    expect(
      apply(nested, blockStyleTransaction(nested, "task")).doc.toString(),
    ).toBe("- outer\n  - [ ] child\n    continuation");
  });
  it("allocates fresh footnote and reference labels, including unresolved and case-folded labels", () => {
    for (const action of ["footnote", "reference"] as const) {
      const base = action === "footnote" ? "note" : "ref";
      const text = `[${base.toUpperCase()}] [^${base}-2]\n\n[${base}]: existing`;
      let value = state(text, text.length);
      value = apply(value, editorCommand(action)!.transaction!(value));
      expect(value.doc.toString()).toContain(`${base}-3]`);
      expect(value.doc.toString()).toContain(`[${base}]: existing`);
      value = apply(value, editorCommand(action)!.transaction!(value));
      expect(value.doc.toString()).toContain(`${base}-4]`);
    }
  });
  it("declares dependencies shared by all command entry points", () => {
    expect(requiredExtensions("task")).toEqual(["pymdownx.tasklist"]);
    expect(requiredExtensions("strikethrough")).toEqual(["pymdownx.tilde"]);
    expect(requiredExtensions("icons")).toEqual(["pymdownx.emoji"]);
  });
  it("yields during large selection scans and detects nested mixed inline formats", () => {
    const text = Array.from(
      { length: 1000 },
      () => "**bold *both*** plain",
    ).join("\n\n");
    const value = state(text, 0, text.length);
    const steps = formattingSteps(value);
    expect(steps.next().done).toBe(false);
    const mixed = state("**bold *both*** plain", 0, 20);
    expect(formattingState(mixed).bold).toBe("mixed");
    expect(formattingState(mixed).italic).toBe("mixed");
  });
  it("replaces all six heading levels, preserves list and quote containers, and keeps the caret in the text", () => {
    let value = state("> - ## title", 10);
    for (let level = 1; level <= 6; level++) {
      value = apply(value, blockStyleTransaction(value, `heading-${level}`));
      expect(value.doc.toString()).toBe("> - " + "#".repeat(level) + " title");
      expect(
        value.sliceDoc(
          value.selection.main.head - 1,
          value.selection.main.head + 1,
        ),
      ).toBe("tl");
      expect(formattingState(value).block).toBe(`heading-${level}`);
    }
    expect(
      apply(value, blockStyleTransaction(value, "paragraph")).doc.toString(),
    ).toBe("> - title");
  });
  it("excludes a next line whose start is the end of the selection", () => {
    const value = state("one\ntwo\nthree", 0, 4);
    expect(
      apply(value, blockStyleTransaction(value, "heading-4")).doc.toString(),
    ).toBe("#### one\ntwo\nthree");
  });
  it("converts nested lists and preserves continuation text and checked task state", () => {
    const text = "- parent\n  - child\n    continuation\n- [x] done";
    const value = state(text, 0, text.length);
    expect(
      apply(value, blockStyleTransaction(value, "ordered")).doc.toString(),
    ).toBe("1. parent\n  1. child\n    continuation\n2. done");
    expect(
      apply(value, blockStyleTransaction(value, "task")).doc.toString(),
    ).toBe("- [ ] parent\n  - [ ] child\n    continuation\n- [x] done");
  });
  it("reports list, heading and mixed states inside nested containers", () => {
    expect(formattingState(state("- [x] done", 7)).list).toBe("task");
    expect(formattingState(state("1. parent\n   more", 16)).list).toBe(
      "ordered",
    );
    expect(formattingState(state("## title\nbody", 0, 13)).block).toBe("mixed");
    expect(formattingState(state("- one\n2. two", 0, 12)).list).toBe("mixed");
  });
  it("toggles quotes and lists instead of accumulating markers", () => {
    for (const style of ["quote", "list", "ordered", "task"] as const) {
      const source = state("one\ntwo", 0, 7);
      const first = apply(source, blockStyleTransaction(source, style));
      expect(
        apply(first, blockStyleTransaction(first, style)).doc.toString(),
      ).toBe("one\ntwo");
    }
  });
  it("toggles bold, italic, code and strikethrough for the same selection", () => {
    for (const style of [
      "bold",
      "italic",
      "inline-code",
      "strikethrough",
    ] as const) {
      const source = state("中文 😀", 0, 5);
      const first = apply(source, inlineStyleTransaction(source, style));
      expect(
        apply(first, inlineStyleTransaction(first, style)).doc.toString(),
      ).toBe("中文 😀");
    }
  });
  it("removes formatting at a caret and splits a partly selected formatted run", () => {
    expect(
      apply(
        state("**one two**", 5),
        inlineStyleTransaction(state("**one two**", 5), "bold"),
      ).doc.toString(),
    ).toBe("one two");
    const value = state("**one two**", 2, 5);
    const result = apply(value, inlineStyleTransaction(value, "bold"));
    expect(result.doc.toString()).toBe("one **two**");
    expect(
      result.sliceDoc(result.selection.main.from, result.selection.main.to),
    ).toBe("one");
  });
  it("toggles separate lines together and preserves reverse selections", () => {
    const value = state("one\ntwo", 7, 0);
    const first = apply(value, inlineStyleTransaction(value, "bold"));
    expect(first.doc.toString()).toBe("**one**\n**two**");
    expect(first.selection.main.anchor).toBeGreaterThan(
      first.selection.main.head,
    );
    expect(formattingState(first).bold).toBe(true);
    expect(
      apply(first, inlineStyleTransaction(first, "bold")).doc.toString(),
    ).toBe("one\ntwo");
  });
  it("shows mixed inline states and applies formatting without nesting existing delimiters", () => {
    const value = state("**one** two", 0, 11);
    expect(formattingState(value).bold).toBe("mixed");
    const result = apply(value, inlineStyleTransaction(value, "bold"));
    expect(result.doc.toString()).toBe("**one two**");
    expect(formattingState(result).bold).toBe(true);
    const partial = state("**one** two", 3, 11);
    const applied = apply(partial, inlineStyleTransaction(partial, "bold"));
    expect(applied.doc.toString()).toBe("**one two**");
    expect(
      applied.sliceDoc(applied.selection.main.from, applied.selection.main.to),
    ).toBe("ne two");
    const separate = state("**one** **two**", 3, 12);
    const removed = apply(separate, inlineStyleTransaction(separate, "bold"));
    expect(removed.doc.toString()).toBe("**o**ne tw**o**");
    expect(
      removed.sliceDoc(removed.selection.main.from, removed.selection.main.to),
    ).toBe("ne tw");
  });
  it("uses a longer code delimiter when selected text contains backticks", () => {
    const value = state("a`b", 0, 3);
    const result = apply(value, inlineStyleTransaction(value, "inline-code"));
    expect(result.doc.toString()).toBe("``a`b``");
    expect(syntaxTree(result).toString()).toContain("InlineCode");
    const edge = state("`word`", 0, 6);
    const edgeResult = apply(edge, inlineStyleTransaction(edge, "inline-code"));
    // Existing inline code toggles off; arbitrary literal backticks remain parseable.
    expect(edgeResult.doc.toString()).toBe("word");
    const unmatched = state("`word", 0, 5);
    expect(
      syntaxTree(
        apply(unmatched, inlineStyleTransaction(unmatched, "inline-code")),
      ).toString(),
    ).toContain("InlineCode");
  });
  it.each([
    {
      text: "```html\n<p>raw</p>\n```",
      selected: "raw",
      heading: "```html\n## <p>raw</p>\n```",
    },
    {
      text: "<div>\nraw\n</div>",
      selected: "raw",
      heading: "<div>\n## raw\n</div>",
    },
    {
      text: "---\ntitle: A\n---",
      selected: "title: A",
      heading: "---\n## title: A\n---",
    },
    {
      text: "    code",
      selected: "code",
      heading: "    ## code",
    },
  ])(
    "allows formatting and insertion inside source: $text",
    ({ text, selected, heading }) => {
      const from = text.indexOf(selected);
      const value = state(text, from, from + selected.length);
      expect(
        apply(value, blockStyleTransaction(value, "heading-2")).doc.toString(),
      ).toBe(heading);
      expect(
        apply(value, inlineStyleTransaction(value, "bold")).doc.toString(),
      ).toBe(text.replace(selected, `**${selected}**`));
      const insertion = insertBlockTransaction(
        value,
        "!!! note\n\n    content",
      );
      expect(insertion).not.toBeNull();
      expect(apply(value, insertion).doc.toString()).toContain("!!! note");
    },
  );
  it("adds block separation without losing surrounding text", () => {
    const value = state("before selected after", 7, 15);
    const result = apply(
      value,
      insertBlockTransaction(value, "!!! note\n\n    selected"),
    );
    expect(result.doc.toString()).toBe(
      "before \n\n!!! note\n\n    selected\n\n after",
    );
    const list = state("- selected", 0, 10);
    expect(
      apply(
        list,
        insertBlockTransaction(list, "!!! note\n\n    - selected"),
      ).doc.toString(),
    ).toBe("!!! note\n\n    - selected\n");
  });
});
