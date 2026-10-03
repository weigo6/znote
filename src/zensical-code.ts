import { tr } from "./i18n";
const sourceText = new WeakMap<HTMLElement, string>();
const restoredHash = new WeakMap<HTMLElement, string>();
const originalId = (id: string) => id.replace(/-zn-render-\d+-$/, "");
const spanParts = (span: HTMLElement) => /^__span-(.+)-(\d+)$/.exec(originalId(span.id));
const codeLine = (span: HTMLElement) => Number(spanParts(span)?.[2]);

function cleanCode(code: HTMLElement) {
  const override = code.closest<HTMLElement>("[data-copy]")?.getAttribute("data-copy");
  return (override ?? code.textContent ?? "").trimEnd();
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Clipboard API can be unavailable in a desktop WebView without a secure context.
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.left = "-10000px";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

function control(doc: Document, type: "copy" | "select", label: string) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "md-code__button";
  button.dataset.mdType = type;
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

function unwrap(marker: HTMLElement) {
  marker.replaceWith(...Array.from(marker.childNodes));
}

function wrapLine(span: HTMLElement, className: string) {
  const marker = span.ownerDocument.createElement("span");
  marker.className = className;
  marker.append(...Array.from(span.childNodes).filter((node) =>
    !(node.nodeType === 1 && (node as Element).matches("a[id^='__codelineno-']"))));
  span.append(marker);
}

function highlightLines(spans: HTMLElement[], range: readonly [number, number] | undefined) {
  for (const span of spans) {
    const hover = span.querySelector<HTMLElement>(":scope > .hll.select");
    if (hover) unwrap(hover);
    const prior = span.querySelector<HTMLElement>(":scope > .hll.znote-code-selection");
    if (prior) unwrap(prior);
    const line = codeLine(span);
    if (!range || !Number.isFinite(line) || line < range[0] || line > range[1]) continue;
    wrapLine(span, "hll znote-code-selection");
  }
}

/** Mount upstream code controls in the trusted host, over sanitized preview HTML. */
export function mountZensicalCodeBlocks(
  container: HTMLElement,
  options: { copy: boolean; select: boolean },
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  const doc = container.ownerDocument;
  for (const block of container.querySelectorAll<HTMLElement>(".highlight")) {
    const code = block.querySelector<HTMLElement>("pre > code");
    const pre = code?.parentElement;
    if (!code || !pre || pre.tagName !== "PRE") continue;
    if (!sourceText.has(code)) sourceText.set(code, cleanCode(code));

    const copy = !!block.closest(".copy") || (options.copy && !block.closest(".no-copy"));
    const spans = Array.from(code.querySelectorAll<HTMLElement>(":scope > span[id^='__span-']"));
    const select = spans.length > 0 &&
      (!!block.closest(".select") || (options.select && !block.closest(".no-select")));
    pre.querySelector(":scope > .md-code__nav")?.remove();
    if (!copy && !select) {
      code.classList.remove("md-code__content");
      highlightLines(spans, undefined);
      continue;
    }

    const nav = doc.createElement("nav");
    nav.className = "md-code__nav";
    nav.setAttribute("aria-label", tr("代码块操作"));
    pre.insertBefore(nav, code);
    if (spans.length) code.classList.add("md-code__content");

    if (select) {
      const button = control(doc, "select", tr("选择代码行"));
      button.setAttribute("aria-pressed", "false");
      nav.append(button);
      let active = false;
      let range: [number, number] | undefined;
      const blockIndex = spanParts(spans[0])?.[1];
      const restore = () => {
        const hash = window.location.hash;
        let decoded = hash;
        try { decoded = decodeURIComponent(hash); } catch { /* Preserve literal percent. */ }
        const match = /^#__codelineno-([^:#]+)-(\d+)(?::(\d+))?$/.exec(decoded);
        if (!match || match[1] !== blockIndex) return;
        range = [Number(match[2]), Number(match[3] ?? match[2])];
        highlightLines(spans, range);
        if (restoredHash.get(code) !== decoded) {
          spans.find((span) => codeLine(span) === range![0])?.scrollIntoView({ block: "center" });
          restoredHash.set(code, decoded);
        }
      };
      restore();
      window.addEventListener("hashchange", restore, { signal });
      button.addEventListener("click", () => {
        active = !active;
        if (!active) for (const marker of code.querySelectorAll<HTMLElement>(".hll.select")) unwrap(marker);
        button.classList.toggle("md-code__button--active", active);
        button.setAttribute("aria-pressed", String(active));
        button.blur();
      }, { signal });
      code.addEventListener("pointerover", (event) => {
        if (!active || !(event.target as Node).nodeType) return;
        const span = (event.target as Element).closest<HTMLElement>("code > span[id^='__span-']");
        if (span && !span.querySelector(":scope > .hll.select, :scope > .hll.znote-code-selection"))
          wrapLine(span, "hll select");
      }, { signal });
      code.addEventListener("pointerout", (event) => {
        if (!(event.target as Node).nodeType) return;
        const span = (event.target as Element).closest<HTMLElement>("code > span[id^='__span-']");
        if (span && (!event.relatedTarget || !span.contains(event.relatedTarget as Node))) {
          const marker = span.querySelector<HTMLElement>(":scope > .hll.select");
          if (marker) unwrap(marker);
        }
      }, { signal });
      block.addEventListener("click", (event) => {
        if (!active || !(event.target as Node).nodeType) return;
        const target = event.target as Element;
        const span = target.closest<HTMLElement>("code > span[id^='__span-']");
        const gutter = target.closest<HTMLAnchorElement>(".linenos a[href^='#__codelineno-']");
        const line = span ? codeLine(span) : gutter
          ? Number(/^__codelineno-(.+)-(\d+)$/.exec(originalId((gutter.getAttribute("href") || "").slice(1)))?.[2]) : NaN;
        if (!Number.isFinite(line)) return;
        event.preventDefault();
        event.stopPropagation();
        range = event.shiftKey && range
          ? [Math.min(line, range[0]), Math.max(line, range[1])]
          : [line, line];
        highlightLines(spans, range);
        if (blockIndex) {
          const hash = `#__codelineno-${blockIndex}-${range[0]}${range[0] === range[1] ? "" : `:${range[1]}`}`;
          window.history.replaceState(null, "", hash);
          restoredHash.set(code, hash);
        }
        doc.defaultView?.getSelection()?.removeAllRanges();
      }, { capture: true, signal });
    } else {
      code.classList.remove("md-code__content");
      highlightLines(spans, undefined);
    }

    if (copy) {
      const button = control(doc, "copy", tr("复制代码"));
      nav.append(button);
      let resetTimer: ReturnType<typeof setTimeout> | undefined;
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        let success = false;
        try {
          await copyText(sourceText.get(code) ?? cleanCode(code));
          success = true;
          button.title = tr("已复制");
          button.setAttribute("aria-label", tr("已复制"));
        } catch {
          button.title = tr("复制失败");
          button.setAttribute("aria-label", tr("复制失败"));
        } finally {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
        container.dispatchEvent(new CustomEvent("code-copy-feedback", {
          bubbles: true,
          detail: { success },
        }));
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          if (!button.isConnected) return;
          button.title = tr("复制代码");
          button.setAttribute("aria-label", tr("复制代码"));
        }, 1600);
      }, { signal });
    }
  }
}
