import { describe, expect, it, vi } from "vitest";
import { IconPreviewLoader } from "./icon-preview-loader";

describe("IconPreviewLoader", () => {
  it("limits simultaneous preview requests", async () => {
    let active = 0;
    let peak = 0;
    const finishers: Array<() => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          finishers.push(() => {
            active -= 1;
            resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" />'));
          });
        }),
    ) as unknown as typeof fetch;
    const loader = new IconPreviewLoader(fetcher, 2, 0);

    const previews = [
      loader.load("https://api.iconify.design/test/one.svg"),
      loader.load("https://api.iconify.design/test/two.svg"),
      loader.load("https://api.iconify.design/test/three.svg"),
    ];

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);

    finishers.shift()?.();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    finishers.splice(0).forEach((finish) => finish());

    const sources = await Promise.all(previews);
    expect(sources).toHaveLength(3);
    expect(sources.every((source) => source.startsWith("data:image/svg+xml"))).toBe(true);
    expect(peak).toBe(2);
    loader.dispose();
  });
});
