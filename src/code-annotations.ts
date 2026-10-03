import { tr } from "./i18n";
import { invoke } from "@tauri-apps/api/core";

let annotationSequence = 0;

interface AnnotationEntry {
  button: HTMLButtonElement;
  item: HTMLLIElement;
}

function annotationList(block: HTMLElement): HTMLOListElement | undefined {
  let sibling = block.nextElementSibling;
  while (
    sibling?.tagName === "P" &&
    !sibling.children.length &&
    !sibling.textContent?.trim()
  ) sibling = sibling.nextElementSibling;
  return sibling?.tagName === "OL" ? sibling as HTMLOListElement : undefined;
}

function listItem(list: HTMLOListElement, index: number): HTMLLIElement | undefined {
  const item = list.children[index - 1];
  return index > 0 && item?.tagName === "LI" ? item as HTMLLIElement : undefined;
}

function badge(doc: Document, index: number): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "znote-code-annotation";
  button.dataset.annotationIndex = String(index);
  button.setAttribute("aria-label", tr("代码注释 {0}", [index]));
  button.setAttribute("aria-expanded", "false");
  return button;
}

// Zensical scans comment tokens and splits ordinary markers in place. A !
// marker replaces its whole token, matching the upstream annotation syntax.
function findMarkers(code: HTMLElement): Text[] {
  const markers: Text[] = [];
  for (const host of code.querySelectorAll<HTMLElement>("span.c, span.c1, span.cm")) {
    const nodes: Text[] = [];
    const iterator = code.ownerDocument.createNodeIterator(host, NodeFilter.SHOW_TEXT);
    for (let node = iterator.nextNode(); node; node = iterator.nextNode())
      nodes.push(node as Text);
    for (let text of nodes) {
      let match: RegExpExecArray | null;
      while ((match = /(\(\d+\))(!)?/.exec(text.textContent || ""))) {
        const [, marker, force] = match;
        if (force === undefined) {
          const found = text.splitText(match.index);
          text = found.splitText(marker.length);
          markers.push(found);
        } else {
          text.textContent = marker;
          markers.push(text);
          break;
        }
      }
    }
  }
  return markers;
}

