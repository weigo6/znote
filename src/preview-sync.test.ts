import { describe, expect, it } from "vitest";
import { previewAnchors, previewTarget, sourceLineAtPreview } from "./preview-sync";

function article(...blocks: { text: string; top: number }[]) {
  const elements = blocks.map(({ text, top }) => ({
    textContent: text,
    getBoundingClientRect: () => ({ top }),
  })) as unknown as HTMLElement[];
  return {
    element: { querySelectorAll: () => elements } as unknown as HTMLElement,
    elements,
  };
}

describe("preview scroll index", () => {
  it("indexes repeated paragraphs once and skips generated blocks", () => {
    const preview = article(
      { text: "标题", top: 0 },
      { text: "重复段落", top: 100 },
      { text: "重复段落", top: 200 },
      { text: "generated table", top: 300 },
      { text: "末段", top: 400 },
    );
    const anchors = previewAnchors("# 标题\n\n重复段落\n\n重复段落\n\n| x | y |\n\n末段", preview.element);
    expect(anchors.map(anchor => anchor.line)).toEqual([1, 3, 5, 9]);
    expect(previewTarget(anchors, 5)).toBe(preview.elements[2]);
    expect(previewTarget(anchors, 7)).toBe(preview.elements[4]);
    expect(sourceLineAtPreview(anchors, 250)).toBe(5);
  });

  it("matches math text inside its rendered wrapper", () => {
    const preview = article({ text: "\\(x^2\\)", top: 0 });
    const anchors = previewAnchors("$x^2$", preview.element);
    expect(anchors.map(anchor => anchor.line)).toEqual([1]);
  });
});
