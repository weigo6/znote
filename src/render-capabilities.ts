import manifest from "../config/render-capabilities.json";

export type OptionValue = boolean | string | number | string[];
export interface OptionSpec {
  label?: string;
  type: string;
  default: OptionValue;
  values?: string[];
  labels?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
  legacy?: string;
}
export interface ExtensionSpec {
  id: string;
  label: string;
  group: string;
  options: Record<string, OptionSpec>;
}
export const capabilities = manifest;
export const extensionSpecs = manifest.extensions as ExtensionSpec[];
export const fieldSpecs = manifest.fields as Record<string, OptionSpec>;
export const readerPresets = manifest.readerPresets;
export const extensionGroups = [
  ...new Set(extensionSpecs.map((item) => item.group)),
].map((title) => ({
  title,
  items: extensionSpecs
    .filter((item) => item.group === title)
    .map((item) => [item.id, item.label]),
}));

export function validOption(
  value: unknown,
  spec: OptionSpec,
): value is OptionValue {
  switch (spec.type) {
    case "boolean":
      return typeof value === "boolean";
    case "booleanOrText":
      return (
        typeof value === "boolean" ||
        (typeof value === "string" && value.length <= (spec.maxLength ?? 100))
      );
    case "enum":
      return typeof value === "string" && !!spec.values?.includes(value);
    case "choices":
      return (
        Array.isArray(value) &&
        value.every(
          (item) => typeof item === "string" && spec.values?.includes(item),
        ) &&
        new Set(value).size === value.length
      );
    case "text":
      return (
        typeof value === "string" &&
        value.length <= (spec.maxLength ?? 1000) &&
        (!spec.pattern || new RegExp(spec.pattern).test(value))
      );
    case "integer":
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (spec.type !== "integer" || Number.isInteger(value)) &&
        value >= (spec.min ?? -Infinity) &&
        value <= (spec.max ?? Infinity)
      );
    default:
      return false;
  }
}
export function getField(object: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      object,
    );
}
export function setField(
  object: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const keys = path.split(".");
  let target = object;
  for (const key of keys.slice(0, -1)) {
    if (
      !target[key] ||
      typeof target[key] !== "object" ||
      Array.isArray(target[key])
    )
      target[key] = {};
    target = target[key] as Record<string, unknown>;
  }
  target[keys[keys.length - 1]] = value;
}