/** Enhance the sanitized Pygments HTML, leaving the Markdown source untouched. */
export function mountCodeAnnotations(
  container: HTMLElement,
  enabled: boolean,
  signal: AbortSignal,
  path?: string,
) {
  if (signal.aborted) return;
  const doc = container.ownerDocument;
  const entries: AnnotationEntry[] = [];
  const blocks = container.querySelectorAll<HTMLElement>(".highlighttable, .highlight");
  for (const block of blocks) {
    if (!block.classList.contains("highlighttable") && block.closest(".highlighttable"))
      continue;
    if (!enabled && !block.classList.contains("annotate") && !block.querySelector(".annotate"))
      continue;
    const list = annotationList(block);
    const code = block.querySelector<HTMLElement>("pre > code");
    if (!list || !code) continue;
    const buttons: HTMLButtonElement[] = Array.from(code.querySelectorAll(".znote-code-annotation"));
    for (const marker of findMarkers(code)) {
      const index = Number(/^\((\d+)\)$/.exec(marker.textContent || "")?.[1]);
      if (!listItem(list, index)) continue;
      const button = badge(doc, index);
      marker.replaceWith(button);
      buttons.push(button);
    }
    for (const button of buttons) {
      const item = listItem(list, Number(button.dataset.annotationIndex));
      if (item) entries.push({ button, item });
    }
    if (buttons.length) {
      list.classList.add("znote-code-annotation-list");
      list.hidden = true;
      block.dataset.znCodeAnnotations = "true";
    }
  }
  if (!entries.length) return;

  let active: HTMLButtonElement | undefined;
  let tooltip: HTMLElement | undefined;
  let pinned = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const clearHide = () => { if (hideTimer) clearTimeout(hideTimer); hideTimer = undefined; };
  const close = () => {
    clearHide();
    active?.setAttribute("aria-expanded", "false");
    active?.removeAttribute("aria-controls");
    tooltip?.remove();
    active = undefined;
    tooltip = undefined;
    pinned = false;
  };
  const scheduleClose = () => {
    clearHide();
    if (!pinned) hideTimer = setTimeout(close, 150);
  };
  const place = (button: HTMLButtonElement, panel: HTMLElement) => {
    const view = doc.defaultView!;
    const anchor = button.getBoundingClientRect();
    const width = Math.min(panel.offsetWidth, view.innerWidth - 24);
    panel.style.left = `${Math.max(12, Math.min(anchor.left, view.innerWidth - width - 12))}px`;
    const below = view.innerHeight - anchor.bottom;
    panel.style.top = below >= panel.offsetHeight + 12 || below >= anchor.top
      ? `${Math.min(view.innerHeight - panel.offsetHeight - 12, anchor.bottom + 8)}px`
      : `${Math.max(12, anchor.top - panel.offsetHeight - 8)}px`;
  };
  const show = ({ button, item }: AnnotationEntry, pin = false) => {
    clearHide();
    if (active === button && tooltip) { if (pin) pinned = true; return; }
    close();
    const panel = doc.createElement("aside");
    panel.className = "md-typeset znote-code-annotation-tooltip";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", tr("代码注释 {0}", [button.dataset.annotationIndex]));
    panel.id = `znote-code-annotation-${annotationSequence++}`;
    for (const child of Array.from(item.childNodes)) panel.append(child.cloneNode(true));
    panel.querySelectorAll<HTMLElement>("[id], [name], [for], [data-zn-node]").forEach((node) => {
      node.removeAttribute("id");
      node.removeAttribute("name");
      node.removeAttribute("for");
      node.removeAttribute("data-zn-node");
    });
    doc.body.append(panel);
    place(button, panel);
    if (path) for (const image of panel.querySelectorAll<HTMLImageElement>("img[data-zn-src]")) {
      const source = image.dataset.znSrc;
      if (!source) continue;
      let relative = source;
      try { relative = decodeURIComponent(source); } catch { /* Preserve literal percent. */ }
      void invoke<string>("read_asset", {
        document: path,
        relative,
      }).then((data) => {
        if (signal.aborted || !panel.isConnected) return;
        image.addEventListener("load", () => place(button, panel), { once: true });
        image.src = data;
        delete image.dataset.znSrc;
      }).catch(() => {
        image.alt = image.alt || tr("找不到图片：{0}", [source]);
      });
    }
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", panel.id);
    active = button;
    tooltip = panel;
    pinned = pin;
    panel.addEventListener("mouseenter", clearHide, { signal });
    panel.addEventListener("mouseleave", scheduleClose, { signal });
    panel.addEventListener("focusin", clearHide, { signal });
    panel.addEventListener("focusout", scheduleClose, { signal });
    panel.addEventListener("click", async (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      const href = link.getAttribute("href") || "";
      if (href.startsWith("#")) {
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch { /* Literal percent. */ }
        container.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (/^https?:\/\//.test(href)) {
        await invoke("open_url", { url: href }).catch(() => {});
      } else {
        container.dispatchEvent(new CustomEvent("note-link", { bubbles: true, detail: href }));
      }
    }, { signal });
  };
  for (const entry of entries) {
    entry.button.addEventListener("mouseenter", () => show(entry), { signal });
    entry.button.addEventListener("mouseleave", scheduleClose, { signal });
    entry.button.addEventListener("focus", () => show(entry), { signal });
    entry.button.addEventListener("blur", scheduleClose, { signal });
    entry.button.addEventListener("click", (event) => {
      event.stopPropagation();
      show(entry, true);
    }, { signal });
  }
  doc.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (tooltip?.contains(target) || active?.contains(target)) return;
    close();
  }, { signal });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  }, { signal });
  doc.defaultView?.addEventListener("scroll", close, { signal, passive: true });
  signal.addEventListener("abort", close, { once: true });
}
