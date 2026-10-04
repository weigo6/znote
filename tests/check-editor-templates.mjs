// Verify the actual TypeScript insertion templates using the Python renderer source.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { EditorState } from "@codemirror/state";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { gridCardsMarkdown, materialSnippets } = await server.ssrLoadModule(
    "/src/material-snippets.ts",
  );
  const { editorCommand } = await server.ssrLoadModule("/src/editor-command-registry.ts");
  const cards = gridCardsMarkdown([
    {
      title: "Start *here*",
      body: "Text\n\n- Nested item",
      icon: ":material-star:",
      link: "guide.md",
    },
    { title: "Two", body: "中文正文", icon: "", link: "" },
  ]);
  const cases = [
    { id: "cards", text: cards, marker: 'class="grid cards"' },
    ...materialSnippets.map((snippet) => ({
      id: snippet.id,
      text: snippet.text("Selected\nsecond line"),
      marker: snippet.id.startsWith("admonition-")
        ? 'class="admonition ' + snippet.id.slice(11) + '"'
        : snippet.id === "details"
          ? "<details"
          : snippet.id === "tabs"
            ? "tabbed-set"
            : snippet.id === "mermaid"
              ? 'class="mermaid"'
              : 'class="md-button"',
    })),
  ];
  for (const action of ["footnote", "reference"]) {
    const text = action === "footnote" ? "Original[^note]\n\n[^note]: ORIGINAL" : "[Original][ref]\n\n[ref]: https://original.example/";
    let state = EditorState.create({doc:text,selection:{anchor:text.length}});
    state = state.update(editorCommand(action).transaction(state)).state;
    cases.push({id:action,text:state.doc.toString(),marker:action === "footnote" ? "ORIGINAL" : 'href="https://original.example/"'});
  }
  const python =
    process.env.ZNOTE_PYTHON ||
    (process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python");
  const request = cases.map((item) => ({ action: "render", text: item.text }));
  request.push({
    action: "render",
    text: cards,
    settings: { extensions: { md_in_html: false } },
  });
  const result = spawnSync(python, ["python/znote_renderer.py"], {
    input: request.map((item) => JSON.stringify(item)).join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const rendered = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(rendered.length, request.length);
  cases.forEach((item, i) => {
    assert.ok(!rendered[i].error, rendered[i].error);
    assert.ok(
      rendered[i].html.includes(item.marker),
      item.id + " did not render its component",
    );
    assert.deepEqual(
      rendered[i].warnings,
      [],
      item.id + " produced renderer warnings",
    );
  });
  assert.ok(rendered[0].html.includes("<svg"), "Card icon did not render");
  assert.ok(
    rendered[0].html.includes('<a href="guide.md">'),
    "Card link did not render",
  );
  assert.ok(
    rendered[0].html.includes("<strong>Start *here*</strong>"),
    "Card title escaping changed its text",
  );
  assert.ok(
    rendered[0].html.includes("Nested item"),
    "Nested card Markdown was lost",
  );
  assert.ok(
    !rendered.at(-1).html.includes("<strong>Start *here*</strong>"),
    "Disabled md_in_html was ignored",
  );
  const footnote = rendered[cases.findIndex(item => item.id === "footnote")].html;
  assert.ok(footnote.includes('id="fn:note"') && footnote.includes('id="fn:note-2"'), "Footnote insertion reused an existing definition");
  const reference = rendered[cases.findIndex(item => item.id === "reference")].html;
  assert.ok(reference.includes('href="https://"'), "New reference did not render independently");
  console.log(
    `${cases.length} editor templates passed actual Python rendering and dependency checks.`,
  );
} finally {
  await server.close();
}
