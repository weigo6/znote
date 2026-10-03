import { describe, expect, it } from "vitest";
import { appThemes, normalizeThemeBindings, normalizeThemeMode } from "./app-themes";

describe("application theme preferences", () => {
  it("retains the original pair for existing and malformed preferences", () => {
    for (const stored of [undefined, null, [], "ocean", { light: "removed", dark: false }]) {
      expect(normalizeThemeBindings(stored)).toEqual({ light: "forest", dark: "forest" });
    }
    expect(normalizeThemeBindings({ light: "ocean", dark: "removed" })).toEqual({ light: "ocean", dark: "forest" });
    expect(normalizeThemeBindings({ light: "rose", dark: "graphite" })).toEqual({ light: "rose", dark: "graphite" });
    expect(normalizeThemeMode("system")).toBe("system");
    expect(normalizeThemeMode("dark")).toBe("dark");
    expect(normalizeThemeMode("removed")).toBe("light");
  });

  it("keeps readable body, headings and accent controls in every palette", () => {
    const luminance = (hex: string) => {
      const rgb = hex.slice(1).match(/../g)!.map(value => {
        const channel = parseInt(value, 16) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const contrast = (a: string, b: string) => {
      const first = luminance(a), second = luminance(b);
      return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
    };
    for (const theme of appThemes) for (const mode of ["light", "dark"] as const) {
      const { tokens } = theme[mode];
      for (const foreground of ["text", "heading", "secondary", "accent"] as const) {
        expect(contrast(tokens[foreground], tokens.paper), `${theme.id}/${mode}/${foreground}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(mode === "light" ? "#ffffff" : "#202124", tokens.accent), `${theme.id}/${mode}/button`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
