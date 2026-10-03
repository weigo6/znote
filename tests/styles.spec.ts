import { test, expect } from "@playwright/test";
import fs from "node:fs";
const fixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/rendered.json", "utf8"),
);
const manifest = JSON.parse(
  fs.readFileSync("public/vendor/zensical/manifest.json", "utf8"),
) as { files: { variant: string; file: string }[] };

for (const variant of ["modern", "classic"])
  for (const scheme of ["default", "slate"]) {
    test(`${variant} ${scheme}: document styles match upstream Zensical CSS`, async ({
      page,
    }) => {
      await page.goto("/tests/editor.html");
      await page.waitForFunction(() => !!window.renderSample);
      await page.evaluate(
        async ({ variant, scheme }) => {
          await window.renderSample("rich");
          const el = document.querySelector<HTMLElement>(
            ".znote-render-scope",
          )!;
          el.dataset.znVariant = variant;
          el.dataset.mdColorScheme = scheme;
        },
        { variant, scheme },
      );
      const raw = manifest.files
        .filter((f) => f.variant === variant)
        .map((f) =>
          fs.readFileSync(
            `public/vendor/zensical/${variant}/${f.file}`,
            "utf8",
          ),
        )
        .join("\n");
      const rendered = fixtures.results.rich.html;
      const source = `<!doctype html><html class="no-js" style="font-size:${17 / (variant === "modern" ? 0.75 : 0.8)}px"><head><style>${raw}</style></head><body dir="ltr" data-md-color-scheme="${scheme}" data-md-color-primary="indigo" data-md-color-accent="indigo"><article class="md-typeset">${rendered}</article></body></html>`;
      await page.evaluate((srcdoc) => {
        const iframe = document.createElement("iframe");
        iframe.id = "upstream-reference";
        iframe.srcdoc = srcdoc;
        document.body.append(iframe);
      }, source);
      const frame = page.frameLocator("#upstream-reference");
      await expect(frame.locator(".md-typeset h1")).toHaveCount(1);
      const properties = [
        "color",
        "backgroundColor",
        "fontSize",
        "fontWeight",
        "lineHeight",
        "letterSpacing",
        "borderTopColor",
        "borderTopWidth",
        "borderLeftColor",
        "borderLeftWidth",
        "borderRadius",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "marginTop",
        "marginBottom",
        "display",
        "position",
        "textAlign",
        "textDecorationLine",
      ];
      for (const selector of [
        "h1",
        "h2",
        "h3",
        "p",
        "strong",
        "em",
        "p code",
        "a:not(.headerlink)",
        "blockquote",
        "ul",
        "ol",
        "hr",
        "mark",
        ".admonition",
        ".admonition-title",
        "details",
        "summary",
        ".tabbed-labels>label",
        "pre",
        "pre code",
        "th",
        "td",
        ".highlighttable",
        ".highlighttable th.filename",
        ".highlighttable span.filename",
        ".highlighttable .linenos",
        ".linenodiv a",
        ".highlighttable .code",
        ".highlight .k",
        ".highlight .s2",
      ]) {
        const actual = await page
          .locator("#preview-content " + selector)
          .first()
          .evaluate((el, props) => {
            const css = getComputedStyle(el);
            return Object.fromEntries(
              props.map((p) => [p, css[p as keyof CSSStyleDeclaration]]),
            );
          }, properties);
        const expected = await frame
          .locator(".md-typeset " + selector)
          .first()
          .evaluate((el, props) => {
            const css = getComputedStyle(el);
            return Object.fromEntries(
              props.map((p) => [p, css[p as keyof CSSStyleDeclaration]]),
            );
          }, properties);
        expect(actual, `${variant}/${scheme} ${selector}`).toEqual(expected);
      }
      for (const selector of [
        ".admonition-title",
        "summary",
        ".task-list-indicator",
      ]) {
        const read = (el: Element) => {
          const c = getComputedStyle(el, "::before");
          return {
            left: c.left,
            right: c.right,
            width: c.width,
            height: c.height,
            position: c.position,
            maskImage: c.maskImage,
          };
        };
        const actual = await page
          .locator("#preview-content " + selector)
          .first()
          .evaluate(read);
        const expected = await frame
          .locator(".md-typeset " + selector)
          .first()
          .evaluate(read);
        // "right:auto" resolves to a width-dependent used length for absolute icons;
        // compare the explicit positioning edge and icon size instead.
        expect(
          {
            left: actual.left,
            width: actual.width,
            height: actual.height,
            position: actual.position,
            maskImage: actual.maskImage,
          },
          selector,
        ).toEqual({
          left: expected.left,
          width: expected.width,
          height: expected.height,
          position: expected.position,
          maskImage: expected.maskImage,
        });
      }
      await page.locator("#upstream-reference").evaluate((el) => el.remove());
      const geometry = await page
        .locator("#preview-content .admonition-title")
        .first()
        .evaluate((el) => {
          const css = getComputedStyle(el, "::before"),
            rect = el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          return {
            iconRight: rect.left + parseFloat(css.left) + parseFloat(css.width),
            textLeft: range.getBoundingClientRect().left,
          };
        });
      expect(geometry.iconRight).toBeLessThan(geometry.textLeft);
      const codeColumns = await page
        .locator("#preview-content .highlighttable")
        .evaluate((el) => ({
          lineRight: el.querySelector(".linenos")!.getBoundingClientRect()
            .right,
          codeLeft: el.querySelector(".code")!.getBoundingClientRect().left,
        }));
      expect(codeColumns.lineRight).toBeLessThanOrEqual(
        codeColumns.codeLeft + 1,
      );
      fs.mkdirSync("build/qa", { recursive: true });
      await page.screenshot({
        path: `build/qa/${variant}-${scheme}.png`,
        fullPage: true,
      });
    });
  }
