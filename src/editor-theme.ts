import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** Semantic classes keep syntax colors in sync with CSS theme changes. */
export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.keyword, tags.atom, tags.bool, tags.unit], class: "zn-syntax-keyword" },
  { tag: [tags.literal, tags.number, tags.color], class: "zn-syntax-number" },
  { tag: [tags.string, tags.attributeValue, tags.regexp, tags.escape, tags.inserted], class: "zn-syntax-string" },
  { tag: [tags.typeName, tags.namespace, tags.tagName], class: "zn-syntax-tag" },
  { tag: [tags.className, tags.labelName, tags.definition(tags.variableName)], class: "zn-syntax-selector" },
  { tag: [tags.meta, tags.contentSeparator, tags.processingInstruction], class: "zn-syntax-meta" },
  { tag: tags.comment, class: "zn-syntax-comment" },
  { tag: [tags.link, tags.url], class: "zn-syntax-link" },
  { tag: [tags.invalid, tags.deleted], class: "zn-syntax-invalid" },
]);
