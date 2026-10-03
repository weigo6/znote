import { tr } from "./i18n";
export const ICONIFY_API = "https://api.iconify.design";

export const iconCollections = [
  { prefix: "lucide", label: "Lucide", shortcode: "lucide" },
  { prefix: "mdi", label: "Material Design", shortcode: "material" },
  { prefix: "fa6-solid", get label() { return tr("Font Awesome · 实心"); }, shortcode: "fontawesome-solid" },
  { prefix: "fa6-regular", get label() { return tr("Font Awesome · 线框"); }, shortcode: "fontawesome-regular" },
  { prefix: "fa6-brands", get label() { return tr("Font Awesome · 品牌"); }, shortcode: "fontawesome-brands" },
  { prefix: "octicon", label: "Octicons", shortcode: "octicons" },
  { prefix: "simple-icons", label: "Simple Icons", shortcode: "simple" },
] as const;

export type IconCollection = (typeof iconCollections)[number]["prefix"];
export interface OnlineIcon {
  id: string;
  label: string;
  collection: string;
  shortcode: string;
  previewUrl: string;
}

export function parseOnlineIcon(id: string): OnlineIcon | null {
  const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id);
  if (!match) return null;
  const collection = iconCollections.find((entry) => entry.prefix === match[1]);
  if (!collection) return null;
  const name = match[2];
  return {
    id,
    label: name,
    collection: collection.label,
    shortcode: `:${collection.shortcode ? `${collection.shortcode}-` : ""}${name}:`,
    previewUrl: `${ICONIFY_API}/${collection.prefix}/${name}.svg`,
  };
}

export async function searchOnlineIcons(
  query: string,
  prefix: IconCollection | "all",
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<OnlineIcon[]> {
  const url = new URL(`${ICONIFY_API}/search`);
  url.searchParams.set("query", query.trim());
  url.searchParams.set("prefixes", prefix === "all"
    ? iconCollections.map((entry) => entry.prefix).join(",")
    : prefix);
  url.searchParams.set("limit", "64");
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(tr("图标服务返回 {0}", [response.status]));
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("icons" in data) || !Array.isArray(data.icons))
    throw new Error(tr("图标服务返回了无效数据"));
  return data.icons
    .filter((id): id is string => typeof id === "string")
    .map(parseOnlineIcon)
    .filter((icon): icon is OnlineIcon => icon !== null);
}
