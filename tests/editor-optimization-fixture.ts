import { EditorView } from "@codemirror/view";
import { EditorToolbar } from "../src/editor-toolbar";
import { initializeIcons } from "../src/ui-icons";
import { Bold } from "lucide";

export function measureInput() {
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(
      ".tab-editor:not([hidden]) .cm-editor",
    )!,
  )!;
  const original = EditorToolbar.prototype.refresh;
  let refreshes = 0;
  EditorToolbar.prototype.refresh = function () {
    refreshes++;
    return original.call(this);
  };
  const before = [...document.querySelectorAll("svg[data-lucide]")];
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    const end = view.state.doc.length;
    view.dispatch({
      changes: { from: end, insert: "x" },
      selection: { anchor: end + 1 },
    });
    const records = observer.takeRecords();
    const svgCount = (nodes: NodeList) =>
      [...nodes].reduce(
        (count, node) =>
          count +
          (node instanceof Element
            ? Number(node.matches("svg")) + node.querySelectorAll("svg").length
            : 0),
        0,
      );
    return {
      refreshes,
      total: before.length,
      detached: before.filter((node) => !node.isConnected).length,
      added: records.reduce(
        (sum, record) => sum + svgCount(record.addedNodes),
        0,
      ),
      removed: records.reduce(
        (sum, record) => sum + svgCount(record.removedNodes),
        0,
      ),
    };
  } finally {
    observer.disconnect();
    EditorToolbar.prototype.refresh = original;
  }
}

export function checkLifecycle() {
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  const root = document.createElement("div");
  document.body.append(root);
  let commands = 0;
  const toolbar = new EditorToolbar(root, {
    editor: () => view,
    mode: () => "source",
    command: () => {
      commands++;
    },
    setMode: () => {},
    missing: () => [],
    icons: () => {},
  });
  const button = root.querySelector<HTMLButtonElement>(
    '[data-command="bold"]',
  )!;
  const menusBefore = document.querySelectorAll(".editor-toolbar-menu").length;
  button.click();
  toolbar.destroy();
  toolbar.destroy();
  button.click();
  root
    .querySelector<HTMLButtonElement>('[data-toolbar-menu="paragraph"]')!
    .click();
  const result = {
    commands,
    menusRemoved:
      menusBefore - document.querySelectorAll(".editor-toolbar-menu").length,
  };
  root.remove();
  return result;
}

export function checkIconInitialization() {
  const root = document.createElement("div");
  root.innerHTML =
    '<i data-lucide="bold" aria-hidden="true" class="custom"></i>';
  initializeIcons(root, { Bold });
  const svg = root.firstElementChild;
  initializeIcons(root, { Bold });
  return {
    same: svg === root.firstElementChild,
    accessible: svg?.getAttribute("aria-hidden"),
    custom: svg?.classList.contains("custom"),
    tag: svg?.tagName,
  };
}
