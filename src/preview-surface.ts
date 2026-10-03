import { setRendered, applyRenderedTheme } from "./preview";
import { updateSourceLocations } from "./preview-source-map";
import { previewAnchors, previewAnchorAt, readingAnchors, readingAnchorAt, lineWithin, isPreviewVisible, type PreviewAnchor, type ReadingAnchor } from "./preview-sync";
import type { RenderResult } from "./types";
import type { RenderSettings } from "./render-config";
import { applyAppearanceToResult } from "./render-appearance";
import documentCss from "./markdown-theme.css?inline";
import scrollbarCss from "./scrollbar.css?inline";
import mathCss from "katex/dist/katex.min.css?inline";
import { readerThemeCss } from "./reader-theme";
import { mountInteractions, mountRuntimes } from "./render-plugins";

/** The child has no script execution or Tauri bridge; trusted host code mounts plugins. */
export class PreviewSurface {
  private session?: AbortController;
  private themeRuntime?: AbortController;
  private observer?: MutationObserver;
  private frame?: HTMLIFrameElement;
  private ready?: Promise<void>;
  private resolveReady?: () => void;
  private customStyle?: HTMLStyleElement;
  private readerStyle?: HTMLStyleElement;
  private currentResult?: RenderResult;
  private currentPath?: string;
  private renderedScheme?: string;
  private syncTheme?: () => void;
  private findQuery = "";
  private findMatches: Range[] = [];
  private findIndex = 0;
  private findLimited = false;
  private scrollAnchors: PreviewAnchor[] = [];
  private indexedSource?: string;
  private indexedArticle?: HTMLElement;
  private scrollListener?: (line: number) => void;
  private suppressedScrollTop: number | null = null;
  private scrollFrame = 0;
  private layoutFrame = 0;
  private layoutObserver?: ResizeObserver;
  private contentObserver?: MutationObserver;
  private frameEvents?: AbortController;
  private geometry: ReadingAnchor[] = [];
  private geometryDirty = true;
  private pointerScrolling = false;
  private userScrolling = false;
  private scrollIdleTimer = 0;
  private intent: "editor" | "preview" = "editor";
  private lastReportedLine?: number;
  private readingPosition?: { element: HTMLElement; fraction: number; gap: number; viewportY: number; line: number };
  private documentId?: string;
  private cursorFrame = 0;
  private cursorTarget?: { source: string; line: number; cause: "editor" | "navigation" };
  onFindShortcut?: () => void;
  onPrintShortcut?: () => void;

  get followsEditor() { return this.intent === "editor"; }

  editorIntent() {
    this.intent = "editor";
    this.readingPosition = undefined;
    this.userScrolling = false;
    this.pointerScrolling = false;
    clearTimeout(this.scrollIdleTimer);
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    this.lastReportedLine = undefined;
  }

  private navigationIntent() {
    this.editorIntent();
    this.intent = "preview";
  }

  setScrollSync(source: string, listener?: (line: number) => void) {
    const article = this.frame?.contentDocument?.querySelector<HTMLElement>("article");
    if (article) this.ensureScrollIndex(source, article);
    this.scrollListener = listener;
  }

  private ensureScrollIndex(source: string, article: HTMLElement) {
    if (this.indexedArticle === article && this.indexedSource === source) return;
    this.scrollAnchors = previewAnchors(source, article);
    this.indexedSource = source;
    this.indexedArticle = article;
    this.geometryDirty = true;
    this.lastReportedLine = undefined;
  }

  private getGeometry() {
    const doc = this.frame?.contentDocument;
    if (doc && this.geometryDirty) {
      this.geometry = readingAnchors(this.scrollAnchors, (doc.scrollingElement || doc.documentElement).scrollTop, this.indexedArticle);
      this.geometryDirty = false;
    }
    return this.geometry;
  }

  private rememberReadingPosition() {
    const doc = this.frame?.contentDocument;
    if (!doc) return;
    const scrollTop = (doc.scrollingElement || doc.documentElement).scrollTop;
    const viewportY = doc.documentElement.clientHeight * 0.28;
    const reading = readingAnchorAt(this.getGeometry(), scrollTop + viewportY);
    if (!reading) return;
    const fraction = Math.max(0, Math.min(1, (scrollTop + viewportY - reading.top) / Math.max(1, reading.bottom - reading.top)));
    const gap = scrollTop + viewportY - reading.top - (reading.bottom - reading.top) * fraction;
    this.readingPosition = { element: reading.anchor.element, fraction, gap, viewportY, line: lineWithin(reading.anchor, fraction) };
  }

