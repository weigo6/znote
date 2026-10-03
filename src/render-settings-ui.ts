import { invoke, isTauri } from "@tauri-apps/api/core";
import { escapeHtml } from "./preview";
import { PreviewSurface } from "./preview-surface";
import { applyAppearanceToResult, effectiveWithAppearance, sameRenderInputs } from "./render-appearance";
import {
  extensionSpecs,
  fieldSpecs,
  getField,
  setField,
  readerPresets,
} from "./render-capabilities";
import type { OptionSpec, OptionValue } from "./render-capabilities";
import {
  extensionOption,
  normalizeRenderSettings,
  paletteColors,
  validateRenderSettings,
} from "./render-config";
import type { RenderSettings } from "./render-config";
import type { RenderResult } from "./types";
import { readRenderProfiles, writeRenderProfiles } from "./render-profiles";

const select = (path: string, label: string, choices: [string, string][]) =>
  `<div class="setting-row"><label for="${path}">${label}</label><select id="${path}" data-config="${path}">${choices.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></div>`;
const check = (path: string, label: string, hint = "") =>
  `<label class="setting-row"><span>${label}${hint ? `<small>${hint}</small>` : ""}</span><input type="checkbox" data-config="${path}" aria-label="${label}"></label>`;
function optionMarkup(
  id: string,
  name: string,
  spec: OptionSpec,
  value: OptionValue,
) {
  const attrs = `data-extension-option="${escapeHtml(id)}" data-option="${name}"`;
  const label = escapeHtml(spec.label || name);
  if (spec.type === "boolean")
    return `<label class="setting-row"><span>${label}</span><input type="checkbox" ${attrs} ${value ? "checked" : ""}></label>`;
  if (spec.type === "choices")
    return `<div class="setting-row"><span>${label}</span><div class="setting-choices">${spec.values!.map((choice, i) => `<label><input type="checkbox" ${attrs} data-choice="${choice}" ${Array.isArray(value) && value.includes(choice) ? "checked" : ""}>${escapeHtml(spec.labels?.[i] ?? choice)}</label>`).join("")}</div></div>`;
  return `<label class="setting-row"><span>${label}<small>${name}</small></span><input type="text" ${attrs} value="${escapeHtml(String(value))}" maxlength="${spec.maxLength || 100}" ${spec.pattern ? `pattern="${spec.pattern}"` : ""}></label>`;
}

