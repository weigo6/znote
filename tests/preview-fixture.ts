import { PreviewSurface } from "../src/preview-surface";
import "../src/style.css";
import type { RenderResult, MathEngine } from "../src/types";
import { previewAnchors, previewAnchorAt, readingAnchors, readingAnchorAt } from "../src/preview-sync";
const surface = new PreviewSurface();
const host = document.querySelector<HTMLElement>("#surface")!;
const warnings: string[] = [];
let findShortcutCount = 0;
const scrollLines: number[] = [];
surface.onFindShortcut = () => {
  findShortcutCount++;
};
Object.assign(window, {
  renderResult: (result: RenderResult, source?: string, documentId = "test") =>
    surface.render(host, result, undefined, (value) => warnings.push(value),
      source === undefined ? undefined : { source, documentId }),
  editorIntent: () => surface.editorIntent(),
  cursorSync: (source: string, line: number) => {
    if (surface.followsEditor) surface.scrollToSource(source, line, "editor");
  },
  getPreviewTarget: (source: string, line: number) => {
    const article = document.querySelector("iframe")!.contentDocument!.querySelector<HTMLElement>("article")!;
    const target = previewAnchorAt(previewAnchors(source, article), line);
    return target && { text: target.element.textContent, line: target.line, endLine: target.endLine };
  },
  benchmarkSync: (source: string, runs = 20) => {
    const doc = document.querySelector("iframe")!.contentDocument!;
    const article = doc.querySelector<HTMLElement>("article")!;
    const build: number[] = [];
    let anchors = previewAnchors(source, article);
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      anchors = previewAnchors(source, article);
      build.push(performance.now() - start);
    }
    const begin = performance.now();
    const visual = readingAnchors(anchors, doc.scrollingElement!.scrollTop);
    const geometryMs = performance.now() - begin;
    const lineCount = source.split("\n").length;
    const height = doc.scrollingElement!.scrollHeight || 1;
    const queryStarted = performance.now();
    for (let i = 0; i < 10000; i++) {
      previewAnchorAt(anchors, 1 + i % lineCount);
      readingAnchorAt(visual, i % height);
    }
    return { build: build.sort((a, b) => a - b), anchors: anchors.length, geometryMs,
      query10kMs: performance.now() - queryStarted };
  },
  warnings,
  getFindShortcutCount: () => findShortcutCount,
  findPreview: (query: string) => surface.find(query),
  nextPreviewFind: (direction: number) => surface.nextFind(direction),
  clearPreviewFind: () => surface.clearFind(),
  scrollPreview: (source: string, line: number) =>
    surface.scrollToSource(source, line),
  enableScrollSync: (source: string) => {
    scrollLines.length = 0;
    surface.setScrollSync(source, (line) => scrollLines.push(line));
  },
  scrollLines,
  renderPreview: (
    engine: MathEngine = "katex",
    css = "",
    html = '<h1>标题</h1><p class="arithmatex">\\(x^2+\\RR\\)</p>',
    theme: RenderResult["theme"] = {
      variant: "modern",
      primary: "indigo",
      accent: "indigo",
    },
  ) => {
    const result: RenderResult = {
      html,
      toc: [],
      meta: {},
      warnings: [],
      profile: "test",
      extensions: [],
      highlightCss: "",
      theme,
      plan: {
        schemaVersion: 3,
        engine: "test",
        engineVersion: "1",
        configRevision: "1",
        documentPath: null,
        math: {
          engine,
          macros:
            engine === "mathjax"
              ? { RR: "\\mathbb{R}" }
              : { "\\RR": "\\mathbb{R}" },
        },
        runtimes: ["tabs", "mermaid"],
        features: { footnoteTooltips: true, inlineStyles: true },
        sources: [],
        extensions: [],
        styles: [{ source: "test.css", css }],
        dependencies: [],
      },
    };
    return surface.render(host, result, undefined, (value) =>
      warnings.push(value),
    );
  },
});
