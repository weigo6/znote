import DOMPurify from "dompurify";
import { mountRuntimes, mountInteractions } from "./render-plugins";
import { invoke } from "@tauri-apps/api/core";
import type { RenderResult } from "./types";
import { bindLocations, refreshLocations } from "./preview-source-map";

let sequence = 0;
const namespaces = new WeakMap<HTMLElement, string>();
const blockSignatures = new WeakMap<Node, string>();
const mathDefinitions = new WeakMap<HTMLElement, boolean>();
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function hydrate(
  container: HTMLElement,
  path?: string,
  signal = new AbortController().signal,
  target = container,
) {
  container.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
    link.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const href = link.getAttribute("href") || "";
      if (href.startsWith("#")) {
        let codeHash = href;
        try { codeHash = decodeURIComponent(href); } catch { /* Preserve literal percent. */ }
        if (/^#__codelineno-[^:#]+-\d+(?::\d+)?$/.test(codeHash)) {
          window.history.replaceState(null, "", codeHash);
          window.dispatchEvent(new HashChangeEvent("hashchange"));
          return;
        }
        let fragment = href.slice(1);
        try {
          fragment = decodeURIComponent(fragment);
        } catch {
          /* Preserve literal-percent IDs. */
        }
        const anchor = target.querySelector(`[id="${CSS.escape(fragment)}"]`);
        anchor?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (/^https?:\/\//.test(href))
        await invoke("open_url", { url: href }).catch(() => {});
      else
        target.dispatchEvent(
          new CustomEvent("note-link", { bubbles: true, detail: href }),
        );
    };
  });
  if (path) await hydrateImages(container, path, signal);
}

