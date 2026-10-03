import { afterEach, describe, expect, it } from "vitest";
import zh from "./locales/zh-CN";
import en from "./locales/en";
import { normalizeLanguage, setLanguage, tr, onLanguageChange, localizeError } from "./i18n";

afterEach(() => setLanguage("zh-CN"));
describe("language resources", () => {
  it("provides complete English translations with the same interpolation parameters", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).not.toMatch(/\p{Script=Han}/u);
      const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });
  it("normalizes old preferences and preserves unknown labels and parameter contents", () => {
    expect(normalizeLanguage(undefined)).toBe("zh-CN");
    expect(normalizeLanguage("removed-language")).toBe("zh-CN");
    expect(normalizeLanguage("en")).toBe("en");
    setLanguage("en");
    expect(tr("设置")).toBe("Settings");
    expect(tr("已保存：{0}", ["{0} notes.md"])).toBe("Saved: {0} notes.md");
    expect(tr("unknown message")).toBe("unknown message");
    expect(tr("行")).toBe("");
    expect(tr("已保存：{0}")).toBe("Saved: {0}");
  });
  it("notifies once per change and disposes listeners", () => {
    let changes = 0;
    const dispose = onLanguageChange(() => changes++);
    setLanguage("en");
    setLanguage("en");
    expect(changes).toBe(1);
    dispose();
    setLanguage("zh-CN");
    expect(changes).toBe(1);
  });
  it("translates known native errors while retaining filenames and unknown diagnostics", () => {
    setLanguage("en");
    expect(localizeError("尚未打开文件夹")).toBe("No folder is open");
    expect(localizeError(new Error("无法访问 D:\\中文笔记.md：Access denied"))).toBe("Error: Cannot access D:\\中文笔记.md: Access denied");
    expect(localizeError("unknown native error")).toBe("unknown native error");
  });
});
