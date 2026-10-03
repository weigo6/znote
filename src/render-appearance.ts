import type { RenderSettings } from "./render-config";
import type { RenderResult } from "./types";

/** Inputs that can change Markdown HTML or mounted runtimes. */
export function sameRenderInputs(a: RenderSettings, b: RenderSettings) {
  return JSON.stringify([
    a.schemaVersion, a.extensions, a.extensionConfigs,
    a.math, a.mermaid, a.features,
  ]) === JSON.stringify([
    b.schemaVersion, b.extensions, b.extensionConfigs,
    b.math, b.mermaid, b.features,
  ]);
}

export function applyAppearanceToResult(result: RenderResult, settings: RenderSettings) {
  result.theme = {
    variant: settings.variant,
    primary: settings.primary.replaceAll(" ", "-"),
    accent: settings.accent.replaceAll(" ", "-"),
    reader: settings.reader,
  };
  if (result.plan)
    result.plan.styles = settings.customCss
      ? [{ source: "user-custom-css", css: settings.customCss }]
      : [];
}

/** A settings preview may retain Python's expanded extension options. */
export function effectiveWithAppearance(
  effective: RenderSettings | undefined,
  settings: RenderSettings,
): RenderSettings {
  return {
    ...(effective ?? settings),
    variant: settings.variant,
    primary: settings.primary,
    accent: settings.accent,
    reader: settings.reader,
    customCss: settings.customCss,
  };
}