async function hydrateImages(container: HTMLElement, path: string, signal: AbortSignal) {
  const images = [
    ...(container.matches("img") ? [container as HTMLImageElement] : []),
    ...container.querySelectorAll<HTMLImageElement>("img"),
  ];
  for (const img of images) {
    if (signal.aborted) return;
    const src = img.dataset.znSrc || img.getAttribute("src") || "";
    if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
    try {
      const data = await invoke<string>("read_asset", {
        document: path,
        relative: decodeURIComponent(src),
      });
      if (!signal.aborted) {
        img.src = data;
        delete img.dataset.znSrc;
      }
    } catch {
      img.alt = img.alt || `找不到图片：${src}`;
      img.title = src;
    }
  }
}
export function applyRenderedTheme(
  container: HTMLElement,
  result: RenderResult,
) {
  const scope = container.closest<HTMLElement>(".znote-render-scope");
  if (scope && result.theme) {
    scope.dataset.znVariant = result.theme.variant;
    scope.dataset.mdColorPrimary = result.theme.primary;
    scope.dataset.mdColorAccent = result.theme.accent;
  }
}
const sessions = new WeakMap<HTMLElement, AbortController>();
export interface RenderCommitHooks {
  beforeCommit?: () => void;
  afterCommit?: () => void;
  renderAll?: boolean;
}
export async function setRendered(
  container: HTMLElement,
  result: RenderResult,
  path?: string,
  diagnostic: (message: string) => void = () => {},
  outerSignal?: AbortSignal,
  hooks: RenderCommitHooks = {},
) {
  if (
    typeof result.html !== "string" ||
    (result.plan && ![1, 2, 3].includes(result.plan.schemaVersion))
  )
    throw new Error("渲染协议版本不兼容，请更新内置渲染器。");
  sessions.get(container)?.abort();
  const session = new AbortController();
  sessions.set(container, session);
  outerSignal?.addEventListener("abort", () => session.abort(), { once: true });
  container.classList.add("md-typeset");
  const staged = container.ownerDocument.createElement(container.tagName);
  staged.className = container.className;
  staged.innerHTML = DOMPurify.sanitize(result.html, {
    ADD_ATTR: ["class", "id", "open"],
    ADD_TAGS: result.plan?.features?.inlineStyles ? ["style"] : [],
    FORCE_BODY: true,
    FORBID_TAGS: [
      ...(result.plan?.features?.inlineStyles ? [] : ["style"]),
      "iframe",
      "form",
      "script",
      "object",
      "embed",
      "base",
      "link",
      "meta",
    ],
    FORBID_ATTR: result.plan?.features?.inlineStyles ? [] : ["style"],
  });
  // Keep generated input IDs local to this preview document.
  let prefix = namespaces.get(container);
  if (!prefix) {
    prefix = "zn-render-" + sequence++ + "-";
    namespaces.set(container, prefix);
  }
  const ids = new Set(
    Array.from(staged.querySelectorAll("[id]")).map((el) => el.id),
  );
  staged
    .querySelectorAll<HTMLElement>("[id]")
    .forEach((el) => (el.id = el.id + "-" + prefix));
  staged
    .querySelectorAll<HTMLElement>("[for]")
    .forEach((el) =>
      el.setAttribute("for", el.getAttribute("for") + "-" + prefix),
    );
  staged
    .querySelectorAll<HTMLInputElement>("input[name]")
    .forEach((el) => (el.name = prefix + el.name));
  staged.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((el) => {
    const id = el.getAttribute("href")!.slice(1);
    if (ids.has(id)) el.setAttribute("href", "#" + id + "-" + prefix);
  });
  staged.querySelectorAll("table:not(.highlighttable)").forEach((table) => {
    const scroll = document.createElement("div"),
      inner = document.createElement("div");
    scroll.className = "md-typeset__scrollwrap";
    inner.className = "md-typeset__table";
    table.replaceWith(scroll);
    scroll.append(inner);
    inner.append(table);
  });
  // Positions are side-table data, excluded from content signatures. This also
  // removes user-supplied reserved attributes when no renderer map is present.
  bindLocations(staged, result);
  const mathCount = staged.querySelectorAll(".arithmatex").length;
  const diagramCount = staged.querySelectorAll(".mermaid").length;
  const imageCount = staged.querySelectorAll("img").length;
  const deferHeavy = !hooks.renderAll && (mathCount > 80 || diagramCount > 8 || imageCount > 20);
  const hasMathDefinitions = /\\(?:gdef|def|let|newcommand|renewcommand|providecommand|global)\b/.test(result.html);
  const reuseMath = !hasMathDefinitions && !mathDefinitions.get(container);
  const mathMarkup = new WeakMap<HTMLElement, string>();
  if (deferHeavy)
    staged.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      img.loading = "lazy";
      if (!path || !src || /^(https?:|data:|blob:)/i.test(src)) return;
      img.dataset.znSrc = src;
      img.removeAttribute("src");
    });
  const reusable = new Map<string, Node[]>();
  const reusedLocations: [Node, Node][] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 1 && (node as HTMLElement).dataset.znPending) continue;
    // Annotation badges and their hidden source lists are rebuilt together
    // when either side changes, including blocks inside tabs or admonitions.
    if (node.nodeType === 1 && (
      (node as Element).matches("[data-zn-code-annotations], .znote-code-annotation-list") ||
      (node as Element).querySelector("[data-zn-code-annotations], .znote-code-annotation-list")
    )) continue;
    const signature = blockSignatures.get(node);
    if (!signature) continue;
    const matches = reusable.get(signature) || [];
    matches.push(node);
    reusable.set(signature, matches);
  }
  const desired = Array.from(staged.childNodes).map((node) => {
    const source =
      node.nodeType === 1
        ? (node as Element).outerHTML
        : node.textContent || "";
    const element = node.nodeType === 1 ? (node as Element) : undefined;
    const contains = (selector: string) =>
      !!element &&
      (element.matches(selector) || !!element.querySelector(selector));
    const hasMath = contains(".arithmatex");
    const hasMermaid = contains(".mermaid");
    const context = JSON.stringify([
      path,
      hasMath ? result.plan?.math : null,
      hasMermaid
        ? [
            result.plan?.mermaid,
            result.plan?.runtimes.includes("mermaid"),
            document.documentElement.dataset.theme,
          ]
        : null,
      contains(".tabbed-set") ? result.plan?.runtimes.includes("tabs") : null,
    ]);
    const signature = `${context}\0${node.nodeType}\0${source}`;
    // Reuse math when the document has no definitions that can affect later formulas.
    const match = hasMath && !reuseMath
      ? undefined
      : reusable.get(signature)?.shift();
    if (match) {
      reusedLocations.push([match, node]);
      return match;
    }
    blockSignatures.set(node, signature);
    return node;
  });
  staged.replaceChildren(
    ...desired.filter((node) => node.parentNode === staged),
  );
  const fresh = new Set<Node>(staged.childNodes);
  await Promise.all([
    hydrate(staged, deferHeavy ? undefined : path, session.signal, container),
    mountRuntimes({
      container: staged,
      plan: result.plan,
      signal: session.signal,
      diagnostic,
      onMathMarkup: deferHeavy
        ? (element, markup) => mathMarkup.set(element, markup)
        : undefined,
    }, deferHeavy ? new Set(["math", "tabs"]) : undefined),
  ]);
  if (session.signal.aborted) return false;
  hooks.beforeCommit?.();
  reusedLocations.forEach(([previous, freshNode]) => refreshLocations(previous, freshNode));
  applyRenderedTheme(container, result);
  desired.forEach((node, index) => {
    const current = container.childNodes[index];
    if (current !== node) container.insertBefore(node, current || null);
  });
  while (container.childNodes.length > desired.length)
    container.lastChild!.remove();
  mathDefinitions.set(container, hasMathDefinitions);
  hooks.afterCommit?.();
  if (deferHeavy) {
    const pending = desired.filter((node): node is HTMLElement =>
      fresh.has(node) && node.nodeType === 1 && (
        !!(node as HTMLElement).querySelector(".arithmatex, .mermaid, img[data-zn-src]") ||
        (node as HTMLElement).matches(".arithmatex, .mermaid, img[data-zn-src]")
      ),
    );
    const view = container.ownerDocument.defaultView!;
    const runBlock = async (block: HTMLElement) => {
      if (session.signal.aborted) return;
      const view = container.ownerDocument.defaultView!;
      const formulas = [
        ...(block.matches(".arithmatex") ? [block] : []),
        ...block.querySelectorAll<HTMLElement>(".arithmatex"),
      ];
      let sliceStarted = view.performance.now();
      for (const element of formulas) {
        if (session.signal.aborted) return;
        const markup = mathMarkup.get(element);
        if (markup !== undefined) element.innerHTML = markup;
        if (view.performance.now() - sliceStarted > 8) {
          await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
          sliceStarted = view.performance.now();
        }
      }
      await Promise.all([
        path ? hydrateImages(block, path, session.signal) : Promise.resolve(),
        mountRuntimes({
          container: block,
          plan: result.plan,
          signal: session.signal,
          diagnostic,
        }, new Set(["mermaid"])),
      ]);
      if (!session.signal.aborted) delete block.dataset.znPending;
    };
    if (pending.length && "IntersectionObserver" in view) {
      let resolveInitial: () => void = () => {};
      const initial = new Promise<void>((resolve) => { resolveInitial = resolve; });
      let first = true;
      const observer = new view.IntersectionObserver((entries) => {
        const tasks = entries.filter((entry) => entry.isIntersecting).map((entry) => {
          observer.unobserve(entry.target);
          return runBlock(entry.target as HTMLElement);
        });
        if (first) {
          first = false;
          void Promise.all(tasks).then(resolveInitial);
        }
      }, { rootMargin: "100% 0px" });
      session.signal.addEventListener("abort", () => {
        observer.disconnect();
        resolveInitial();
      }, { once: true });
      for (const block of pending) {
        block.dataset.znPending = "true";
        observer.observe(block);
      }
      await Promise.race([
        initial,
        new Promise<void>((resolve) => setTimeout(resolve, 150)),
      ]);
    } else {
      for (const block of pending) await runBlock(block);
    }
  }
  mountInteractions({
    container,
    plan: result.plan,
    signal: session.signal,
    diagnostic,
  });
  return true;
}
