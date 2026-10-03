import type { RenderSettings } from "./render-config";

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
  effectiveConfig?: RenderSettings;
  html: string;
  toc: { name: string; id: string; level: number; children: unknown[] }[];
  meta: Record<string, unknown>;
  warnings: string[];
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
  schemaVersion: 4;
  math: MathSettings;
  features?: { footnoteTooltips: boolean; codeAnnotations?: boolean; codeCopy?: boolean; codeSelect?: boolean; inlineStyles: boolean };
  mermaid?: { enabled: boolean; theme: "auto" | "neutral" | "forest" | "dark" };
  revisions?: { parse: string; runtime: string };
  runtimes: string[];
  styles: { source: string; css: string }[];
}
export type Mode = "source" | "split" | "read";
