import type { RenderResult } from "./types";

/** Translate application surfaces to document tokens; site chrome is never imported. */
export function readerThemeCss(
  result: Pick<RenderResult, "theme">,
  source: CSSStyleDeclaration,
) {
  const reader = result.theme?.reader ?? {
    preset: "integrated",
    font: "sans",
    lineHeight: 1.8,
    width: 820,
  };
  const tokens: Record<string, string> = {};
  for (const name of [
    "paper",
    "text",
    "heading",
    "secondary",
    "muted",
    "accent",
    "border",
    "hover",
    "code-bg",
    "code",
    "highlight",
    "selection",
  ]) {
    const value = source.getPropertyValue(`--${name}`).trim();
    if (value) tokens[`--znote-${name}`] = value;
  }
  tokens["--reader-width"] = `${reader.width}px`;
  tokens["--reader-line-height"] = String(reader.lineHeight);
  const rules = [
    "--md-default-bg-color:var(--znote-paper)",
    "--md-default-fg-color:var(--znote-text)",
    "--md-default-fg-color--light:var(--znote-secondary)",
    "--md-default-fg-color--lighter:var(--znote-muted)",
    "--md-typeset-color:var(--znote-text)",
    "--md-typeset-table-color:var(--znote-border)",
    "--md-code-bg-color:var(--znote-code-bg)",
    "--md-code-fg-color:var(--znote-text)",
    "--md-typeset-mark-color:var(--znote-highlight)",
  ];
  if (!result.theme?.primary || result.theme.primary === "app")
    rules.push(
      "--md-primary-fg-color:var(--znote-accent)",
      "--md-typeset-a-color:var(--znote-accent)",
    );
  if (!result.theme?.accent || result.theme.accent === "app")
    rules.push("--md-accent-fg-color:var(--znote-accent)");
  if (reader.font === "serif")
    rules.push(
      '--md-text-font-family:"Noto Serif SC","Songti SC","SimSun",Georgia,serif',
    );
  return `:root{${Object.entries(tokens)
    .map(([key, value]) => `${key}:${value}`)
    .join(";")}}:where(.znote-render-scope){${rules.join(";")}}`;
}
