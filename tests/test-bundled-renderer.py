"""Verify the packaged JSONL renderer and GUI settings protocol."""
import json
from pathlib import Path
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
root = Path(__file__).resolve().parent.parent
exe = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "build/renderer-dist/znote-renderer/znote-renderer.exe"
process = subprocess.Popen([str(exe)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, text=True, encoding="utf-8")


def request(value):
    process.stdin.write(json.dumps(value, ensure_ascii=False) + "\n")
    process.stdin.flush()
    result = json.loads(process.stdout.readline())
    if "error" in result:
        raise AssertionError(result["error"])
    return result


try:
    info = request({"action": "info"})
    assert "zensical" in info["versions"]
    assert info["capabilities"]["schemaVersion"] == 3
    default = request({"action": "render", "text": "!!! note\n\n    你好 😀"})
    assert "admonition note" in default["html"]
    assert default["sourceMap"]["version"] == 1
    assert default["sourceMap"]["offsetEncoding"] == "utf-16"
    assert any(entry["precision"] == "exact" for entry in default["sourceMap"]["entries"])
    custom = request({"action": "render", "text": "!!! note\n\n    你好 😀",
                      "settings": {"extensions": {"admonition": False}, "variant": "classic",
                                   "primary": "teal", "accent": "cyan",
                                   "customCss": ":root > * { --md-primary-fg-color: #123456; }"}})
    assert "admonition note" not in custom["html"]
    assert custom["theme"]["variant"] == "classic"
    assert custom["theme"]["primary"] == "teal"
    assert custom["plan"]["styles"][0]["source"] == "user-custom-css"
    # ZNote has no site/project configuration layer. The plan must not carry
    # config-source fields again: their presence would mean the removed
    # standalone-vs-project distinction had been reintroduced.
    assert "context" not in custom["plan"] and "sources" not in custom["plan"]
    icons = request({"action": "render", "text": ":material-home: :fontawesome-brands-github: :octicons-mark-github-16: :lucide-book-open: :simple-python:"})
    assert icons["html"].count("<svg") == 5
    assert not icons["warnings"]
    configured = request({"action": "render", "text": "$x$ and \\(y\\)", "settings": {
        "reader": {"preset": "book"}, "math": {"macros": {"RR": "\\mathbb{R}"}},
        "extensionConfigs": {"pymdownx.arithmatex": {"inline_syntax": ["round"]}}}})
    assert configured["html"].count("arithmatex") == 1
    assert configured["theme"]["reader"]["font"] == "serif"
    assert configured["plan"]["math"]["macros"]["RR"]["body"] == "\\mathbb{R}"
    assert request({"action": "render", "text": "# After settings"})["html"].startswith("<h1")
    body = '# Header 😀\n\n- same\n- same'
    prefix = '---\ntitle: cache\n---\n'
    a = request({"action": "render", "text": body})
    b = request({"action": "render", "text": prefix + body})
    assert b["sourceMap"]["entries"][0]["from"] == len(prefix)
    assert a["html"] == b["html"]
    print("Packaged Markdown rendering and GUI settings passed", flush=True)
finally:
    process.stdin.close()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
