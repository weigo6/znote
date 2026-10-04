import { invoke, isTauri } from "@tauri-apps/api/core";
import { tr } from "./i18n";
import { escapeHtml } from "./preview";
import { version } from "../package.json";

export const releasesUrl = "https://github.com/weigo6/znote/releases";
export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string | null;
  available: boolean;
  published: boolean;
  title: string;
  notes: string;
  url: string;
}
export function updateSettingsMarkup(automatic: boolean) {
  return `<div class="settings-section"><h3>ZNote v${escapeHtml(version)}</h3><p class="muted">${tr("检查 GitHub 上的正式版本。更新由你下载并安装，笔记文件保留在本地。")}</p><label class="setting-row"><span>${tr("启动时检查更新")}<small>${tr("仅连接 GitHub 获取版本信息，不上传笔记。")}</small></span><input id="auto-check-updates" type="checkbox" ${automatic ? "checked" : ""}></label><div class="modal-actions"><button id="check-updates" ${isTauri() ? "" : "disabled"}>${tr("检查更新")}</button><button id="open-releases">${tr("GitHub 下载页")}</button></div><p id="update-status" role="status" aria-live="polite"></p><div id="update-details" hidden><h4 id="update-title"></h4><pre id="update-notes" class="update-notes"></pre><button id="download-update" class="primary">${tr("前往下载新版本")}</button></div></div>`;
}
let inFlight: Promise<UpdateCheck> | undefined;
export function checkUpdates() {
  if (!inFlight) inFlight = invoke<UpdateCheck>("check_for_updates").finally(() => { inFlight = undefined; });
  return inFlight;
}
export function mountUpdateSettings(root: HTMLElement, saveAutomatic: (value: boolean) => void) {
  const session = new AbortController();
  const status = root.querySelector<HTMLElement>("#update-status")!;
  const check = root.querySelector<HTMLButtonElement>("#check-updates")!;
  const details = root.querySelector<HTMLElement>("#update-details")!;
  let url = releasesUrl;
  const open = (target: string) => {
    if (isTauri()) void invoke("open_url", { url: target }).catch(() => { status.textContent = tr("无法打开下载页，请稍后重试。"); });
    else window.open(target, "_blank", "noopener,noreferrer");
  };
  root.querySelector("#auto-check-updates")!.addEventListener("change", event => saveAutomatic((event.target as HTMLInputElement).checked), { signal: session.signal });
  root.querySelector("#open-releases")!.addEventListener("click", () => open(releasesUrl), { signal: session.signal });
  root.querySelector("#download-update")!.addEventListener("click", () => open(url), { signal: session.signal });
  check.addEventListener("click", async () => {
    check.disabled = true; details.hidden = true; status.textContent = tr("正在检查更新…");
    try {
      const result = await checkUpdates();
      if (session.signal.aborted) return;
      status.textContent = result.available ? tr("发现新版本 {0}（当前 {1}）", [`v${result.latestVersion}`, `v${result.currentVersion}`])
        : result.published ? tr("当前已是最新正式版本。") : tr("尚无可用的公开正式版本，请前往 GitHub 下载页查看。");
      if (result.available) {
        url = result.url;
        root.querySelector("#update-title")!.textContent = result.title;
        // Release notes are untrusted Markdown; render as text without HTML or scripts.
        root.querySelector("#update-notes")!.textContent = result.notes || tr("此版本未提供更新说明。");
        details.hidden = false;
      }
    } catch {
      if (!session.signal.aborted) status.textContent = tr("检查失败，请确认网络后重试，或直接访问 GitHub 下载页。");
    } finally { if (!session.signal.aborted) check.disabled = false; }
  }, { signal: session.signal });
  return () => session.abort();
}
