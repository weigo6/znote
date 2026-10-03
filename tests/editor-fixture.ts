import { NoteEditor } from "../src/editor";
import "../src/style.css";
import "../src/markdown-theme.css";
import "katex/dist/katex.min.css";
import { mockIPC } from "@tauri-apps/api/mocks";
import { setRendered } from "../src/preview";
import fixtures from "./fixtures/rendered.json";
import type { RenderResult } from "../src/types";
const sampleByText = new Map(
  Object.entries(fixtures.samples).map(([name, source]) => [source.trim(), name]),
);
mockIPC((command, args) => {
  if (command === "render_markdown") {
    const key = String(args?.text).trim();
    const name = sampleByText.get(key);
    const result = name && (fixtures.results as Record<string, RenderResult>)[name];
    if (!result) throw new Error("Missing renderer fixture: " + key);
    return result;
  }
  return null;
});
declare global {
  interface Window {
    editor: NoteEditor;
    loadNote: (text: string) => void;
    renderSample: (name: string) => Promise<void>;
  }
}
window.renderSample = async (name) => {
  let article = document.querySelector<HTMLElement>("#preview-content");
  if (!article) {
    article = document.createElement("article");
    article.id = "preview-content";
    const panel = document.createElement("section");
    panel.id = "preview-panel";
    panel.append(article);
    document.querySelector(".writing-area")!.append(panel);
  }
  const text = (fixtures.samples as Record<string, string>)[name];
  await setRendered(
    article,
    (fixtures.results as Record<string, RenderResult>)[name],
  );
  document.querySelector<HTMLElement>("#editor-stage")!.hidden = true;
  document.querySelector<HTMLElement>(".writing-area")!.dataset.mode = "read";
};
window.loadNote = (text) => {
  window.editor?.destroy();
  window.editor = new NoteEditor(
    document.querySelector("#test-editor")!,
    text,
    { change: () => {}, cursor: () => {}, save: () => {}, image: () => {} },
  );
};
window.loadNote(
  "# Heading\n\nParagraph with **bold text** and more words.\n\n## Second heading\n\nClick this plain paragraph accurately.\n\nLast line.",
);
