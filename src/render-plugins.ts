import DOMPurify from "dompurify";
import type { RenderPlan } from "./types";
import { mountCodeAnnotations } from "./code-annotations";
import { mountZensicalCodeBlocks } from "./zensical-code";
let sequence = 0;
let mermaidReady: Promise<(typeof import("mermaid"))["default"]> | undefined;
let mermaidQueue: Promise<unknown> = Promise.resolve();
const mermaidSources = new WeakMap<HTMLElement, string>();
export interface RuntimeContext {
  container: HTMLElement;
  plan?: RenderPlan;
  path?: string;
  signal: AbortSignal;
  diagnostic: (message: string) => void;
  onMathMarkup?: (element: HTMLElement, markup: string) => void;
}
export interface RuntimePlugin {
  id: string;
  mount(context: RuntimeContext): Promise<void> | void;
}
const plugins: RuntimePlugin[] = [
  {
    id: "math",
    async mount({ container, plan, signal, diagnostic, onMathMarkup }) {
      const engine = plan?.math.engine ?? "katex";
      if (engine === "none" || !container.querySelector(".arithmatex")) return;
      const settings = plan?.math ?? { engine, macros: {} };
      const macros = Object.fromEntries(
        Object.entries(settings.macros).map(([name, value]) => [
          "\\" + name.replace(/^\\/, ""),
          typeof value === "string" ? value : value.body,
        ]),
      );
      const render =
        engine === "mathjax"
          ? (await import("./runtime-mathjax")).createMathJax(settings)
          : await import("katex").then(
              ({ default: katex }) =>
                (source: string, display: boolean) =>
                  katex.renderToString(source, {
                    displayMode: display,
                    throwOnError: true,
                    trust: false,
                    macros,
                    maxExpand: 1000,
                    maxSize: 20,
                    ...settings.katex,
                  }),
            );
      if (signal.aborted) return;
      let sliceStarted = performance.now();
      for (const el of container.querySelectorAll<HTMLElement>(".arithmatex")) {
        if (signal.aborted) return;
        let source = el.textContent || "";
        if (
          (source.startsWith("\\(") && source.endsWith("\\)")) ||
          (source.startsWith("\\[") && source.endsWith("\\]"))
        )
          source = source.slice(2, -2);
        try {
          const markup = render(source, el.tagName !== "SPAN");
          if (onMathMarkup) onMathMarkup(el, markup);
          else el.innerHTML = markup;
        } catch (error) {
          el.classList.add("math-error");
          el.title = String(error);
          if (settings.errorMode === "inline")
            el.textContent = `公式错误：${source}`;
          diagnostic(`公式排版失败：${String(error)}`);
        }
        if (onMathMarkup && performance.now() - sliceStarted > 8) {
          await new Promise<void>((resolve) =>
            container.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()),
          );
          sliceStarted = performance.now();
        }
      }
    },
  },
  {
    id: "tabs",
    mount({ container }) {
      container.querySelectorAll<HTMLElement>(".tabbed-set").forEach((set) => {
        const labels = set.querySelectorAll<HTMLElement>(
          ":scope > .tabbed-labels > label",
        );
        const panels = set.querySelectorAll<HTMLElement>(
          ":scope > .tabbed-content > .tabbed-block",
        );
        if (!labels.length) return;
        const inputs = set.querySelectorAll<HTMLInputElement>(":scope > input");
        const select = (i: number) => {
          inputs.forEach((input, n) => (input.checked = n === i));
          labels.forEach((l, n) => {
            l.classList.toggle("selected", n === i);
            l.setAttribute("aria-selected", String(n === i));
          });
          panels.forEach((p, n) => (p.hidden = n !== i));
        };
        labels.forEach((label, i) => {
          label.removeAttribute("for");
          label.tabIndex = 0;
          label.setAttribute("role", "tab");
          label.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            select(i);
          };
          label.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              select(i);
            }
          };
        });
        select(0);
      });
    },
  },
  {
    id: "mermaid",
    async mount({ container, plan, signal, diagnostic }) {
      const diagrams = [
        ...(container.matches(".mermaid") ? [container] : []),
        ...container.querySelectorAll<HTMLElement>(".mermaid"),
      ];
      if (diagrams.length) {
        mermaidReady ??= import("mermaid").then((m) => m.default);
        const mermaid = await mermaidReady;
        for (const diagram of diagrams) {
          try {
            let source = mermaidSources.get(diagram);
            if (source === undefined) {
              source = diagram.textContent || "";
              mermaidSources.set(diagram, source);
            }
            const result = (await (mermaidQueue = mermaidQueue
              .catch(() => {})
              .then(async () => {
                if (signal.aborted) return undefined;
                const selected = plan?.mermaid?.theme ?? "auto";
                const dark = document.documentElement.dataset.theme === "dark";
                mermaid.initialize({
                  startOnLoad: false,
                  securityLevel: "strict",
                  htmlLabels: false,
                  secure: [
                    "securityLevel",
                    "startOnLoad",
                    "htmlLabels",
                    "theme",
                  ],
                  theme:
                    selected === "auto"
                      ? dark
                        ? "dark"
                        : "neutral"
                      : selected,
                  fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
                });
                return mermaid.render(
                  "zn-diagram-" + sequence++,
                  source,
                );
              }))) as { svg: string } | undefined;
            if (!signal.aborted && result)
              diagram.innerHTML = DOMPurify.sanitize(result.svg, {
                USE_PROFILES: { svg: true, svgFilters: true },
              });
          } catch {
            if (signal.aborted) return;
            diagnostic("Mermaid 图表无法生成，请检查语法");
            diagram.classList.add("diagram-error");
            diagram.title = "图表尚未完成，请检查 Mermaid 语法";
          }
        }
      }
    },
  },
];
export async function mountRuntimes(
  context: RuntimeContext,
  selected?: ReadonlySet<string>,
) {
  for (const plugin of plugins) {
    if (context.signal.aborted) return;
    if (selected && !selected.has(plugin.id)) continue;
    if (
      plugin.id !== "math" &&
      context.plan &&
      !context.plan.runtimes.includes(plugin.id)
    )
      continue;
    try {
      await plugin.mount(context);
    } catch (error) {
      context.diagnostic(`${plugin.id}: ${String(error)}`);
    }
  }
}

