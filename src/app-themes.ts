import { tr } from "./i18n";
export type ColorMode = "light" | "dark";
export type ThemeMode = ColorMode | "system";
export type ThemeStyle = "forest" | "graphite" | "ocean" | "lavender" | "sand" | "rose";
export type ThemeBindings = Record<ColorMode, ThemeStyle>;

const tokenNames = [
  "paper", "sidebar", "rail", "tab-bg", "text", "heading", "secondary", "muted",
  "accent", "accent-soft", "border", "border-strong", "hover", "selection",
  "inline-code", "code", "code-bg", "highlight", "warning", "warning-soft",
  "scrollbar", "scrollbar-hover",
] as const;
type ThemeTokens = Record<(typeof tokenNames)[number], string>;

function palette(colors: string): ThemeTokens {
  const values = colors.split(" ");
  if (values.length !== tokenNames.length) throw new Error("Incomplete theme palette");
  return Object.fromEntries(tokenNames.map((name, i) => [name, `#${values[i]}`])) as ThemeTokens;
}

interface AppTheme {
  id: ThemeStyle;
  description: string;
  light: { name: string; tokens: ThemeTokens };
  dark: { name: string; tokens: ThemeTokens };
}

/** Complete surface palettes shared by the application, editor and isolated reader. */
export const appThemes: readonly AppTheme[] = [
  {
    id: "forest", get description() { return tr("柔和自然 · 原有配色"); },
    light: { get name() { return tr("纸白"); }, tokens: palette("fffefa f6f6f2 efefea f7f7f3 3b433f 263e35 65716a 929991 376e5a e7eee7 e7e9e1 d5dcd1 f0f2eb a9d2b8 eef0e9 9c7952 f4f5ef f4e8b7 a27635 faf2df d6dbd3 aebbb1") },
    dark: { get name() { return tr("墨绿"); }, tokens: palette("202923 1c241f 18201b 1c251f d4dbd3 e1ebe1 a9b7aa 728578 9bbea2 2d4133 334236 425746 28352c 426e50 2d3a31 d5b780 1b231e 625a32 d2b27a 3c3427 3b4c40 667a69") },
  },
  {
    id: "graphite", get description() { return tr("中性灰阶 · 简洁沉静"); },
    light: { get name() { return tr("素白"); }, tokens: palette("ffffff f6f6f7 ececee f7f7f8 37383d 222328 666870 858791 505664 e9eaee e3e4e8 cfd1d8 eff0f3 c9cdd8 eff0f3 805c3b f6f6f8 f5e6ac 8b641f faf2df d3d5db a7abb5") },
    dark: { get name() { return tr("石墨"); }, tokens: palette("222326 1d1e21 18191c 1e1f22 dedee3 f1f1f4 aeb0ba 858894 bac1d0 343740 393b43 50535f 2d2f35 494f60 303239 e6bd8e 1c1d20 625532 e5be78 3c3427 454851 737887") },
  },
  {
    id: "ocean", get description() { return tr("清透海蓝 · 专注清晰"); },
    light: { get name() { return tr("晴海"); }, tokens: palette("fbfdff f1f6fc e7eef7 f3f7fc 344356 223c59 61758c 7d8ea3 2867a5 e4effb dce6f1 c5d5e7 ebf2fa b9d5f1 eaf1f9 916539 f1f5fa f5e7b5 946921 faf2df c9d8e8 98b2ce") },
    dark: { get name() { return tr("深海"); }, tokens: palette("1e2633 19212d 151c27 1b2330 d5dfed e5efff a4b7cf 7e93ae 8ebcf0 2c3d55 32445d 465f7e 283448 3c5d86 29394f e0bc89 19212e 605737 dfb87a 3b3329 3d516e 637fa3") },
  },
  {
    id: "lavender", get description() { return tr("淡雅紫调 · 柔和安静"); },
    light: { get name() { return tr("紫雾"); }, tokens: palette("fdfbff f6f2fa eee8f5 f8f4fc 463d55 3d2d54 77688a 9585a6 7852a1 eee5f8 e8dff0 d8cae5 f3edf9 d6bfe9 f1eaf7 926a45 f7f2fb f2e4b7 936928 faf1df ddcfe8 bba4d0") },
    dark: { get name() { return tr("暮紫"); }, tokens: palette("282330 221e29 1c1923 241f2c e1d9ec f0e7fc b9aacd 9684ae c4a4e8 40314f 44364f 5f4c70 342b40 61487b 382d45 dfb995 211c2a 62513b dbb578 3d322b 52415f 866d9b") },
  },
  {
    id: "sand", get description() { return tr("温暖纸感 · 舒缓阅读"); },
    light: { get name() { return tr("暖砂"); }, tokens: palette("fffaf1 f7f0e5 eee5d6 faf3e9 514438 423326 82705e 9b8875 986234 f4e6d4 eaddcb dac6ad f5ebdd e5c7a4 f2e7d7 8c6037 f8f0e4 f3df9f 91651e faf0d8 ddccb6 bda17e") },
    dark: { get name() { return tr("深棕"); }, tokens: palette("2c2621 251f1b 201b17 27211d e7dcd0 f4e9dc c3ae97 9e8872 d9ad78 493728 493a2e 64503e 392e25 715234 403226 e7bc83 241e19 655332 e2b773 403225 574535 8b7158") },
  },
  {
    id: "rose", get description() { return tr("低饱和玫瑰 · 温柔轻盈"); },
    light: { get name() { return tr("玫瑰"); }, tokens: palette("fffafb faf2f4 f2e7eb fcf4f6 533e47 4d2f3d 876b77 a08490 a34f72 f7e5ed eedee4 dfc7d2 f8ecf1 e8bfd1 f4e8ee 906540 faf1f4 f3e2b1 946624 faf1df e3ccd6 c59aae") },
    dark: { get name() { return tr("夜玫"); }, tokens: palette("2f232a 281e24 21191e 2b2027 ecdae3 fae6f0 c7a8b7 a38293 e2a1bd 503140 503441 6f4a5a 3d2b34 7b425c 442e3a e3b68b 271d23 635039 dfb477 403029 60404f 98677d") },
  },
];

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "dark" || value === "system" ? value : "light";
}