export function renderSettingsMarkup(settings: RenderSettings) {
  return `<div id="render-settings">
    <details class="profile-library"><summary>保存的渲染配置</summary><div class="setting-row"><label for="render-profile">选择配置</label><select id="render-profile"><option value="">选择已保存的配置…</option></select></div><div class="theme-css-actions"><input id="profile-name" type="text" maxlength="60" placeholder="配置名称，如：数学笔记" aria-label="配置名称"><button type="button" id="profile-save">保存当前配置</button><button type="button" id="profile-load">使用配置</button><button type="button" id="profile-remove">删除</button></div><p id="profile-feedback" class="config-feedback" role="status"></p></details>
    <nav class="settings-tabs" aria-label="渲染设置分类">${[
      ["reading", "阅读"],
      ["math", "公式"],
      ["extensions", "语法扩展"],
      ["advanced", "高级"],
    ]
      .map(
        ([id, label], i) =>
          `<button type="button" data-settings-tab="${id}" aria-pressed="${!i}">${label}</button>`,
      )
      .join("")}</nav>
    <div data-settings-panel="reading">
      <div class="settings-section"><h3>阅读排版</h3>
      ${select("reader.preset", "排版预设", [...readerPresets.map((p) => [p.id, p.name] as [string, string]), ["custom", "自定义排版"]])}
      <p id="reader-preset-description" class="muted"></p>
      ${select("reader.font", "正文字体", [
        ["sans", "无衬线"],
        ["serif", "宋体 / 衬线"],
      ])}
      <label class="setting-row"><span>正文行距</span><input type="number" data-config="reader.lineHeight" min="1.4" max="2.2" step="0.1"></label>
      <label class="setting-row"><span>最大栏宽（px）</span><input type="number" data-config="reader.width" min="600" max="1200" step="20"></label>
      <p class="muted">阅读与对照区共用应用底色，并跟随浅色 / 深色。排版预设影响普通正文的字体、行距与栏宽。</p>
      <div class="settings-preview" id="settings-preview" aria-label="阅读效果预览"></div></div>
      <div class="settings-section"><h3>内容交互</h3>
      ${check("features.footnoteTooltips", "脚注悬浮提示", "悬浮或键盘聚焦时查看脚注正文。")}
      ${check("features.codeAnnotations", "代码注释", "将代码注释中的编号与后续有序列表关联。")}
      ${check("features.codeCopy", "代码复制按钮", "复制代码块中的代码文本。")}
      ${check("features.codeSelect", "代码逐行选择", "点击代码行并用 Shift 扩展选择范围。")}
      ${check("mermaid.enabled", "Mermaid 图表")}
      ${select("mermaid.theme", "图表配色", [
        ["auto", "跟随应用"],
        ["neutral", "中性"],
        ["forest", "森林"],
        ["dark", "深色"],
      ])}
      </div>
    </div>
    <div data-settings-panel="math" hidden><div class="settings-section"><h3>数学公式</h3>
      ${select("math.engine", "公式引擎", [
        ["katex", "KaTeX"],
        ["mathjax", "MathJax"],
        ["none", "保留公式原文"],
      ])}
      <p id="math-dependency" class="muted" hidden>数学语法扩展已关闭；此配置会保留，重新启用后生效。</p>
      ${select("math.errorMode", "排版失败时", [
        ["source", "保留原文并提示"],
        ["inline", "在正文标出错误"],
      ])}
      <fieldset data-math-engine="katex"><legend>KaTeX 排版</legend>
        ${check("math.katex.fleqn", "块公式左对齐")}${check("math.katex.leqno", "公式标签显示在左侧")}
        ${select("math.katex.strict", "TeX 严格程度", [
          ["warn", "提示差异"],
          ["ignore", "兼容写法"],
          ["error", "严格校验"],
        ])}
      </fieldset>
      <fieldset data-math-engine="mathjax"><legend>MathJax 排版</legend>
        ${select("math.mathjax.tagSide", "公式标签位置", [
          ["right", "右侧"],
          ["left", "左侧"],
        ])}
      </fieldset>
      <label class="field-label" for="math-macros">自定义命令（JSON）</label>
      <p class="muted">例如 <code>{"RR":"\\\\mathbb{R}"}</code>；参数宏使用 <code>{"norm":{"body":"\\\\lVert #1\\\\rVert","args":1}}</code>。切换引擎会保留命令。</p>
      <textarea id="math-macros" class="config-editor" spellcheck="false">${escapeHtml(JSON.stringify(settings.math.macros, null, 2))}</textarea>
      <button type="button" class="settings-action" id="apply-macros">应用命令</button>
      <p id="macro-error" class="config-feedback" role="status"></p>
      <details><summary>公式识别语法</summary><fieldset data-extension-fields="pymdownx.arithmatex">${Object.entries(
        extensionSpecs.find((e) => e.id === "pymdownx.arithmatex")!.options,
      )
        .map(([name, spec]) =>
          optionMarkup(
            "pymdownx.arithmatex",
            name,
            spec,
            extensionOption(settings, "pymdownx.arithmatex", name),
          ),
        )
        .join("")}</fieldset></details>
      </div></div>
    <div data-settings-panel="extensions" hidden>${[
      ...new Set(extensionSpecs.map((e) => e.group)),
    ]
      .map(
        (group) =>
          `<div class="settings-section"><h3>${group}</h3>${extensionSpecs
            .filter((e) => e.group === group)
            .map(
              (e) =>
                `<div class="extension-settings"><label class="setting-row"><span>${e.label}<small>${e.id}</small></span><input type="checkbox" data-extension="${e.id}" ${settings.extensions[e.id] ? "checked" : ""}></label>${
                  Object.keys(e.options).length &&
                  e.id !== "pymdownx.arithmatex"
                    ? `<details><summary>配置选项</summary><fieldset data-extension-fields="${e.id}">${Object.entries(
                        e.options,
                      )
                        .map(([name, spec]) =>
                          optionMarkup(
                            e.id,
                            name,
                            spec,
                            extensionOption(settings, e.id, name),
                          ),
                        )
                        .join("")}</fieldset></details>`
                    : ""
                }</div>`,
            )
            .join("")}</div>`,
      )
      .join("")}</div>
    <div data-settings-panel="advanced" hidden>
      <div class="settings-section"><h3>组件样式与颜色</h3>
      ${select("variant", "组件样式", [
        ["modern", "Modern"],
        ["classic", "Classic"],
      ])}
      ${select(
        "primary",
        "链接 / 主色",
        paletteColors.map((c) => [c, c === "app" ? "跟随应用" : c]),
      )}
      ${select(
        "accent",
        "交互强调色",
        paletteColors.map((c) => [c, c === "app" ? "跟随应用" : c]),
      )}
      <p class="muted">这些颜色主要用于链接及特殊组件；不改变普通正文的底色和排版。</p></div>
      <div class="settings-section"><h3>文档 HTML 与 CSS</h3>
      ${check("features.inlineStyles", "显示文档内的 CSS", "支持 style 属性与样式块，只影响隔离的阅读区域。文档 JavaScript 不执行。")}
      <label class="field-label" for="theme-css">自定义 CSS 覆盖</label>
      <textarea id="theme-css" class="config-editor" maxlength="262144" spellcheck="false">${escapeHtml(settings.customCss)}</textarea>
      <div class="theme-css-actions"><label class="theme-css-import">导入 CSS<input id="theme-css-file" type="file" accept=".css,text/css" hidden></label><button id="theme-css-clear" type="button">清除覆盖</button></div>
      <p class="muted">自定义 CSS 最后应用。相对资源不随文件导入，可使用 data: URL。</p></div>
      <div class="settings-section"><h3>渲染配置</h3>
      <textarea id="render-config-json" class="config-editor" spellcheck="false">${escapeHtml(JSON.stringify(settings, null, 2))}</textarea>
      <div class="theme-css-actions"><button id="config-apply" type="button">校验并应用</button><button id="config-export" type="button">导出 JSON</button><label class="theme-css-import">导入 JSON<input id="config-import" type="file" accept=".json,application/json" hidden></label><button id="config-reset" type="button">恢复默认</button></div>
      <p id="config-error" class="config-feedback" role="status"></p>
      <details><summary>查看实际生效配置</summary><pre id="config-effective" class="effective-config"></pre></details>
      </div>
    </div>
    <p id="render-setting-error" class="config-feedback" role="status"></p>
  </div>`;
}

