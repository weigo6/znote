import { describe, it, expect } from "vitest";
import {
  normalizeRenderSettings,
  validateRenderSettings,
  extensionGroups,
  readerPresets,
} from "./render-settings";
import cases from "../tests/fixtures/config-cases.json";
import { getField } from "./render-capabilities";

describe("Markdown rendering settings", () => {
  for (const entry of cases)
    it(`shared Python / TypeScript contract: ${entry.name}`, () => {
      const { settings, issues } = validateRenderSettings(entry.input);
      expect(issues.map((issue) => issue.path).sort()).toEqual(
        [...entry.paths].sort(),
      );
      for (const [path, expected] of Object.entries(entry.expected ?? {}))
        expect(getField(settings, path)).toEqual(expected);
    });
  it("normalizes stored extension settings", () => {
    const settings = normalizeRenderSettings({
      extensions: { admonition: false },
      variant: "classic",
    });
    expect(settings.extensions.admonition).toBe(false);
    expect(settings.extensions.tables).toBe(true);
    expect(settings.variant).toBe("classic");
    expect(
      extensionGroups.reduce((count, group) => count + group.items.length, 0),
    ).toBeGreaterThan(20);
  });
  it("ignores invalid persisted values", () => {
    const settings = normalizeRenderSettings({
      mathEngine: "unknown",
      variant: "invalid",
    });
    expect(settings.math.engine).toBe("katex");
    expect(settings.variant).toBe("modern");
  });
  it("accepts a legacy math engine during migration", () => {
    expect(normalizeRenderSettings({ mathEngine: "mathjax" }).math.engine).toBe(
      "mathjax",
    );
  });
  it("provides distinct theme presets and keeps custom CSS", () => {
    expect(
      new Set(
        readerPresets.map(
          (preset) => `${preset.font}/${preset.lineHeight}/${preset.width}`,
        ),
      ).size,
    ).toBe(readerPresets.length);
    expect(
      normalizeRenderSettings({
        reader: { preset: "book" },
        customCss: ":root > * { color: teal; }",
      }),
    ).toMatchObject({
      reader: { font: "serif", lineHeight: 2, width: 720 },
      customCss: ":root > * { color: teal; }",
    });
  });
  it("migrates options without discarding explicit new parameters", () => {
    const settings = normalizeRenderSettings({
      options: { toc_permalink: false, highlight_line_numbers: true },
      extensionConfigs: { toc: { permalink: "#" } },
    });
    expect(settings.extensionConfigs.toc.permalink).toBe("#");
    expect(settings.extensionConfigs["pymdownx.highlight"].linenums).toBe(true);
  });
  it("reports forbidden contracts and malformed macros before saving", () => {
    const result = validateRenderSettings({
      extensionConfigs: { "pymdownx.arithmatex": { generic: false } },
      math: { macros: { bad: { body: "#1", args: 12 } } },
    });
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "extensionConfigs.pymdownx.arithmatex.generic",
        "math.macros.bad",
      ]),
    );
    expect(result.settings.math.macros).toEqual({});
  });
});
