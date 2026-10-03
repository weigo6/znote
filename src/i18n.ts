import zh from "./locales/zh-CN";
import en from "./locales/en";

/** Add a language resource here to expose it in Settings automatically. */
export const languagePacks = {
  "zh-CN": { name: "简体中文", direction: "ltr", messages: zh },
  en: { name: "English", direction: "ltr", messages: en },
} as const;
export type Language = keyof typeof languagePacks;

export function normalizeLanguage(value: unknown): Language {
  return typeof value === "string" && Object.hasOwn(languagePacks, value) ? value as Language : "zh-CN";
}
let language: Language = "zh-CN";
try {
  language = normalizeLanguage(JSON.parse(localStorage.getItem("znote:preferences") || "{}").language);
} catch { /* Existing or unavailable preferences use the default language. */ }
const listeners = new Set<() => void>();
export const getLanguage = () => language;

/** Source-language message IDs follow the gettext convention. Unknown text passes through. */
export function tr(key: string, values: readonly unknown[] = []): string {
  const messages = languagePacks[language].messages as Record<string, string>;
  const source = zh as Record<string, string>;
  const message = Object.hasOwn(messages, key) ? messages[key] : Object.hasOwn(source, key) ? source[key] : key;
  return message.replace(/\{(\d+)\}/g, (placeholder, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : placeholder);
}

export function onLanguageChange(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}
/** Translate known native diagnostics while retaining filenames and OS error details. */
export function localizeError(value: unknown): string {
  const message = String(value);
  if (language === "zh-CN") return message;
  const prefix = message.startsWith("Error: ") ? "Error: " : "";
  const text = prefix ? message.slice(prefix.length) : message;
  if (Object.hasOwn(zh, text)) return prefix + tr(text);
  for (const key of Object.keys(zh)) {
    if (!key.includes("{0}")) continue;
    const indices: number[] = [];
    const pieces = key.split(/(\{\d+\})/g).map(part => {
      if (/^\{\d+\}$/.test(part)) { indices.push(Number(part.slice(1, -1))); return "([\\s\\S]*?)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    const match = new RegExp(`^${pieces.join("")}$`).exec(text);
    if (match) {
      const parameters: string[] = [];
      indices.forEach((index, i) => parameters[index] = match[i + 1]);
      return prefix + tr(key, parameters);
    }
  }
  return message;
}
export function setLanguage(value: Language) {
  const next = normalizeLanguage(value);
  if (next === language) return;
  language = next;
  for (const callback of listeners) callback();
}

const textBindings = new WeakMap<Text, { key: string; before: string; after: string; rendered: string }>();
const attributeBindings = new WeakMap<Element, Map<string, { key: string; rendered: string }>>();
function messageKey(text: string): string | undefined {
  // Empty translations cannot identify a message: whitespace between layout
  // elements is not a label. Existing bindings still restore intentionally
  // empty labels when switching back to the source language.
  if (!text.trim()) return undefined;
  if (Object.hasOwn(zh, text)) return text;
  for (const pack of Object.values(languagePacks)) {
    const entry = Object.entries(pack.messages).find(([, value]) => value === text);
    if (entry) return entry[0];
  }
}

/** Only call on application-owned chrome; never on note HTML, filenames or editor content. */
export function localizeUi(root: Element, skip = "") {
  const elements = [root, ...root.querySelectorAll("*")];
  for (const element of elements) {
    if (skip && element.closest(skip)) continue;
    let attributes = attributeBindings.get(element);
    if (!attributes) attributeBindings.set(element, attributes = new Map());
    for (const name of ["title", "aria-label", "placeholder"]) {
      const current = element.getAttribute(name);
      if (current === null) continue;
      let binding = attributes.get(name);
      if (binding?.rendered !== current) {
        const key = messageKey(current);
        if (!key) { attributes.delete(name); continue; }
        binding = { key, rendered: current };
        attributes.set(name, binding);
      }
      if (binding) element.setAttribute(name, binding.rendered = tr(binding.key));
    }
    if (element.matches("textarea, script, style")) continue;
    for (const child of element.childNodes) {
      if (child.nodeType !== 3) continue;
      const node = child as Text, current = node.data;
      let binding = textBindings.get(node);
      if (binding?.rendered !== current) {
        const key = messageKey(current.trim());
        if (!key) { textBindings.delete(node); continue; }
        binding = { key, before: current.match(/^\s*/)?.[0] ?? "", after: current.match(/\s*$/)?.[0] ?? "", rendered: current };
        textBindings.set(node, binding);
      }
      if (binding) node.data = binding.rendered = binding.before + tr(binding.key) + binding.after;
    }
  }
}