export function normalizeThemeBindings(value: unknown): ThemeBindings {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const style = (mode: ColorMode): ThemeStyle =>
    appThemes.find(theme => theme.id === stored[mode])?.id ?? "forest";
  return { light: style("light"), dark: style("dark") };
}

export function applyAppTheme(root: HTMLElement, mode: ThemeMode, bindings: ThemeBindings, systemDark: boolean) {
  const scheme = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  const theme = appThemes.find(theme => theme.id === bindings[scheme]) ?? appThemes[0];
  root.dataset.theme = scheme;
  root.dataset.themeStyle = theme.id;
  for (const name of tokenNames) root.style.setProperty(`--${name}`, theme[scheme].tokens[name]);
}

export function themeSettingsMarkup(bindings: ThemeBindings) {
  return `<p class="muted">${tr("分别绑定亮色与暗色主题。切换模式或跟随系统时，自动使用对应配色；选择后立即保存。")}</p>${(["light", "dark"] as const).map(mode => `
    <fieldset class="app-theme-group"><legend>${mode === "light" ? tr("亮色模式主题") : tr("暗色模式主题")}</legend>
      <div class="app-theme-grid">${appThemes.map(theme => {
        const variant = theme[mode], tokens = variant.tokens;
        return `<label class="app-theme-card">
          <input type="radio" name="${mode}-theme" value="${theme.id}" data-theme-binding="${mode}" aria-label="${variant.name}" ${bindings[mode] === theme.id ? "checked" : ""}>
          <span class="app-theme-swatch" aria-hidden="true" style="--swatch-paper:${tokens.paper};--swatch-sidebar:${tokens.sidebar};--swatch-text:${tokens.text};--swatch-accent:${tokens.accent};--swatch-border:${tokens.border}"><span></span><span><i></i><i></i><i></i></span></span>
          <span class="app-theme-name">${variant.name}</span><span class="app-theme-description">${theme.description}</span>
        </label>`;
      }).join("")}</div>
    </fieldset>`).join("")}`;
}
