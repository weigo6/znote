import { tr } from "./i18n";
import { escapeHtml } from "./preview";

const icon = (name: string) => `<i data-lucide="${name}"></i>`;

/** Application UI, independent of note tabs and the Markdown renderer. */
export function startPageMarkup() {
  return `<div class="start-page-inner">
    <div class="start-hero">
      <div class="start-intro">
        <div class="start-brand">${icon("notebook-pen")}<span>ZNote</span></div>
        <h1>${tr("留一点空间，给你的想法。")}</h1>
        <p>${tr("记录灵感，整理知识，或写下今天的第一件事。从一篇笔记开始。")}</p>
        <span class="start-local">${icon("folder")} ${tr("你的笔记，保存在自己的文件夹里。")}</span>
      </div>
      <div class="start-actions" aria-label="${tr("开始使用")}">
        <button class="start-action start-action-primary" data-action="new">${icon("plus")}<span><strong>${tr("新建笔记")}</strong><small>${tr("从空白开始，写下一个想法")}</small></span><kbd>Ctrl + N</kbd></button>
        <button class="start-action" data-action="open">${icon("file-text")}<span><strong>${tr("打开笔记")}</strong><small>${tr("继续编辑一篇已有的笔记")}</small></span><kbd>Ctrl + O</kbd></button>
        <button class="start-action" data-action="folder">${icon("folder-open")}<span><strong>${tr("打开文件夹")}</strong><small>${tr("在左侧浏览和切换你的笔记")}</small></span><kbd>Ctrl + Shift + O</kbd></button>
      </div>
    </div>
    <section class="start-recent-section" aria-labelledby="start-recent-heading">
      <div class="start-section-heading"><h2 id="start-recent-heading">${tr("最近使用")}</h2><button data-action="recent-history">${tr("查看全部")}${icon("arrow-up-right")}</button></div>
      <div id="start-recent-list"></div>
    </section>
    <div class="start-tips">
      <div>${icon("columns-2")}<span><strong>${tr("写作与阅读")}</strong><small>${tr("打开笔记后，可切换编辑、对照和阅读视图。")}</small></span></div>
      <div>${icon("settings")}<span><strong>${tr("喜欢的样子")}</strong><small>${tr("在设置中选择语言、主题和阅读排版。")}</small></span></div>
      <div>${icon("command")}<span><strong>${tr("随手找到功能")}</strong><small>${tr("按 Ctrl + K 打开快速操作。")}</small></span></div>
    </div>
  </div>`;
}

export function startRecentMarkup(files: readonly string[], folders: readonly string[]) {
  const entries = [
    ...files.slice(0, 5).map(path => ({ path, kind: "file" })),
    ...folders.slice(0, 3).map(path => ({ path, kind: "folder" })),
  ];
  if (!entries.length) return `<div class="start-recent-empty">${icon("notebook-pen")}<p>${tr("还没有最近使用的笔记")}</p><span>${tr("新建或打开笔记后，你可以在这里快速找回它们。")}</span></div>`;
  return entries.map(({ path, kind }) => {
    const name = path.split(/[\\/]/).pop() || path;
    return `<button class="start-recent-item" data-recent-${kind}="${escapeHtml(path)}" title="${escapeHtml(path)}">${icon(kind === "file" ? "file-text" : "folder")}<span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(path)}</small></span>${icon("chevron-right")}</button>`;
  }).join("");
}