/** Interactions attach to the committed article, including reused nodes. */
export function mountInteractions({ container, plan, path, signal }: RuntimeContext) {
  if (signal.aborted) return;
  mountZensicalCodeBlocks(container, {
    copy: plan?.features?.codeCopy === true,
    select: plan?.features?.codeSelect === true,
  }, signal);
  mountCodeAnnotations(container, plan?.features?.codeAnnotations === true, signal,
    path);
  if (!plan?.features?.footnoteTooltips) return;
  const doc = container.ownerDocument,
    view = doc.defaultView!;
  let tooltip: HTMLElement | undefined, active: HTMLAnchorElement | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(hideTimer);
    active?.removeAttribute("aria-describedby");
    tooltip?.remove();
    tooltip = undefined;
    active = undefined;
  };
  const show = (link: HTMLAnchorElement) => {
    clearTimeout(hideTimer);
    if (active === link) return;
    hide();
    const href = link.getAttribute("href") || "";
    let fragment = href.slice(1);
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      /* A literal percent is a valid ID. */
    }
    const note = href.startsWith("#")
      ? doc.getElementById(fragment)
      : undefined;
    if (!note || !container.contains(note)) return;
    active = link;
    tooltip = doc.createElement("div");
    tooltip.id = `zn-footnote-${sequence++}`;
    tooltip.className = "znote-footnote-tooltip";
    tooltip.setAttribute("role", "tooltip");
    const copy = note.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".footnote-backref").forEach((el) => el.remove());
    copy.removeAttribute("id");
    copy.querySelectorAll("[id], [name]").forEach((el) => {
      el.removeAttribute("id");
      el.removeAttribute("name");
    });
    // Textual previews avoid duplicating interactive controls and runtime IDs.
    tooltip.textContent = copy.textContent?.trim() || "";
    doc.body.append(tooltip);
    link.setAttribute("aria-describedby", tooltip.id);
    const rect = link.getBoundingClientRect(),
      box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(12, Math.min(rect.left, view.innerWidth - box.width - 12))}px`;
    tooltip.style.top = `${Math.max(8, rect.bottom + box.height + 12 < view.innerHeight ? rect.bottom + 8 : rect.top - box.height - 8)}px`;
    tooltip.onmouseenter = () => clearTimeout(hideTimer);
    tooltip.onmouseleave = () => {
      hideTimer = setTimeout(hide, 150);
    };
  };
  const reference = (event: Event) =>
    (event.target as Element)?.closest?.<HTMLAnchorElement>("a.footnote-ref");
  container.addEventListener(
    "mouseover",
    (event) => {
      const link = reference(event);
      if (link) show(link);
    },
    { signal },
  );
  container.addEventListener(
    "focusin",
    (event) => {
      const link = reference(event);
      if (link) show(link);
    },
    { signal },
  );
  container.addEventListener(
    "mouseout",
    (event) => {
      if (reference(event)) hideTimer = setTimeout(hide, 150);
    },
    { signal },
  );
  container.addEventListener("focusout", hide, { signal });
  container.addEventListener(
    "click",
    (event) => {
      if (reference(event)) hide();
    },
    { signal, capture: true },
  );
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") hide();
    },
    { signal },
  );
  if (doc !== document)
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") hide();
      },
      { signal },
    );
  view.addEventListener("scroll", hide, { signal, passive: true });
  signal.addEventListener("abort", hide, { once: true });
}
