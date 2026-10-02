import { setRendered, applyRenderedTheme } from "./preview";
import { previewAnchors, previewTarget, sourceLineAtPreview, type PreviewAnchor } from "./preview-sync";
import type { RenderResult } from "./types";
import documentCss from "./markdown-theme.css?inline";
import scrollbarCss from "./scrollbar.css?inline";
import mathCss from "katex/dist/katex.min.css?inline";
import { readerThemeCss } from "./reader-theme";
import { mountInteractions } from "./render-plugins";

/** The child has no script execution or Tauri bridge; trusted host code mounts plugins. */
export class PreviewSurface {
  private session?: AbortController;
  private observer?: MutationObserver;
  private frame?: HTMLIFrameElement;
  private ready?: Promise<void>;
  private resolveReady?: () => void;
  private highlightStyle?: HTMLStyleElement;
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
  private lastScrollInput = 0;
  private suppressedScrollTop: number | null = null;
  private scrollFrame = 0;
  onFindShortcut?: () => void;

  setScrollSync(source: string, listener?: (line: number) => void) {
    const article = this.frame?.contentDocument?.querySelector<HTMLElement>("article");
    if (article) this.ensureScrollIndex(source, article);
    this.scrollListener = listener;
    this.lastScrollInput = 0;
  }

  private ensureScrollIndex(source: string, article: HTMLElement) {
    if (this.indexedArticle === article && this.indexedSource === source) return;
    this.scrollAnchors = previewAnchors(source, article);
    this.indexedSource = source;
    this.indexedArticle = article;
  }

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
      const rect = range.getBoundingClientRect();
      const viewport = doc.documentElement.clientHeight;
      if (rect.top < 0 || rect.bottom > viewport)
        scroller.scrollTop += rect.top - viewport * 0.3;
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
  }

  scrollToSource(source: string, line: number) {
    const doc = this.frame?.contentDocument;
    const article = doc?.querySelector<HTMLElement>("article");
    if (!doc || !article) return;
    this.ensureScrollIndex(source, article);
    const target = previewTarget(this.scrollAnchors, line);
    if (!target) return;
    const scroller = doc.scrollingElement || doc.documentElement;
    const rect = target.getBoundingClientRect();
    const viewport = doc.documentElement.clientHeight;
    if (rect.top >= 0 && rect.bottom <= viewport) return;
    scroller.scrollTop += rect.top - viewport * 0.28;
    this.suppressedScrollTop = scroller.scrollTop;
  }

  dispose() {
    this.clearFind();
    this.cancel();
    this.observer?.disconnect();
    this.scrollAnchors = [];
    this.indexedSource = undefined;
    this.indexedArticle = undefined;
    this.scrollListener = undefined;
    this.suppressedScrollTop = null;
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    this.resolveReady?.();
    this.frame?.remove();
    this.session = undefined;
    this.observer = undefined;
    this.frame = undefined;
    this.ready = undefined;
    this.resolveReady = undefined;
    this.highlightStyle = undefined;
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
    frame.setAttribute("sandbox", "allow-same-origin");
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
      style("@layer znote-highlight, znote-theme, znote-runtime;");
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
      this.highlightStyle = style("");
      this.customStyle = style("");
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
      doc.addEventListener(
        "keydown",
        (event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "f" &&
            !event.shiftKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            this.onFindShortcut?.();
          }
        },
        true,
      );
      const markScrollInput = () => { this.lastScrollInput = performance.now(); };
      doc.addEventListener("wheel", markScrollInput, { passive: true });
      doc.addEventListener("touchmove", markScrollInput, { passive: true });
      doc.addEventListener("pointerdown", markScrollInput, { passive: true });
      doc.addEventListener("keydown", (event) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
          markScrollInput();
      });
      doc.defaultView?.addEventListener("scroll", () => {
        const scrollTop = (doc.scrollingElement || doc.documentElement).scrollTop;
        if (this.suppressedScrollTop === scrollTop) {
          this.suppressedScrollTop = null;
          return;
        }
        this.suppressedScrollTop = null;
        if (!this.scrollListener || performance.now() - this.lastScrollInput > 500) return;
        if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = 0;
          const line = sourceLineAtPreview(this.scrollAnchors, doc.documentElement.clientHeight * 0.28);
          if (line !== null) this.scrollListener?.(line);
        });
      }, { passive: true });
    });
    await this.ready;
    return frame;
  }

  async render(
    host: HTMLElement,
    result: RenderResult,
    path?: string,
    diagnostic: (value: string) => void = () => {},
  ) {
    if (this.frame && this.frame.parentElement !== host) this.dispose();
    this.cancel();
    this.scrollAnchors = [];
    this.indexedSource = undefined;
    this.indexedArticle = undefined;
    const session = (this.session = new AbortController());
    const frame = await this.ensureFrame(host);
    if (session.signal.aborted) return;
    const doc = frame.contentDocument!;
    const article = doc.querySelector<HTMLElement>("article")!;
    const commitStyles = () => {
      this.currentResult = result;
      this.currentPath = path;
      this.renderedScheme = document.documentElement.dataset.theme;
      this.highlightStyle!.textContent = result.highlightCss
        ? `@layer znote-highlight {${result.highlightCss}}`
        : "";
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
      commitStyles();
      mountInteractions({
        container: article,
        plan: result.plan,
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
      scroller.scrollTop = scrollTop;
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
        beforeCommit: () => {
          // Theme, styles and body commit together; a cancelled render cannot leak them.
          commitStyles();
          const scroller = doc.scrollingElement || doc.documentElement;
          scrollTop = scroller.scrollTop;
          scrollLeft = scroller.scrollLeft;
        },
        afterCommit: () => {
          restoreScroll();
        },
      },
    );
    if (!session.signal.aborted && this.findQuery)
      this.find(this.findQuery, this.findIndex);
  }
}
