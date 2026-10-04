import { createElement, type IconNode } from "lucide";

/** Convert only new placeholders. Existing SVGs retain their identity. */
export function initializeIcons(
  root: ParentNode,
  icons: Record<string, IconNode>,
) {
  for (const placeholder of root.querySelectorAll<HTMLElement>(
    "i[data-lucide]",
  )) {
    const name = placeholder.dataset.lucide!;
    const key = name.replace(/(^|-)(\w)/g, (_, _dash, letter: string) =>
      letter.toUpperCase(),
    );
    const node = icons[key];
    if (!node) continue;
    const attrs = Object.fromEntries(
      Array.from(placeholder.attributes, (attr) => [attr.name, attr.value]),
    );
    const svg = createElement([
      node[0],
      {
        ...node[1],
        "stroke-width": 1.7,
        ...attrs,
        class: ["lucide", `lucide-${name}`, attrs.class]
          .filter(Boolean)
          .join(" "),
      },
      node[2],
    ]);
    placeholder.replaceWith(svg);
  }
}
