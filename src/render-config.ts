import type { MathSettings, ReaderSettings } from "./types";
import {
  capabilities,
  extensionSpecs,
  fieldSpecs,
  getField,
  setField,
  validOption,
} from "./render-capabilities";
import type { OptionValue } from "./render-capabilities";
export { extensionGroups, readerPresets } from "./render-capabilities";

export const paletteColors = [
  "app",
  "red",
  "pink",
  "purple",
  "deep purple",
  "indigo",
  "blue",
  "light blue",
  "cyan",
  "teal",
  "green",
  "light green",
  "lime",
  "yellow",
  "amber",
  "orange",
  "deep orange",
  "brown",
  "grey",
  "blue grey",
  "black",
  "white",
] as const;
export interface RenderSettings {
  schemaVersion: number;
  math: MathSettings;
  reader: ReaderSettings;
  variant: "modern" | "classic";
  primary: string;
  accent: string;
  customCss: string;
  mermaid: { enabled: boolean; theme: "auto" | "neutral" | "forest" | "dark" };
  features: { footnoteTooltips: boolean; inlineStyles: boolean };
  extensions: Record<string, boolean>;
  extensionConfigs: Record<string, Record<string, OptionValue>>;
}
export interface ConfigIssue {
  path: string;
  message: string;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Migration never changes the original preferences in place. */
function migrate(input: unknown) {
  const data = structuredClone(record(input));
  if (
    data.mathEngine !== undefined &&
    getField(data, "math.engine") === undefined
  )
    setField(data, "math.engine", data.mathEngine);
  if (typeof data.mermaid === "boolean")
    data.mermaid = { enabled: data.mermaid };
  const legacy = record(data.options),
    configs = record(data.extensionConfigs);
  for (const extension of extensionSpecs)
    for (const [name, spec] of Object.entries(extension.options)) {
      if (spec.legacy && legacy[spec.legacy] !== undefined) {
        const options = record(configs[extension.id]);
        if (options[name] === undefined) options[name] = legacy[spec.legacy];
        configs[extension.id] = options;
      }
    }
  data.extensionConfigs = configs;
  delete data.mathEngine;
  delete data.options;
  delete data.themePreset;
  return data;
}

export function validateRenderSettings(input: unknown): {
  settings: RenderSettings;
  issues: ConfigIssue[];
} {
  const data = migrate(input);
  const result: Record<string, unknown> = {
    schemaVersion: capabilities.schemaVersion,
  };
  const issues: ConfigIssue[] = [];
  const issue = (path: string, message = "参数类型或取值无效") =>
    issues.push({ path, message });
  const original = record(input);
  if (
    original.extensionConfigs !== undefined &&
    (original.extensionConfigs === null ||
      typeof original.extensionConfigs !== "object" ||
      Array.isArray(original.extensionConfigs))
  )
    issue("extensionConfigs", "应为配置对象");
  if (
    input !== undefined &&
    (input === null || typeof input !== "object" || Array.isArray(input))
  )
    issue("settings", "设置应为配置对象");
  if (
    data.schemaVersion !== undefined &&
    (typeof data.schemaVersion !== "number" ||
      ![1, 2, 3].includes(data.schemaVersion))
  )
    issue("schemaVersion", "配置版本不受支持");
  const preset = capabilities.readerPresets.find(
    (item) => item.id === getField(data, "reader.preset"),
  );
  for (const [path, spec] of Object.entries(fieldSpecs)) {
    const supplied = getField(data, path);
    const presetValue =
      preset && path.startsWith("reader.")
        ? getField(preset, path.slice(7))
        : undefined;
    if (supplied !== undefined && !validOption(supplied, spec)) issue(path);
    setField(
      result,
      path,
      structuredClone(
        supplied !== undefined && validOption(supplied, spec)
          ? supplied
          : (presetValue ?? spec.default),
      ),
    );
  }
  for (const name of ["primary", "accent"] as const) {
    const value = data[name];
    if (
      value !== undefined &&
      !paletteColors.includes(value as (typeof paletteColors)[number])
    )
      issue(name);
    result[name] = paletteColors.includes(
      value as (typeof paletteColors)[number],
    )
      ? value
      : "app";
  }
  if (
    data.customCss !== undefined &&
    (typeof data.customCss !== "string" || data.customCss.length > 262144)
  )
    issue("customCss", "CSS 必须为文本，且不超过 256 KB");
  result.customCss =
    typeof data.customCss === "string" ? data.customCss.slice(0, 262144) : "";
  const enabled = record(data.extensions),
    configs = record(data.extensionConfigs);
  if (
    data.extensions !== undefined &&
    (data.extensions === null ||
      typeof data.extensions !== "object" ||
      Array.isArray(data.extensions))
  )
    issue("extensions", "应为配置对象");
  result.extensions = Object.fromEntries(
    extensionSpecs.map((item) => {
      if (
        enabled[item.id] !== undefined &&
        typeof enabled[item.id] !== "boolean"
      )
        issue(`extensions.${item.id}`);
      return [item.id, enabled[item.id] !== false];
    }),
  );
  const normalized: Record<string, Record<string, OptionValue>> = {};
  for (const extension of extensionSpecs) {
    const options = record(configs[extension.id]);
    if (
      configs[extension.id] !== undefined &&
      (typeof configs[extension.id] !== "object" ||
        Array.isArray(configs[extension.id]) ||
        configs[extension.id] === null)
    )
      issue(`extensionConfigs.${extension.id}`);
    for (const [key, value] of Object.entries(options)) {
      const spec = extension.options[key];
      if (!spec)
        issue(
          `extensionConfigs.${extension.id}.${key}`,
          "此参数未开放，不能覆盖内部渲染契约",
        );
      else if (
        !validOption(value, spec) ||
        (key === "toc_depth" &&
          typeof value === "string" &&
          value.includes("-") &&
          value[0] > value[2])
      )
        issue(`extensionConfigs.${extension.id}.${key}`);
      else (normalized[extension.id] ??= {})[key] = value;
    }
  }
  const ids = new Set(extensionSpecs.map((item) => item.id));
  for (const id of Object.keys(enabled))
    if (!ids.has(id)) issue(`extensions.${id}`, "未内置此扩展");
  for (const id of Object.keys(configs))
    if (!ids.has(id)) issue(`extensionConfigs.${id}`, "未内置此扩展");
  result.extensionConfigs = normalized;
  const macros = record(getField(data, "math.macros"));
  const normalizedMacros: MathSettings["macros"] = Object.create(null);
  if (Object.keys(macros).length > 100)
    issue("math.macros", "最多定义 100 个宏");
  const rawMacros = getField(data, "math.macros");
  if (
    rawMacros !== undefined &&
    (rawMacros === null ||
      typeof rawMacros !== "object" ||
      Array.isArray(rawMacros))
  )
    issue("math.macros", "宏应为配置对象");
  for (const [rawName, raw] of Object.entries(macros).slice(0, 100)) {
    const name = rawName.replace(/^\\/, ""),
      value =
        typeof raw === "string"
          ? {
              body: raw,
              args: Math.max(
                0,
                ...Array.from(raw.matchAll(/#([1-9])/g), (match) =>
                  Number(match[1]),
                ),
              ),
            }
          : record(raw);
    if (
      !/^[A-Za-z]{1,40}$/.test(name) ||
      typeof value.body !== "string" ||
      value.body.length > 4096 ||
      !Number.isInteger(value.args) ||
      Number(value.args) < 0 ||
      Number(value.args) > 9 ||
      Object.keys(value).some((key) => key !== "body" && key !== "args")
    )
      issue(
        `math.macros.${rawName}`,
        "宏名仅含英文字母；参数数为 0–9；展开内容不超过 4096 字符",
      );
    else if (Object.hasOwn(normalizedMacros, name))
      issue(`math.macros.${rawName}`, "宏名重复");
    else
      normalizedMacros[name] = { body: value.body, args: Number(value.args) };
  }
  setField(result, "math.macros", normalizedMacros);
  const topKeys = new Set([
    "schemaVersion",
    "math",
    "reader",
    "variant",
    "primary",
    "accent",
    "customCss",
    "mermaid",
    "features",
    "extensions",
    "extensionConfigs",
  ]);
  for (const key of Object.keys(data))
    if (!topKeys.has(key)) issue(key, "未知配置字段");
  for (const branch of [
    "reader",
    "features",
    "mermaid",
    "math",
    "math.katex",
    "math.mathjax",
  ]) {
    const value = getField(data, branch);
    if (
      value !== undefined &&
      (value === null || typeof value !== "object" || Array.isArray(value))
    ) {
      issue(branch, "应为配置对象");
      continue;
    }
    for (const key of Object.keys(record(value))) {
      const path = `${branch}.${key}`;
      if (
        path !== "math.macros" &&
        !Object.keys(fieldSpecs).some(
          (field) => field === path || field.startsWith(`${path}.`),
        )
      )
        issue(path, "未知配置字段");
    }
  }
  return { settings: result as unknown as RenderSettings, issues };
}
export function normalizeRenderSettings(input: unknown): RenderSettings {
  return validateRenderSettings(input).settings;
}
export function extensionOption(
  settings: RenderSettings,
  id: string,
  name: string,
): OptionValue {
  return (
    settings.extensionConfigs[id]?.[name] ??
    structuredClone(
      extensionSpecs.find((item) => item.id === id)!.options[name].default,
    )
  );
}
