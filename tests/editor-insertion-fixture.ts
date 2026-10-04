import { EditorView } from "@codemirror/view";

/** Simulate cursor movement or an external document update while a dialog is open. */
export function updateEditor(
  text: string | undefined,
  anchor = 0,
  head = anchor,
) {
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(
      ".tab-editor:not([hidden]) .cm-editor",
    )!,
  )!;
  view.dispatch({
    changes:
      text === undefined
        ? undefined
        : { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor, head },
  });
}
