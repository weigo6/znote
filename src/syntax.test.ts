import { describe, it, expect } from "vitest";
import { headings, wordCount } from "./syntax";

describe("document outline", () => {
  it("recognizes ATX and setext headings with UTF-16 positions", () => {
    const source = "😀 开头\n# 标题\n\nAnother heading\n---\n";
    expect(headings(source)).toEqual([
      { from: source.indexOf("#"), level: 1, text: "标题" },
      { from: source.indexOf("Another"), level: 2, text: "Another heading" },
    ]);
  });
  it("skips metadata and fenced code but leaves later headings visible", () => {
    const source = "---\ntitle: demo\n---\n# real\n```md\n# fake\n```\n## next";
    expect(headings(source).map(h => h.text)).toEqual(["real", "next"]);
  });
  it("does not hide the document behind an unclosed front-matter marker", () => {
    expect(headings("---\n# visible").map(h => h.text)).toEqual(["visible"]);
  });
  it("counts Chinese characters and English words", () => {
    expect(wordCount("你好 hello world 😀")).toBe(4);
  });
});
