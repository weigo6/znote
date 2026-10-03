import { describe, expect, it } from "vitest";
import { normalizeRenderSettings } from "./render-config";
import { applyAppearanceToResult, sameRenderInputs } from "./render-appearance";
import type { RenderResult } from "./types";

describe("appearance-only settings", () => {
  it("keeps parser and runtime inputs while appearance changes", () => {
    const base = normalizeRenderSettings(undefined);
    const appearance = structuredClone(base);
    appearance.variant = "classic";
    appearance.reader.width = 960;
    appearance.customCss = "article{color:red}";
    expect(sameRenderInputs(base, appearance)).toBe(true);

    const runtime = structuredClone(base);
    runtime.math.engine = "mathjax";
    expect(sameRenderInputs(base, runtime)).toBe(false);
    const parse = structuredClone(base);
    parse.extensions.admonition = false;
    expect(sameRenderInputs(base, parse)).toBe(false);
  });

  it("applies current appearance to a delayed render result", () => {
    const settings = normalizeRenderSettings(undefined);
    settings.primary = "light blue";
    settings.customCss = "article{color:red}";
    const result: RenderResult = {
      html: "<p>note</p>", toc: [], meta: {}, warnings: [],
      plan: { schemaVersion: 4, math: settings.math, runtimes: [], styles: [] },
    };
    applyAppearanceToResult(result, settings);
    expect(result.theme?.primary).toBe("light-blue");
    expect(result.plan?.styles[0].css).toBe(settings.customCss);
  });
});
