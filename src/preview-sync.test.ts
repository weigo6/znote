import { describe, expect, it } from "vitest";
import { previewAnchors, previewTarget, sourceLineAtPreview, readingAnchorAt, lineWithin } from "./preview-sync";

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
    expect(previewTarget(anchors, 7)).toBe(preview.elements[2]);
    expect(sourceLineAtPreview(anchors, 250)).toBe(5);
  });

  it("matches math text inside its rendered wrapper", () => {
    const preview = article({ text: "\\(x^2\\)", top: 0 });
    const anchors = previewAnchors("$x^2$", preview.element);
    expect(anchors.map(anchor => anchor.line)).toEqual([1]);
  });

  it("uses the containing long block instead of the next heading", () => {
    const preview = article({ text: "long code", top: 0 }, { text: "next", top: 1000 });
    const anchors = [{ element: preview.elements[0], line: 1, endLine: 100 },
      { element: preview.elements[1], line: 101, endLine: 101 }];
    expect(previewTarget(anchors, 70)).toBe(preview.elements[0]);
    expect(lineWithin(anchors[0], .7)).toBe(70);
  });

  it("queries visual order independently of source order", () => {
    const preview = article({ text: "source first", top: 300 }, { text: "source second", top: 100 });
    const visual = [
      { anchor: { element: preview.elements[1], line: 20 }, top: 100, bottom: 180 },
      { anchor: { element: preview.elements[0], line: 1 }, top: 300, bottom: 380 },
    ];
    expect(readingAnchorAt(visual, 150)?.anchor.line).toBe(20);
    expect(readingAnchorAt(visual, 350)?.anchor.line).toBe(1);
  });

  it("finds a containing ancestor across several earlier siblings", () => {
    const children = article({ text: "first", top: 0 }, { text: "second", top: 300 });
    const parent = { contains: (element: HTMLElement) => children.elements.includes(element) } as HTMLElement;
    const anchors = [{ element: parent, line: 1, endLine: 100 },
      { element: children.elements[0], line: 1, endLine: 10 },
      { element: children.elements[1], line: 20, endLine: 30 }];
    expect(previewTarget(anchors, 40)).toBe(parent);
    expect(readingAnchorAt([
      { anchor: anchors[0], top: 0, bottom: 1000 },
      { anchor: anchors[1], top: 0, bottom: 100 },
      { anchor: anchors[2], top: 300, bottom: 400 },
    ], 500)?.anchor.element).toBe(parent);
  });
});
