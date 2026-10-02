import { PreviewSurface } from "../src/preview-surface";
import "../src/style.css";
import type { RenderResult, MathEngine } from "../src/types";
const surface = new PreviewSurface();
const host = document.querySelector<HTMLElement>("#surface")!;
const warnings: string[] = [];
let findShortcutCount = 0;
const scrollLines: number[] = [];
surface.onFindShortcut = () => {
  findShortcutCount++;
};
Object.assign(window, {
  renderResult: (result: RenderResult) =>
    surface.render(host, result, undefined, (value) => warnings.push(value)),
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
