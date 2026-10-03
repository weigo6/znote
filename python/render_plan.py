"""Build a document-only Markdown render plan from application preferences."""
from __future__ import annotations

import copy
import hashlib
import json

from zensical.extensions.emoji import to_svg, twemoji
from render_config import CAPABILITIES, normalize

# Pinned output adapters from Zensical 0.0.66. User-facing capabilities live in
# config/render-capabilities.json; importing zensical.config loads site machinery.
DEFAULT_MARKDOWN_EXTENSIONS = {
    "abbr": {}, "admonition": {}, "attr_list": {}, "def_list": {},
    "footnotes": {}, "md_in_html": {}, "toc": {"permalink": True},
    "pymdownx.arithmatex": {"generic": True},
    "pymdownx.betterem": {}, "pymdownx.caret": {}, "pymdownx.details": {},
    "pymdownx.emoji": {"emoji_generator": to_svg, "emoji_index": twemoji},
    "pymdownx.highlight": {"anchor_linenums": True, "line_spans": "__span",
                            "pygments_lang_class": True},
    "pymdownx.inlinehilite": {}, "pymdownx.keys": {},
    "pymdownx.magiclink": {}, "pymdownx.mark": {},
    "pymdownx.smartsymbols": {},
    "pymdownx.superfences": {"custom_fences": [{"name": "mermaid", "class": "mermaid"}]},
    "pymdownx.tabbed": {"alternate_style": True, "combine_header_slug": True},
    "pymdownx.tasklist": {"custom_checkbox": True}, "pymdownx.tilde": {},
}

EXTENSIONS = tuple(dict.fromkeys((*DEFAULT_MARKDOWN_EXTENSIONS, "tables")))
def resolve(req):
    settings, issues = normalize(req.get("settings", {}))
    warnings = [f"{item['path']}：{item['message']}；已使用有效值或默认值。" for item in issues]
    return resolve_validated(req, settings, warnings)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def resolve_validated(req, settings, warnings):
    enabled = settings["extensions"]
    configs = copy.deepcopy(DEFAULT_MARKDOWN_EXTENSIONS)
    configs.setdefault("tables", {})
    effective_options = {}
    for extension in CAPABILITIES["extensions"]:
        eid = extension["id"]
        options = {name: copy.deepcopy(spec["default"]) for name, spec in extension["options"].items()}
        options.update(settings["extensionConfigs"].get(eid, {}))
        configs[eid].update(options)
        effective_options[eid] = options
    # "Default line numbers off" still permits linenums="1" on an individual block.
    configs["pymdownx.highlight"]["linenums"] = True if effective_options["pymdownx.highlight"]["linenums"] else None
    # Output conventions are an internal protocol, never user-overridable callbacks.
    configs["pymdownx.arithmatex"]["generic"] = True
    extensions = [name for name in EXTENSIONS if enabled.get(name, True)]
    math_settings = copy.deepcopy(settings["math"])
    if "pymdownx.arithmatex" not in extensions:
        math_settings["engine"] = "none"
    mermaid = copy.deepcopy(settings["mermaid"])
    if "pymdownx.superfences" not in extensions:
        mermaid["enabled"] = False
    features = copy.deepcopy(settings["features"])
    if "footnotes" not in extensions:
        features["footnoteTooltips"] = False
    theme = {"variant": settings["variant"], "primary": settings["primary"].replace(" ", "-"),
             "accent": settings["accent"].replace(" ", "-"), "reader": settings["reader"]}
    runtimes = (["tabs"] if "pymdownx.tabbed" in extensions else []) + (["mermaid"] if mermaid["enabled"] else [])
    if features["footnoteTooltips"]:
        runtimes.append("footnotes")
    revisions = {
        "parse": fingerprint({"extensions": extensions, "options": {name: effective_options[name] for name in extensions}}),
        "runtime": fingerprint({"math": math_settings, "mermaid": mermaid, "features": features}),
    }
    effective = None
    if req.get("includeEffectiveConfig"):
        effective = copy.deepcopy(settings)
        effective["extensionConfigs"] = effective_options
        effective["math"] = math_settings
        effective["mermaid"] = mermaid
        effective["features"] = features
    plan = {
        "schemaVersion": 4,
        "math": math_settings, "mermaid": mermaid, "features": features,
        "runtimes": runtimes,
        "styles": [{"source": "user-custom-css", "css": settings["customCss"]}] if settings["customCss"] else [],
        "revisions": revisions,
    }
    return plan, extensions, configs, theme, effective, warnings
