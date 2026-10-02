// MathJax 3 matches the integration used by the bundled Zensical generation.
// Static imports and SVG font paths make this runtime independent of a CDN.
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js";
import DOMPurify from "dompurify";
import type { MathSettings } from "./types";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
export function createMathJax(settings: MathSettings) {
  const macros = Object.fromEntries(
    Object.entries(settings.macros).map(([name, value]) => [
      name.replace(/^\\/, ""),
      typeof value === "string"
        ? value
        : value.args
          ? [value.body, value.args]
          : value.body,
    ]),
  );
  const document = mathjax.document("", {
    InputJax: new TeX({
      packages: ["base", "ams", "newcommand", "configmacros"],
      macros,
      tagSide: settings.mathjax?.tagSide ?? "right",
      maxMacros: 1000,
      maxBuffer: 16384,
      formatError: (_jax: unknown, error: Error) => {
        throw error;
      },
    }),
    OutputJax: new SVG({ fontCache: "none" }),
  });
  return (source: string, display: boolean) => {
    const node = document.convert(source, { display });
    // Strip MathJax's wrapper; retain only its generated SVG.
    const svg = adaptor.innerHTML(node);
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
  };
}