export function mountRenderSettings(
  root: HTMLElement,
  initial: RenderSettings,
  change: (settings: RenderSettings) => void,
) {
  let settings = structuredClone(initial),
    disposed = false,
    generation = 0,
    configDirty = false;
  const session = new AbortController(),
    surface = new PreviewSurface();
  let lastResult: RenderResult | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const query = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const feedback = (id: string, message: string) => {
    query(id).textContent = message;
  };
  let profiles = readRenderProfiles(localStorage);
  const syncProfiles = () => {
    const picker = query<HTMLSelectElement>("#render-profile"),
      selected = picker.value;
    picker.innerHTML =
      '<option value="">选择已保存的配置…</option>' +
      profiles
        .map(
          (profile, i) =>
            `<option value="${i}">${escapeHtml(profile.name)}</option>`,
        )
        .join("");
    picker.value = selected;
  };
  const sync = () => {
    root
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-config]")
      .forEach((input) => {
        const value = getField(settings, input.dataset.config!);
        if (input instanceof HTMLInputElement && input.type === "checkbox")
          input.checked = !!value;
        else input.value = String(value);
      });
    query("#reader-preset-description").textContent =
      readerPresets.find((p) => p.id === settings.reader.preset)?.description ||
      "保留你自定义的字体、行距与栏宽。";
    root
      .querySelectorAll<HTMLInputElement>("[data-extension]")
      .forEach((input) => {
        input.checked = settings.extensions[input.dataset.extension!];
      });
    root
      .querySelectorAll<HTMLInputElement>("[data-extension-option]")
      .forEach((input) => {
        const value = extensionOption(
          settings,
          input.dataset.extensionOption!,
          input.dataset.option!,
        );
        if (input.dataset.choice)
          input.checked =
            Array.isArray(value) && value.includes(input.dataset.choice);
        else if (input.type === "checkbox") input.checked = !!value;
        else if (document.activeElement !== input) input.value = String(value);
      });
    root
      .querySelectorAll<HTMLFieldSetElement>("[data-math-engine]")
      .forEach((el) => {
        el.disabled =
          el.dataset.mathEngine !== settings.math.engine ||
          !settings.extensions["pymdownx.arithmatex"];
      });
    query("#math-dependency").hidden =
      settings.extensions["pymdownx.arithmatex"];
    root
      .querySelectorAll<HTMLFieldSetElement>("[data-extension-fields]")
      .forEach((el) => {
        el.disabled = !settings.extensions[el.dataset.extensionFields!];
      });
    if (!configDirty)
      query<HTMLTextAreaElement>("#render-config-json").value = JSON.stringify(
        settings,
        null,
        2,
      );
  };
  const sample =
    "# 阅读，从一段普通文字开始\n\n字体、行距与栏宽决定阅读的节奏。这里没有链接或特殊语法，也能看出排版预设之间的差异。\n\n## 留下清晰的思路\n\n这是第二段笔记。底色与应用一致，切换深色时同样保持协调。";
  const preview = async (revision: number) => {
    const current = structuredClone(settings);
    try {
      const result: RenderResult = isTauri()
        ? await invoke("render_markdown", {
            text: sample,
            path: null,
            settings: current,
            includeEffectiveConfig: true,
          })
        : {
            html: "<h1>阅读，从一段普通文字开始</h1><p>字体、行距与栏宽决定阅读的节奏。这里没有链接或特殊语法，也能看出排版预设之间的差异。</p><h2>留下清晰的思路</h2><p>这是第二段笔记。底色与应用一致，切换深色时同样保持协调。</p>",
            toc: [],
            meta: {},
            warnings: [],
            effectiveConfig: current,
            theme: {
              variant: current.variant,
              primary: current.primary,
              accent: current.accent,
              reader: current.reader,
            },
            plan: {
              schemaVersion: 4,
              math: current.math,
              mermaid: current.mermaid,
              features: current.features,
              runtimes: [],
              styles: current.customCss
                ? [{ source: "user", css: current.customCss }]
                : [],
            },
          };
      if (disposed || revision !== generation) return;
      applyAppearanceToResult(result, settings);
      await surface.render(query("#settings-preview"), result);
      if (!disposed && revision === generation) {
        surface.updateAppearance(settings);
        lastResult = result;
        query("#config-effective").textContent = JSON.stringify(
          effectiveWithAppearance(result.effectiveConfig, settings),
          null,
          2,
        );
      }
    } catch (error) {
      if (!disposed && revision === generation)
        feedback("#render-setting-error", String(error));
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    generation++;
    surface.cancel();
    timer = setTimeout(() => void preview(generation), 180);
  };
  const apply = (candidate: unknown, errorId = "#render-setting-error") => {
    const validated = validateRenderSettings(candidate);
    if (validated.issues.length) {
      feedback(
        errorId,
        validated.issues.map((i) => `${i.path}：${i.message}`).join("\n"),
      );
      return false;
    }
    const previous = settings;
    settings = validated.settings;
    feedback(errorId, "");
    change(structuredClone(settings));
    sync();
    if (sameRenderInputs(previous, settings) && surface.updateAppearance(settings)) {
      query("#config-effective").textContent = JSON.stringify(
        effectiveWithAppearance(lastResult?.effectiveConfig, settings),
        null,
        2,
      );
    } else schedule();
    return true;
  };
  root.addEventListener(
    "change",
    async (event) => {
      const input = event.target as HTMLInputElement | HTMLSelectElement;
      if (input.dataset.config) {
        const draft = structuredClone(settings) as unknown as Record<
          string,
          unknown
        >;
        const path = input.dataset.config,
          spec = fieldSpecs[path];
        const value =
          input instanceof HTMLInputElement && input.type === "checkbox"
            ? input.checked
            : spec?.type === "integer" || spec?.type === "number"
              ? Number(input.value)
              : input.value;
        if (path === "reader.preset" && value !== "custom") {
          const preset = readerPresets.find((p) => p.id === value)!;
          draft.reader = {
            preset: preset.id,
            font: preset.font,
            lineHeight: preset.lineHeight,
            width: preset.width,
          };
        } else {
          setField(draft, path, value);
          if (path.startsWith("reader.") && path !== "reader.preset")
            setField(draft, "reader.preset", "custom");
        }
        apply(draft);
      } else if (input.dataset.extension) {
        const draft = structuredClone(settings);
        draft.extensions[input.dataset.extension] = (
          input as HTMLInputElement
        ).checked;
        apply(draft);
      } else if (input.dataset.extensionOption) {
        const id = input.dataset.extensionOption,
          name = input.dataset.option!,
          spec = extensionSpecs.find((e) => e.id === id)!.options[name];
        const draft = structuredClone(settings);
        let value: OptionValue =
          spec.type === "boolean"
            ? (input as HTMLInputElement).checked
            : input.value;
        if (
          spec.type === "booleanOrText" &&
          ["true", "false"].includes(String(value))
        )
          value = value === "true";
        if (spec.type === "choices")
          value = Array.from(
            root.querySelectorAll<HTMLInputElement>("[data-extension-option]"),
          )
            .filter(
              (el) =>
                el.dataset.extensionOption === id &&
                el.dataset.option === name &&
                el.checked,
            )
            .map((el) => el.dataset.choice!);
        (draft.extensionConfigs[id] ??= {})[name] = value;
        apply(draft);
      } else if (
        input.id === "theme-css-file" ||
        input.id === "config-import"
      ) {
        const file = (input as HTMLInputElement).files?.[0];
        if (!file) return;
        const limit = input.id === "theme-css-file" ? 262144 : 1048576;
        if (file.size > limit) {
          feedback(
            "#config-error",
            input.id === "theme-css-file"
              ? "CSS 超过 256 KB。"
              : "配置超过 1 MB。",
          );
          return;
        }
        const text = await file.text();
        if (disposed) return;
        if (input.id === "theme-css-file") {
          apply({ ...settings, customCss: text });
          query<HTMLTextAreaElement>("#theme-css").value = text;
        } else {
          configDirty = true;
          query<HTMLTextAreaElement>("#render-config-json").value = text;
          feedback("#config-error", "已载入配置草稿，请校验并应用。");
        }
        input.value = "";
      }
    },
    { signal: session.signal },
  );
  root.addEventListener(
    "click",
    async (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "button",
      );
      if (!button) return;
      if (button.dataset.settingsTab) {
        root
          .querySelectorAll<HTMLElement>("[data-settings-panel]")
          .forEach((el) => {
            el.hidden = el.dataset.settingsPanel !== button.dataset.settingsTab;
          });
        root
          .querySelectorAll<HTMLElement>("[data-settings-tab]")
          .forEach((el) =>
            el.setAttribute("aria-pressed", String(el === button)),
          );
        return;
      }
      try {
        if (button.id === "profile-save") {
          const name = query<HTMLInputElement>("#profile-name").value.trim();
          if (!name) {
            feedback("#profile-feedback", "请填写配置名称。");
            return;
          }
          const next = profiles.filter((profile) => profile.name !== name);
          if (next.length >= 20) {
            feedback("#profile-feedback", "最多保存 20 个配置。");
            return;
          }
          next.push({ name, settings: structuredClone(settings) });
          writeRenderProfiles(localStorage, next);
          profiles = next;
          syncProfiles();
          feedback("#profile-feedback", `已保存：${name}`);
        }
        if (button.id === "profile-load" || button.id === "profile-remove") {
          const selected = query<HTMLSelectElement>("#render-profile").value,
            profile = selected ? profiles[Number(selected)] : undefined;
          if (!profile) {
            feedback("#profile-feedback", "请先选择一个配置。");
            return;
          }
          if (button.id === "profile-load") {
            configDirty = false;
            apply(profile.settings);
            query<HTMLTextAreaElement>("#math-macros").value = JSON.stringify(
              settings.math.macros,
              null,
              2,
            );
            query<HTMLTextAreaElement>("#theme-css").value = settings.customCss;
            feedback("#profile-feedback", `已使用：${profile.name}`);
          } else {
            const next = profiles.filter((item) => item !== profile);
            writeRenderProfiles(localStorage, next);
            profiles = next;
            syncProfiles();
            feedback("#profile-feedback", `已删除：${profile.name}`);
          }
        }
        if (button.id === "apply-macros") {
          if (
            apply(
              {
                ...settings,
                math: {
                  ...settings.math,
                  macros: JSON.parse(
                    query<HTMLTextAreaElement>("#math-macros").value,
                  ),
                },
              },
              "#macro-error",
            )
          )
            feedback("#macro-error", "命令已应用。");
        }
        if (button.id === "config-apply") {
          if (
            apply(
              JSON.parse(
                query<HTMLTextAreaElement>("#render-config-json").value,
              ),
              "#config-error",
            )
          ) {
            configDirty = false;
            sync();
            query<HTMLTextAreaElement>("#math-macros").value = JSON.stringify(
              settings.math.macros,
              null,
              2,
            );
            query<HTMLTextAreaElement>("#theme-css").value = settings.customCss;
            feedback("#config-error", "配置已应用。");
          }
        }
        if (button.id === "config-reset") {
          configDirty = false;
          apply(normalizeRenderSettings(undefined));
          query<HTMLTextAreaElement>("#math-macros").value = "{}";
          query<HTMLTextAreaElement>("#theme-css").value = "";
        }
        if (button.id === "theme-css-clear") {
          apply({ ...settings, customCss: "" });
          query<HTMLTextAreaElement>("#theme-css").value = "";
        }
        if (button.id === "config-export") {
          if (isTauri()) {
            const path = await invoke<string | null>("export_render_settings", {
              settings,
            });
            if (!disposed && path) feedback("#config-error", `已导出：${path}`);
          } else {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(settings, null, 2)], {
                type: "application/json",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "znote-render-settings.json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
        }
      } catch (error) {
        if (!disposed)
          feedback(
            button.id === "apply-macros" ? "#macro-error" : "#config-error",
            `配置未应用：${String(error)}`,
          );
      }
    },
    { signal: session.signal },
  );
  query<HTMLTextAreaElement>("#render-config-json").addEventListener(
    "input",
    () => {
      configDirty = true;
    },
    { signal: session.signal },
  );
  query<HTMLTextAreaElement>("#theme-css").addEventListener(
    "input",
    (event) => {
      apply({
        ...settings,
        customCss: (event.target as HTMLTextAreaElement).value,
      });
    },
    { signal: session.signal },
  );
  syncProfiles();
  sync();
  schedule();
  return () => {
    disposed = true;
    generation++;
    clearTimeout(timer);
    session.abort();
    surface.dispose();
  };
}
