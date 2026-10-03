"""Isolated JSON-lines Markdown renderer used by the desktop application."""
import contextlib
import importlib.metadata
import io
import json
import os
import sys
import traceback
import copy
import hashlib
from collections import OrderedDict

import markdown
import yaml

from render_plan import resolve
from render_config import CAPABILITIES
from source_map import SourceMap

_parse_cache = OrderedDict()
_cache_bytes = 0

def convert_cached(text, plan, extensions, configs):
    """Styles and runtime preferences do not require another Markdown parse."""
    global _cache_bytes
    key = (hashlib.sha256(text.encode()).hexdigest(), plan["revisions"]["parse"])
    cached = _parse_cache.get(key)
    if cached is not None:
        _parse_cache.move_to_end(key)
        return cached[0], copy.deepcopy(cached[1]), [entry.copy() for entry in cached[2]]
    md = markdown.Markdown(extensions=extensions, extension_configs=configs, output_format="html")
    mapping = SourceMap(md, text)
    html = md.convert(text)
    toc = getattr(md, "toc_tokens", [])
    entries = mapping.entries
    size = len(html.encode()) + len(json.dumps(toc).encode()) + len(json.dumps(entries).encode())
    if size <= 8 * 1024 * 1024:
        _parse_cache[key] = (html, copy.deepcopy(toc), [entry.copy() for entry in entries], size)
        _cache_bytes += size
        while len(_parse_cache) > 6 or _cache_bytes > 16 * 1024 * 1024:
            _, removed = _parse_cache.popitem(last=False)
            _cache_bytes -= removed[3]
    return html, toc, entries


def front_matter(text):
    lines = text.splitlines(keepends=True)
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                try:
                    meta = yaml.safe_load("".join(lines[1:i])) or {}
                    return "".join(lines[i + 1:]), meta if isinstance(meta, dict) else {}, []
                except yaml.YAMLError as exc:
                    return text, {}, [f"Front matter 无法解析：{exc}"]
    return text, {}, []


def render(req):
    original = req.get("text", "")
    # CodeMirror uses LF and UTF-16 offsets. Preserve CRLF input offsets when
    # this renderer is called directly; the GUI already normalizes its text.
    text, meta, warnings = front_matter(original)
    prefix = original[:len(original) - len(text)]
    plan, extensions, configs, theme, effective, config_warnings = resolve(req)
    warnings.extend(config_warnings)
    html, toc, entries = convert_cached(text, plan, extensions, configs)
    base = len(prefix.encode("utf-16-le")) // 2
    if base:
        for entry in entries:
            if "from" in entry:
                entry["from"] += base
                entry["to"] += base
    result = {"html": html, "toc": toc, "meta": meta,
              "sourceMap": {"version": 1, "offsetEncoding": "utf-16", "entries": entries},
              "warnings": warnings, "theme": theme, "plan": plan}
    if effective is not None:
        result["effectiveConfig"] = effective
    return result


def dispatch(req):
    if req.get("action") == "info":
        return {"versions": {name: importlib.metadata.version(name) for name in ("zensical", "Markdown", "pymdown-extensions")},
                "python": sys.version.split()[0], "capabilities": CAPABILITIES}
    if req.get("action") == "render":
        return render(req)
    raise ValueError("Unknown action")


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    null = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, sys.stdout.fileno())
    os.close(null)
    for line in sys.stdin:
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                result = dispatch(json.loads(line))
            protocol.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
        except Exception as exc:
            protocol.write(json.dumps({"error": f"{exc}\n{traceback.format_exc()}"}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
