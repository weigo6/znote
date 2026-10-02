export interface PreviewAnchor {
  element: HTMLElement;
  line: number;
}

const BLOCKS =
  ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > p, :scope > pre, :scope > blockquote, :scope > ul, :scope > ol, :scope > table, :scope > div, :scope > details, li, blockquote p";

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const sourceText = (text: string) => normalize(text
  .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)+/g, "")
  .replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g, "$1")
  .replace(/[`*_~$]/g, ""));

/** Build the source-to-preview map once after a document commit. */
export function previewAnchors(source: string, article: HTMLElement): PreviewAnchor[] {
  const lines = source.split("\n").map(sourceText);
  const exact = new Map<string, { positions: number[]; cursor: number }>();
  lines.forEach((text, index) => {
    if (!text) return;
    let entry = exact.get(text);
    if (!entry) exact.set(text, entry = { positions: [], cursor: 0 });
    entry.positions.push(index);
  });

  const anchors: PreviewAnchor[] = [];
  let nextLine = 0;
  for (const element of article.querySelectorAll<HTMLElement>(BLOCKS)) {
    const rendered = normalize(element.textContent || "");
    if (!rendered) continue;
    let found = -1;
    const entry = exact.get(rendered);
    if (entry) {
      while (entry.cursor < entry.positions.length && entry.positions[entry.cursor] < nextLine)
        entry.cursor++;
      found = entry.positions[entry.cursor] ?? -1;
    }
    if (found < 0) {
      // A paragraph or code block may contain several source lines. Bound the
      // fallback so generated blocks cannot repeatedly scan the whole note.
      for (let i = nextLine; i < Math.min(lines.length, nextLine + 128); i++) {
        if (lines[i].length > 1 && rendered.includes(lines[i])) {
          found = i;
          break;
        }
      }
    }
    if (found < 0) continue;
    anchors.push({ element, line: found + 1 });
    nextLine = found + 1;
  }
  return anchors;
}

/** Locate a source line in the precomputed ordered index. */
export function previewTarget(anchors: PreviewAnchor[], line: number): HTMLElement | null {
  if (!anchors.length) return null;
  let low = 0, high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].line < line) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return anchors[0].element;
  if (low === anchors.length) return anchors[low - 1].element;
  return (anchors[low].line - line <= line - anchors[low - 1].line
    ? anchors[low] : anchors[low - 1]).element;
}

/** Read only logarithmically many block positions during preview scrolling. */
export function sourceLineAtPreview(anchors: PreviewAnchor[], readingY: number): number | null {
  if (!anchors.length) return null;
  let low = 0, high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].element.getBoundingClientRect().top <= readingY)
      low = middle + 1;
    else high = middle;
  }
  return anchors[Math.max(0, low - 1)].line;
}
