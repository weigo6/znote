import { describe, expect, it } from "vitest";
import {
  gridCardsMarkdown,
  materialSnippets,
  validCardIcon,
  validCardLink,
} from "./material-snippets";

describe("Material insertion templates", () => {
  it("keeps multi-line selected content inside admonitions and tabs", () => {
    expect(
      materialSnippets
        .find((s) => s.id === "admonition-note")!
        .text("first\nsecond"),
    ).toContain("    first\n    second");
    expect(
      materialSnippets.find((s) => s.id === "tabs")!.text("first\nsecond"),
    ).toContain('=== "方案一"\n\n    first\n    second');
  });
  it("generates standard grid card markup with nested Markdown, escaped titles and optional fields", () => {
    const result = gridCardsMarkdown([
      {
        title: "A *title*",
        body: "Text\n\n- nested",
        icon: ":material-star:",
        link: "guide/page(one).md",
      },
      { title: "Two", body: "", icon: "", link: "" },
    ]);
    expect(result).toContain('<div class="grid cards" markdown>');
    expect(result).toContain("- :material-star: **A \\*title\\***");
    expect(result).toContain("    Text\n    \n    - nested");
    expect(result).toContain("(guide/page%28one%29.md)");
    expect(result).toContain("- **Two**");
    expect(result.endsWith("</div>")).toBe(true);
  });
  it("accepts relative, web and email links and rejects unsafe schemes or malformed shortcodes", () => {
    for (const link of [
      "",
      "../guide.md#intro",
      "https://example.org/",
      "mailto:a@example.org",
      "#intro",
    ])
      expect(validCardLink(link)).toBe(true);
    for (const link of [
      "javascript:alert(1)",
      "data:text/html,a",
      "file:///a",
      "a b",
      "https://host/<b>",
    ])
      expect(validCardLink(link)).toBe(false);
    expect(validCardIcon(":material-star:")).toBe(true);
    expect(validCardIcon(":lucide-arrow-up-right:")).toBe(true);
    expect(validCardIcon(":material:star:")).toBe(false);
  });
});
