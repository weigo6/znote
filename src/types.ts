export interface DiskDocument {
  path: string;
  text: string;
  hash: string;
  bom: boolean;
  eol: string;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  children: FileEntry[];
}
export interface Workspace {
  root: string;
  name: string;
  entries: FileEntry[];
  truncated: boolean;
}
export interface RenderResult {
  sourceMap?: {
    version: 1;
    offsetEncoding: "utf-16";
    entries: SourceLocation[];
  };
  plan?: RenderPlan;
  html: string;
  toc: { name: string; id: string; level: number; children: unknown[] }[];
  meta: Record<string, unknown>;
  warnings: string[];
  profile: string;
  extensions: string[];
  highlightCss: string;
  theme?: {
    variant: "modern" | "classic";
    primary: string;
    accent: string;
    reader?: ReaderSettings;
  };
}
export interface SourceLocation {
  id: string;
  kind: string;
  precision: "exact" | "inherited" | "generated";
  from?: number;
  to?: number;
  parentId?: string;
}
export type MathEngine = "katex" | "mathjax" | "none";
export interface MacroDefinition {
  body: string;
  args: number;
}
export interface MathSettings {
  engine: MathEngine;
  macros: Record<string, MacroDefinition | string>;
  errorMode?: "source" | "inline";
  katex?: {
    fleqn: boolean;
    leqno: boolean;
    strict: "ignore" | "warn" | "error";
  };
  mathjax?: { tagSide: "left" | "right" };
}
export interface ReaderSettings {
  preset: string;
  font: "sans" | "serif";
  lineHeight: number;
  width: number;
}
export interface RenderPlan {
  schemaVersion: number;
  engine: string;
  engineVersion: string;
  configRevision: string;
  documentPath: string | null;
  extensions: string[];
  math: MathSettings;
  features?: { footnoteTooltips: boolean; inlineStyles: boolean };
  mermaid?: { enabled: boolean; theme: "auto" | "neutral" | "forest" | "dark" };
  effectiveConfig?: Record<string, unknown>;
  revisions?: { parse: string; runtime: string; style: string };
  runtimes: string[];
  styles: { source: string; css: string }[];
  dependencies: { path: string; hash: string }[];
}
export type Mode = "source" | "split" | "read";
