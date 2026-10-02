import { sourceLocation } from "./preview-source-map";

export interface PreviewAnchor {
  element: HTMLElement;
  line: number;
  endLine?: number;
  from?: number;
  to?: number;
  precision?: "exact" | "inherited" | "generated";
}

const BLOCKS = ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > p, :scope > pre, :scope > blockquote, :scope > ul, :scope > ol, :scope > table, :scope > div, :scope > details, li, blockquote p";
const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const sourceText = (text: string) => normalize(text
  .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)+/g, "")
  .replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g, "$1")
  .replace(/[`*_~$]/g, ""));
const sourceParents = new WeakMap<PreviewAnchor[], number[]>();
const visualParents = new WeakMap<ReadingAnchor[], number[]>();

function parentIndex<T>(values: T[], element: (value: T) => HTMLElement): number[] {
  const parents: number[] = [];
  const stack: number[] = [];
  values.forEach((value, index) => {
    while (stack.length && !element(values[stack[stack.length - 1]]).contains?.(element(value))) stack.pop();
    parents.push(stack.at(-1) ?? -1);
    stack.push(index);
  });
  return parents;
}

function indexSource(anchors: PreviewAnchor[]) {
  sourceParents.set(anchors, parentIndex(anchors, anchor => anchor.element));
  return anchors;
}

function lowerBound(values: number[], value: number) {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Parser ranges take precedence. Legacy renderers get a bounded fallback. */
export function previewAnchors(source: string, article: HTMLElement): PreviewAnchor[] {
  const rawLines = source.split("\n");
  const starts = [0];
  for (let i = 0; i < rawLines.length - 1; i++) starts.push(starts[i] + rawLines[i].length + 1);
  const lineAt = (position: number) => {
    const at = lowerBound(starts, position);
    return at < starts.length && starts[at] === position ? at + 1 : Math.max(1, at);
  };
  const mapped: PreviewAnchor[] = [];
  let hasMapping = false;
  for (const element of article.querySelectorAll<HTMLElement>("*")) {
    const entry = sourceLocation(element);
    if (entry) hasMapping = true;
    if (!entry || entry.precision === "generated" || entry.from === undefined || entry.to === undefined ||
      entry.from < 0 || entry.to < entry.from || entry.to > source.length) continue;
    if (entry.precision === "inherited") {
      let parent = element.parentElement;
      let redundant = false;
      while (parent && parent !== article) {
        const ancestor = sourceLocation(parent);
        if (ancestor?.from === entry.from && ancestor.to === entry.to) { redundant = true; break; }
        parent = parent.parentElement;
      }
      if (redundant) continue;
    }
    mapped.push({ element, line: lineAt(entry.from), endLine: lineAt(Math.max(entry.from, entry.to - 1)),
      from: entry.from, to: entry.to, precision: entry.precision });
  }
  if (hasMapping) return indexSource(mapped.sort((a, b) => a.line - b.line || (b.endLine! - a.endLine!)));

  const elements = Array.from(article.querySelectorAll<HTMLElement>(BLOCKS));
  const lines = rawLines.map(sourceText);
  const headings: { line: number; text: string; level: number }[] = [];
  let fence = "";
  let inFrontMatter = rawLines[0]?.trim() === "---";
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i];
    if (inFrontMatter) {
      if (i && /^(---|\.\.\.)\s*$/.test(text)) inFrontMatter = false;
      continue;
    }
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      continue;
    }
    if (fence) continue;
    const atx = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (atx) headings.push({ line: i, text: sourceText(atx[2]), level: atx[1].length });
    else if (i + 1 < rawLines.length && /^\s{0,3}(=+|-+)\s*$/.test(rawLines[i + 1]) && text.trim())
      headings.push({ line: i, text: sourceText(text), level: rawLines[i + 1].trim()[0] === "=" ? 1 : 2 });
  }
  const hard = new Map<number, number>();
  let headingCursor = 0;
  elements.forEach((element, index) => {
    const level = /^H([1-6])$/.exec(element.tagName || "")?.[1];
    if (!level) return;
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".headerlink").forEach(link => link.remove());
    const text = sourceText(clone.textContent || "");
    const found = headings.findIndex((heading, i) => i >= headingCursor && heading.level === Number(level) && heading.text === text);
    if (found >= 0) {
      hard.set(index, headings[found].line);
      headingCursor = found + 1;
    }
  });
  const boundaries = [...hard.entries(), [elements.length, lines.length]];
  let boundary = 0, nextLine = 0;
  const anchors: PreviewAnchor[] = [];
  const exact = new Map<string, number[]>();
  lines.forEach((text, i) => {
    if (!text) return;
    let positions = exact.get(text);
    if (!positions) exact.set(text, positions = []);
    positions.push(i);
  });
  elements.forEach((element, index) => {
    const title = hard.get(index);
    if (title !== undefined) {
      anchors.push({ element, line: title + 1, endLine: title + 1, precision: "exact" });
      nextLine = title + 1;
      boundary++;
      return;
    }
    const end = boundaries[boundary]?.[1] ?? lines.length;
    const rendered = normalize(element.textContent || "");
    if (!rendered || /^H[1-6]$/.test(element.tagName || "")) return;
    const positions = exact.get(rendered) || [];
    let found = positions[lowerBound(positions, nextLine)] ?? -1;
    const limit = Math.min(end, nextLine + 128);
    if (found >= limit) found = -1;
    if (found < 0) {
      for (let i = nextLine; i < limit; i++) {
        if (lines[i].length > 1 && rendered.includes(lines[i])) { found = i; break; }
      }
    }
    if (found < 0) return;
    anchors.push({ element, line: found + 1, precision: "inherited" });
    nextLine = found + 1;
  });
  anchors.forEach((anchor, i) => { anchor.endLine ??= (anchors[i + 1]?.line ?? rawLines.length + 1) - 1; });
  return indexSource(anchors);
}

/** Containing range wins; gaps conservatively use the preceding block. */
export function previewAnchorAt(anchors: PreviewAnchor[], line: number): PreviewAnchor | null {
  if (!anchors.length) return null;
  let low = 0, high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].line <= line) low = middle + 1;
    else high = middle;
  }
  const candidate = anchors[Math.max(0, low - 1)];
  if (candidate.endLine === undefined || candidate.endLine >= line) return candidate;
  let parents = sourceParents.get(anchors);
  if (!parents) { parents = parentIndex(anchors, anchor => anchor.element); sourceParents.set(anchors, parents); }
  for (let i = parents[Math.max(0, low - 1)]; i >= 0; i = parents[i])
    if ((anchors[i].endLine ?? anchors[i].line) >= line) return anchors[i];
  return candidate;
}

export function previewTarget(anchors: PreviewAnchor[], line: number): HTMLElement | null {
  return previewAnchorAt(anchors, line)?.element ?? null;
}

export interface ReadingAnchor { anchor: PreviewAnchor; top: number; bottom: number }

export function isPreviewVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest("[hidden]") || !element.getClientRects().length) return false;
  const visibility = element.ownerDocument.defaultView?.getComputedStyle(element).visibility;
  if (visibility === "hidden" || visibility === "collapse") return false;
  // Chromium can return cached rectangles for descendants of closed details.
  // Rect existence alone is therefore not a sufficient visibility test.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS" && !parent.hasAttribute("open") &&
      !parent.querySelector(":scope > summary")?.contains(element)) return false;
  }
  return true;
}

/** Rebuild only after layout invalidation, never for every scroll event. */
export function readingAnchors(anchors: PreviewAnchor[], scrollTop: number, article?: HTMLElement): ReadingAnchor[] {
  const result: ReadingAnchor[] = [];
  const generated: PreviewAnchor[] = [];
  for (const element of article?.querySelectorAll<HTMLElement>("*") || []) {
    if (sourceLocation(element)?.precision !== "generated" || sourceLocation(element.parentElement!)?.precision === "generated") continue;
    generated.push({ element, line: 0, endLine: 0, precision: "generated" });
  }
  for (const anchor of [...anchors, ...generated]) {
    if (!isPreviewVisible(anchor.element)) continue;
    const rect = anchor.element.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const visibleAnchor = anchor.element.tagName === "DETAILS" && !anchor.element.hasAttribute("open")
      ? { ...anchor, endLine: anchor.line } : anchor;
    result.push({ anchor: visibleAnchor, top: rect.top + scrollTop, bottom: rect.bottom + scrollTop });
  }
  result.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  visualParents.set(result, parentIndex(result, value => value.anchor.element));
  return result;
}

export function readingAnchorAt(anchors: ReadingAnchor[], y: number): ReadingAnchor | null {
  let low = 0, high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].top <= y) low = middle + 1;
    else high = middle;
  }
  const candidate = anchors[Math.max(0, low - 1)];
  if (!candidate || candidate.bottom >= y) return candidate ?? null;
  let parents = visualParents.get(anchors);
  if (!parents) { parents = parentIndex(anchors, value => value.anchor.element); visualParents.set(anchors, parents); }
  for (let i = parents[Math.max(0, low - 1)]; i >= 0; i = parents[i])
    if (anchors[i].bottom >= y) return anchors[i];
  return candidate;
}

export function lineWithin(anchor: PreviewAnchor, fraction: number): number {
  return anchor.line + Math.round(Math.max(0, Math.min(1, fraction)) * ((anchor.endLine ?? anchor.line) - anchor.line));
}

/** Compatibility helper for callers with already ordered visible anchors. */
export function sourceLineAtPreview(anchors: PreviewAnchor[], readingY: number): number | null {
  if (!anchors.length) return null;
  let low = 0, high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].element.getBoundingClientRect().top <= readingY) low = middle + 1;
    else high = middle;
  }
  return anchors[Math.max(0, low - 1)].line;
}