  private writeScroll(top: number) {
    const doc = this.frame?.contentDocument;
    if (!doc) return;
    const scroller = doc.scrollingElement || doc.documentElement;
    scroller.scrollTop = top;
    this.suppressedScrollTop = scroller.scrollTop;
  }

  private restoreReadingPosition() {
    const doc = this.frame?.contentDocument;
    const position = this.readingPosition;
    if (!doc || !position || this.intent !== "preview") return;
    let element = position.element;
    if (!isPreviewVisible(element))
      element = previewAnchorAt(this.scrollAnchors, position.line)?.element || element;
    while (!isPreviewVisible(element) && element.parentElement) element = element.parentElement;
    if (!isPreviewVisible(element)) return;
    const rect = element.getBoundingClientRect();
    const top = (doc.scrollingElement || doc.documentElement).scrollTop;
    this.writeScroll(top + rect.top + rect.height * position.fraction + position.gap - position.viewportY);
    this.geometryDirty = true;
    this.rememberReadingPosition();
  }

  private invalidateGeometry = () => {
    this.geometryDirty = true;
    if (this.layoutFrame) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0;
      if (this.intent === "preview") this.restoreReadingPosition();
      else if (this.cursorTarget?.cause === "editor")
        this.applySourceScroll(this.cursorTarget.source, this.cursorTarget.line);
    });
  };

  private findRegistry() {
    const doc = this.frame?.contentDocument;
    return (
      doc?.defaultView as unknown as
        | {
            CSS?: {
              highlights?: {
                set(name: string, value: unknown): void;
                delete(name: string): void;
              };
            };
          }
        | undefined
    )?.CSS?.highlights;
  }

  clearFind() {
    this.findQuery = "";
    this.findMatches = [];
    this.findIndex = 0;
    this.findLimited = false;
    this.findRegistry()?.delete("znote-find-matches");
    this.findRegistry()?.delete("znote-find-current");
  }

  find(query: string, index = 0) {
    this.clearFind();
    this.findQuery = query;
    const doc = this.frame?.contentDocument;
    const article = doc?.querySelector<HTMLElement>("article");
    if (!doc || !article || !query.trim()) return this.getFindState();
    const term = query.trim();
    const expression = new RegExp(
      term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "giu",
    );
    type Piece = { node: Text; start: number; end: number };
    const groups: { element: HTMLElement; text: string; pieces: Piece[] }[] =
      [];
    const walker = doc.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      const parent = textNode.parentElement;
      if (
        !parent ||
        !textNode.data ||
        parent.closest(
          "script, style, textarea, noscript, [hidden], [aria-hidden='true'], .katex-mathml, mjx-assistive-mml",
        )
      )
        continue;
      const element =
        parent.closest<HTMLElement>(
          "p, h1, h2, h3, h4, h5, h6, li, pre, td, th, dt, dd, caption, summary, blockquote",
        ) || article;
      let group = groups[groups.length - 1];
      if (!group || group.element !== element) {
        group = { element, text: "", pieces: [] };
        groups.push(group);
      }
      const start = group.text.length;
      group.text += textNode.data;
      group.pieces.push({ node: textNode, start, end: group.text.length });
    }
    const locate = (pieces: Piece[], position: number, end: boolean) => {
      const piece =
        pieces.find((item) =>
          end ? position <= item.end : position < item.end,
        ) || pieces[pieces.length - 1];
      return { node: piece.node, offset: position - piece.start };
    };
    for (const group of groups) {
      for (const match of group.text.matchAll(expression)) {
        if (this.findMatches.length >= 500) {
          this.findLimited = true;
          break;
        }
        const start = locate(group.pieces, match.index, false);
        const end = locate(group.pieces, match.index + match[0].length, true);
        const range = doc.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        this.findMatches.push(range);
      }
      if (this.findLimited) break;
    }
    const view = doc.defaultView as unknown as {
      Highlight?: new (...ranges: Range[]) => { priority?: number };
    };
    const registry = this.findRegistry();
    if (view?.Highlight && registry && this.findMatches.length)
      registry.set(
        "znote-find-matches",
        new view.Highlight(...this.findMatches),
      );
    return this.selectFind(index);
  }

  selectFind(index: number) {
    if (!this.findMatches.length) return this.getFindState();
    this.findIndex =
      (index + this.findMatches.length) % this.findMatches.length;
    const range = this.findMatches[this.findIndex];
    const doc = this.frame?.contentDocument;
    const view = doc?.defaultView as unknown as
      | { Highlight?: new (...ranges: Range[]) => { priority?: number } }
      | undefined;
    const registry = this.findRegistry();
    if (view?.Highlight && registry) {
      const current = new view.Highlight(range);
      current.priority = 1;
      registry.set("znote-find-current", current);
    }
    const scroller = doc?.scrollingElement;
    if (scroller && doc) {
      this.navigationIntent();
      const rect = range.getBoundingClientRect();
      const viewport = doc.documentElement.clientHeight;
      if (rect.top < 0 || rect.bottom > viewport)
        this.writeScroll(scroller.scrollTop + rect.top - viewport * 0.3);
      this.rememberReadingPosition();
    }
    return this.getFindState();
  }

  nextFind(direction: number) {
    return this.selectFind(this.findIndex + direction);
  }

  getFindState() {
    return {
      count: this.findMatches.length,
      index: this.findIndex,
      limited: this.findLimited,
    };
  }

  cancel() {
    this.session?.abort();
    this.themeRuntime?.abort();
    if (this.cursorFrame) cancelAnimationFrame(this.cursorFrame);
    this.cursorFrame = 0;
    this.cursorTarget = undefined;
  }

  updateAppearance(settings: RenderSettings) {
    const article = this.frame?.contentDocument?.querySelector<HTMLElement>("article");
    if (!article || !this.currentResult || !this.customStyle) return false;
    if (this.intent === "preview") this.rememberReadingPosition();
    applyAppearanceToResult(this.currentResult, settings);
    this.customStyle.textContent = this.currentResult.plan?.styles.map(item => item.css).join("\n") || "";
    applyRenderedTheme(article, this.currentResult);
    this.syncTheme?.();
    this.invalidateGeometry();
    return true;
  }

  refreshHostAppearance() {
    this.syncTheme?.();
    const scheme = document.documentElement.dataset.theme;
    const changed = this.renderedScheme !== undefined && this.renderedScheme !== scheme;
    this.renderedScheme = scheme;
    this.invalidateGeometry();
    const result = this.currentResult;
    const article = this.frame?.contentDocument?.querySelector<HTMLElement>("article");
    if (!changed || !article || !result?.plan?.mermaid?.enabled ||
        result.plan.mermaid.theme !== "auto" || !article.querySelector(".mermaid")) return;
    this.themeRuntime?.abort();
    const controller = (this.themeRuntime = new AbortController());
    this.session?.signal.addEventListener("abort", () => controller.abort(), { once: true });
    void mountRuntimes({
      container: article, plan: result.plan, signal: controller.signal,
      diagnostic: () => {},
    }, new Set(["mermaid"])).then(() => {
      if (!controller.signal.aborted) this.invalidateGeometry();
    });
  }

  scrollToSource(source: string, line: number, cause: "editor" | "navigation" = "navigation") {
    if (cause === "navigation") {
      this.navigationIntent();
    }
    this.cursorTarget = { source, line, cause };
    if (this.cursorFrame) return;
    this.cursorFrame = requestAnimationFrame(() => {
      this.cursorFrame = 0;
      const target = this.cursorTarget;
      if (target) {
        this.applySourceScroll(target.source, target.line);
        if (target.cause === "navigation") this.rememberReadingPosition();
      }
    });
  }

  private applySourceScroll(source: string, line: number) {
    const doc = this.frame?.contentDocument;
    const article = doc?.querySelector<HTMLElement>("article");
    if (!doc || !article) return;
    this.ensureScrollIndex(source, article);
    const anchor = previewAnchorAt(this.scrollAnchors, line);
    if (!anchor) return;
    let target = anchor.element;
    // A source block inside a closed details/hidden tab has no visible rect.
    // Reveal its visible containing block without opening user controls.
    while (!isPreviewVisible(target) && target.parentElement && target !== article)
      target = target.parentElement;
    const scroller = doc.scrollingElement || doc.documentElement;
    const rect = target.getBoundingClientRect();
    const viewport = doc.documentElement.clientHeight;
    const fraction = Math.max(0, Math.min(1, (line - anchor.line) / Math.max(1, (anchor.endLine ?? anchor.line) - anchor.line)));
    const y = rect.top + Math.max(0, rect.height - 1) * fraction;
    if (y >= 0 && y <= viewport) return;
    this.writeScroll(scroller.scrollTop + y - viewport * 0.28);
  }

  dispose() {
    this.clearFind();
    this.cancel();
    this.observer?.disconnect();
    this.layoutObserver?.disconnect();
    this.contentObserver?.disconnect();
    this.frameEvents?.abort();
    this.scrollAnchors = [];
    this.indexedSource = undefined;
    this.indexedArticle = undefined;
    this.scrollListener = undefined;
    this.suppressedScrollTop = null;
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    if (this.layoutFrame) cancelAnimationFrame(this.layoutFrame);
    if (this.cursorFrame) cancelAnimationFrame(this.cursorFrame);
    clearTimeout(this.scrollIdleTimer);
    this.scrollFrame = 0;
    this.layoutFrame = 0;
    this.cursorFrame = 0;
    this.cursorTarget = undefined;
    this.geometry = [];
    this.geometryDirty = true;
    this.readingPosition = undefined;
    this.documentId = undefined;
    this.intent = "editor";
    this.userScrolling = false;
    this.pointerScrolling = false;
    this.resolveReady?.();
    this.frame?.remove();
    this.session = undefined;
    this.observer = undefined;
    this.frame = undefined;
    this.ready = undefined;
    this.resolveReady = undefined;
    this.customStyle = undefined;
    this.readerStyle = undefined;
    this.currentResult = undefined;
    this.currentPath = undefined;
    this.renderedScheme = undefined;
    this.syncTheme = undefined;
  }

  private async ensureFrame(host: HTMLElement) {
    if (this.frame?.parentElement === host && this.ready) {
      await this.ready;
      return this.frame;
    }
    this.observer?.disconnect();
    const frame = (this.frame = document.createElement("iframe"));
    frame.title = "Markdown 正文预览";
    frame.className = "document-preview-frame";
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    const loaded = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
      frame.onload = () => resolve();
      frame.onerror = () => resolve();
    });
    frame.srcdoc =
      "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline' data:; font-src 'self' data:; img-src 'self' data: blob: https:; connect-src 'none'; object-src 'none'; base-uri 'none'\"></head><body class=\"znote-render-scope no-js\" dir=\"ltr\"><article class=\"md-typeset\"></article></body></html>";
    host.replaceChildren(frame);
    this.ready = loaded.then(() => {
      if (this.frame !== frame) return;
      this.resolveReady = undefined;
      const doc = frame.contentDocument;
      if (!doc) throw new Error("预览文档未能载入");
      const style = (css: string) => {
        const element = doc.createElement("style");
        element.textContent = css;
        doc.head.append(element);
        return element;
      };
      style("@layer znote-theme, znote-runtime;");
      style(`@layer znote-theme {${documentCss}}`);
      style(scrollbarCss);
      style(
        "html,body{margin:0;min-height:100%;overflow-anchor:none;}body{box-sizing:border-box;padding:24px 32px;overflow-wrap:anywhere;}article{max-width:var(--reader-width,820px);margin:auto;}img{max-width:100%;}mjx-container{overflow:auto;}",
      );
      style(`@layer znote-runtime {${mathCss}}`);
      this.readerStyle = style("");
      style(
        `::highlight(znote-find-matches){background:#f5d75399;color:inherit;}::highlight(znote-find-current){background:#f5a623;color:#241b0b;}body[data-md-color-scheme="slate"] ::highlight(znote-find-matches){background:#b9943299;}body[data-md-color-scheme="slate"] ::highlight(znote-find-current){background:#e3a840;color:#1b201b;}`,
      );
      this.customStyle = style("");
      style("@page{margin:16mm;}@media print{html,body{min-height:0!important;overflow:visible!important;}body{padding:0!important;background:#fff!important;}article{max-width:none!important;}.md-typeset__scrollwrap,.md-typeset__table,pre{max-height:none!important;overflow:visible!important;}img,svg{max-width:100%;}pre,blockquote,img,svg{break-inside:avoid;}}");
      this.syncTheme = () => {
        const appStyle = getComputedStyle(document.documentElement);
        const font = appStyle.getPropertyValue("--editor-font") || "17px";
        doc.documentElement.style.setProperty("--editor-font", font);
        for (const token of ["paper", "scrollbar", "scrollbar-hover"])
          doc.documentElement.style.setProperty(`--${token}`, appStyle.getPropertyValue(`--${token}`));
        doc.documentElement.style.colorScheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        doc.documentElement.style.fontSize = `${parseFloat(font) / (this.currentResult?.theme?.variant === "classic" ? 0.8 : 0.75)}px`;
        doc.body.dataset.mdColorScheme =
          document.documentElement.dataset.theme === "dark"
            ? "slate"
            : "default";
        doc.body.dataset.znReader =
          this.currentResult?.theme?.reader?.preset ?? "integrated";
        this.readerStyle!.textContent = readerThemeCss(
          this.currentResult ?? {},
          appStyle,
        );
      };
      this.syncTheme();
      this.observer = new MutationObserver(this.syncTheme);
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["style", "data-theme"],
      });
      doc.querySelector("article")!.addEventListener("note-link", (event) =>
        host.dispatchEvent(
          new CustomEvent("note-link", {
            bubbles: true,
            detail: (event as CustomEvent).detail,
          }),
        ),
      );
      doc.querySelector("article")!.addEventListener("code-copy-feedback", (event) =>
        host.dispatchEvent(
          new CustomEvent("code-copy-feedback", {
            bubbles: true,
            detail: (event as CustomEvent<{ success: boolean }>).detail,
          }),
        ),
      );
      doc.addEventListener(
        "keydown",
        (event) => {
          if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return;
          const key = event.key.toLowerCase();
          if (key === "f" || key === "p") {
            event.preventDefault();
            event.stopPropagation();
            if (key === "f") this.onFindShortcut?.();
            else this.onPrintShortcut?.();
          }
        },
        true,
      );
      const markScrollInput = () => {
        this.intent = "preview";
        this.userScrolling = true;
        this.suppressedScrollTop = null;
        if (this.cursorFrame) cancelAnimationFrame(this.cursorFrame);
        this.cursorFrame = 0;
        this.cursorTarget = undefined;
        this.rememberReadingPosition();
        clearTimeout(this.scrollIdleTimer);
        this.scrollIdleTimer = window.setTimeout(() => { if (!this.pointerScrolling) this.userScrolling = false; }, 240);
      };
      doc.addEventListener("wheel", markScrollInput, { passive: true });
      doc.addEventListener("touchmove", markScrollInput, { passive: true });
      doc.addEventListener("pointerdown", () => { this.pointerScrolling = true; markScrollInput(); }, { passive: true });
      const releasePointer = () => {
        this.pointerScrolling = false;
        clearTimeout(this.scrollIdleTimer);
        this.scrollIdleTimer = window.setTimeout(() => { this.userScrolling = false; }, 240);
      };
      doc.addEventListener("pointerup", releasePointer, { passive: true });
      doc.addEventListener("pointercancel", releasePointer, { passive: true });
      doc.defaultView?.addEventListener("blur", releasePointer);
      this.frameEvents?.abort();
      this.frameEvents = new AbortController();
      window.addEventListener("pointerup", releasePointer, { passive: true, signal: this.frameEvents.signal });
      window.addEventListener("pointercancel", releasePointer, { passive: true, signal: this.frameEvents.signal });
      doc.addEventListener("keydown", (event) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
          markScrollInput();
      });
      doc.defaultView?.addEventListener("scroll", () => {
        const scrollTop = (doc.scrollingElement || doc.documentElement).scrollTop;
        if (this.suppressedScrollTop !== null && Math.abs(this.suppressedScrollTop - scrollTop) < 1) {
          return;
        }
        this.suppressedScrollTop = null;
        if (!this.userScrolling && !this.pointerScrolling) return;
        clearTimeout(this.scrollIdleTimer);
        this.scrollIdleTimer = window.setTimeout(() => { if (!this.pointerScrolling) this.userScrolling = false; }, 240);
        if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = 0;
          this.rememberReadingPosition();
          const line = this.readingPosition?.line;
          if (line !== undefined && line > 0 && line !== this.lastReportedLine) {
            this.lastReportedLine = line;
            this.scrollListener?.(line);
          }
        });
      }, { passive: true });
      const article = doc.querySelector<HTMLElement>("article")!;
      this.layoutObserver = new ResizeObserver(this.invalidateGeometry);
      this.layoutObserver.observe(article);
      this.contentObserver = new MutationObserver(this.invalidateGeometry);
      this.contentObserver.observe(article, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "style", "hidden", "open", "checked", "src"] });
      article.addEventListener("load", this.invalidateGeometry, true);
      article.addEventListener("toggle", this.invalidateGeometry, true);
      article.addEventListener("change", this.invalidateGeometry, true);
      doc.defaultView?.addEventListener("resize", this.invalidateGeometry);
    });
    await this.ready;
    return frame;
  }

  async render(
    host: HTMLElement,
    result: RenderResult,
    path?: string,
    diagnostic: (value: string) => void = () => {},
    context?: { source: string; documentId: string; onCommit?: () => void; renderAll?: boolean },
  ) {
    if (this.frame && this.frame.parentElement !== host) this.dispose();
    this.cancel();
    if (context && context.documentId !== this.documentId) {
      this.documentId = context.documentId;
      this.editorIntent();
      if (this.cursorFrame) cancelAnimationFrame(this.cursorFrame);
      this.cursorFrame = 0;
      this.cursorTarget = undefined;
      this.scrollAnchors = [];
      this.indexedSource = undefined;
      this.indexedArticle = undefined;
      this.geometry = [];
      this.geometryDirty = true;
    }
    const session = (this.session = new AbortController());
    const frame = await this.ensureFrame(host);
    if (session.signal.aborted) return;
    const doc = frame.contentDocument!;
    const article = doc.querySelector<HTMLElement>("article")!;
    const commitStyles = () => {
      this.currentResult = result;
      this.currentPath = path;
      this.renderedScheme = document.documentElement.dataset.theme;
      this.customStyle!.textContent =
        result.plan?.styles.map((resource) => resource.css).join("\n") || "";
      applyRenderedTheme(article, result);
      this.syncTheme?.();
    };
    const runtimeConfig = (value: RenderResult) =>
      JSON.stringify([
        value.plan?.math,
        value.plan?.mermaid,
        value.plan?.features,
        value.plan?.runtimes,
      ]);
    if (
      result.plan?.revisions &&
      this.currentResult?.plan?.revisions &&
      result.html === this.currentResult.html &&
      path === this.currentPath &&
      result.plan.revisions.parse === this.currentResult.plan.revisions.parse &&
      result.plan.revisions.runtime ===
        this.currentResult.plan.revisions.runtime &&
      runtimeConfig(result) === runtimeConfig(this.currentResult) &&
      this.renderedScheme === document.documentElement.dataset.theme &&
      !article.querySelector("[data-zn-pending]")
    ) {
      // Preserve formula DOM and selection for style-only edits.
      if (this.intent === "preview") this.rememberReadingPosition();
      commitStyles();
      updateSourceLocations(article, result);
      if (context) {
        this.indexedSource = undefined;
        this.ensureScrollIndex(context.source, article);
      }
      this.restoreReadingPosition();
      this.invalidateGeometry();
      context?.onCommit?.();
      mountInteractions({
        container: article,
        plan: result.plan,
        path,
        signal: session.signal,
        diagnostic,
      });
      if (this.findQuery) this.find(this.findQuery, this.findIndex);
      return;
    }
    let scrollTop = 0;
    let scrollLeft = 0;
    const restoreScroll = () => {
      const scroller = doc.scrollingElement || doc.documentElement;
      this.writeScroll(scrollTop);
      scroller.scrollLeft = scrollLeft;
    };
    await setRendered(
      article,
      result,
      path,
      (value) => {
        if (!session.signal.aborted) diagnostic(value);
      },
      session.signal,
      {
        renderAll: context?.renderAll,
        beforeCommit: () => {
          // Theme, styles and body commit together; a cancelled render cannot leak them.
          if (this.intent === "preview") this.rememberReadingPosition();
          commitStyles();
          const scroller = doc.scrollingElement || doc.documentElement;
          scrollTop = scroller.scrollTop;
          scrollLeft = scroller.scrollLeft;
        },
        afterCommit: () => {
          this.indexedSource = undefined;
          this.indexedArticle = undefined;
          if (context) this.ensureScrollIndex(context.source, article);
          restoreScroll();
          this.restoreReadingPosition();
          context?.onCommit?.();
        },
      },
    );
    if (!session.signal.aborted && this.findQuery)
      this.find(this.findQuery, this.findIndex);
  }
}
