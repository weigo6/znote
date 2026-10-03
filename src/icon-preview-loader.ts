import { tr } from "./i18n";
const cache = new Map<string, string>();
const CACHE_LIMIT = 128;

interface PreviewTask {
  url: string;
  resolve: (src: string) => void;
  reject: (error: unknown) => void;
}

function abortError() {
  return new DOMException(tr("图标预览已取消"), "AbortError");
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/** Fetch remote previews only when requested, with a cap on active requests. */
export class IconPreviewLoader {
  private readonly controller = new AbortController();
  private readonly pending: PreviewTask[] = [];
  private active = 0;
  private nextStartAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly maxConcurrent = 3,
    private readonly startIntervalMs = 140,
  ) {}

  load(url: string): Promise<string> {
    const cached = cache.get(url);
    if (cached) return Promise.resolve(cached);
    if (this.controller.signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      this.pending.push({ url, resolve, reject });
      this.pump();
    });
  }

  dispose() {
    this.controller.abort();
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const task of this.pending.splice(0)) task.reject(abortError());
  }

  private pump() {
    if (this.controller.signal.aborted || this.active >= this.maxConcurrent || !this.pending.length || this.timer)
      return;
    const delay = Math.max(0, this.nextStartAt - Date.now());
    if (delay) {
      this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, delay);
      return;
    }
    const task = this.pending.shift()!;
    this.active++;
    this.nextStartAt = Date.now() + this.startIntervalMs;
    void this.fetchPreview(task.url).then(task.resolve, task.reject).finally(() => {
      this.active--;
      this.pump();
    });
    this.pump();
  }

  private async fetchPreview(url: string): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.fetcher(url, { signal: this.controller.signal });
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 5000)
          : 750 * 2 ** attempt;
        this.nextStartAt = Math.max(this.nextStartAt, Date.now() + delay);
        await wait(delay, this.controller.signal);
        continue;
      }
      if (!response.ok) throw new Error(tr("图标预览请求失败：{0}", [response.status]));
      const svg = await response.text();
      if (this.controller.signal.aborted) throw abortError();
      if (!/<svg(?:\s|>)/i.test(svg)) throw new Error(tr("图标预览不是 SVG"));
      const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      cache.delete(url);
      cache.set(url, src);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      return src;
    }
    throw new Error(tr("图标预览暂时不可用"));
  }
}
