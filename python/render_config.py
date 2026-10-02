"""Validate data-only preferences against the same manifest used by the UI."""
from __future__ import annotations
import copy
import json
import math
from pathlib import Path
import re
import sys

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
CAPABILITIES = json.loads((ROOT / "config" / "render-capabilities.json").read_text(encoding="utf-8"))
COLORS = {"app", "red", "pink", "purple", "deep purple", "indigo", "blue", "light blue", "cyan", "teal", "green", "light green", "lime", "yellow", "amber", "orange", "deep orange", "brown", "grey", "blue grey", "black", "white"}

def record(value):
    return value if isinstance(value, dict) else {}

def get_field(value, path):
    for key in path.split("."):
        value = record(value).get(key)
    return value

def set_field(value, path, item):
    keys = path.split(".")
    for key in keys[:-1]:
        if not isinstance(value.get(key), dict):
            value[key] = {}
        value = value[key]
    value[keys[-1]] = item

def has_field(value, path):
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value:
            return False
        value = value[key]
    return True

def valid(value, spec):
    kind = spec["type"]
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "booleanOrText":
        return isinstance(value, bool) or isinstance(value, str) and len(value) <= spec.get("maxLength", 100)
    if kind == "enum":
        return isinstance(value, str) and value in spec["values"]
    if kind == "choices":
        return isinstance(value, list) and all(isinstance(v, str) and v in spec["values"] for v in value) and len(set(value)) == len(value)
    if kind == "text":
        return isinstance(value, str) and len(value) <= spec.get("maxLength", 1000) and (not spec.get("pattern") or re.fullmatch(spec["pattern"], value) is not None)
    if kind in ("number", "integer"):
        return type(value) in (int, float) and math.isfinite(value) and (kind != "integer" or int(value) == value) and spec.get("min", -math.inf) <= value <= spec.get("max", math.inf)
    return False

def normalize(input_value):
    issues = []
    def issue(path, message="参数类型或取值无效"):
        issues.append({"path": path, "message": message})
    if not isinstance(input_value, dict):
        issue("settings", "设置应为配置对象")
    data = copy.deepcopy(record(input_value))
    if "extensionConfigs" in data and not isinstance(data["extensionConfigs"], dict):
        issue("extensionConfigs", "应为配置对象")
    if "mathEngine" in data and not has_field(data, "math.engine"):
        set_field(data, "math.engine", data["mathEngine"])
    if isinstance(data.get("mermaid"), bool):
        data["mermaid"] = {"enabled": data["mermaid"]}
    configs = record(data.get("extensionConfigs"))
    legacy = record(data.get("options"))
    for extension in CAPABILITIES["extensions"]:
        for name, spec in extension["options"].items():
            if spec.get("legacy") in legacy:
                options = record(configs.get(extension["id"]))
                options.setdefault(name, legacy[spec["legacy"]])
                configs[extension["id"]] = options
    data["extensionConfigs"] = configs
    for key in ("mathEngine", "options", "themePreset"):
        data.pop(key, None)
    if "schemaVersion" in data and (type(data["schemaVersion"]) is not int or data["schemaVersion"] not in (1, 2, 3)):
        issue("schemaVersion", "配置版本不受支持")
    result = {"schemaVersion": CAPABILITIES["schemaVersion"]}
    preset = next((p for p in CAPABILITIES["readerPresets"] if p["id"] == get_field(data, "reader.preset")), {})
    for path, spec in CAPABILITIES["fields"].items():
        supplied = get_field(data, path)
        fallback = preset.get(path[7:], spec["default"]) if path.startswith("reader.") else spec["default"]
        if has_field(data, path) and not valid(supplied, spec):
            issue(path)
        set_field(result, path, copy.deepcopy(supplied if supplied is not None and valid(supplied, spec) else fallback))
    for name in ("primary", "accent"):
        supplied = data.get(name, "app")
        if not isinstance(supplied, str) or supplied not in COLORS:
            issue(name)
            supplied = "app"
        result[name] = supplied
    css = data.get("customCss", "")
    if not isinstance(css, str) or len(css) > 262144:
        issue("customCss", "CSS 必须为文本，且不超过 256 KB")
        css = ""
    result["customCss"] = css
    enabled = record(data.get("extensions"))
    if "extensions" in data and not isinstance(data["extensions"], dict):
        issue("extensions", "应为配置对象")
    result["extensions"] = {}
    result["extensionConfigs"] = {}
    for extension in CAPABILITIES["extensions"]:
        eid = extension["id"]
        if eid in enabled and not isinstance(enabled[eid], bool):
            issue(f"extensions.{eid}")
        result["extensions"][eid] = enabled.get(eid) is not False
        options = record(configs.get(eid))
        if eid in configs and not isinstance(configs[eid], dict):
            issue(f"extensionConfigs.{eid}")
        for key, value in options.items():
            spec = extension["options"].get(key)
            if not spec:
                issue(f"extensionConfigs.{eid}.{key}", "此参数未开放，不能覆盖内部渲染契约")
            elif not valid(value, spec) or key == "toc_depth" and "-" in str(value) and str(value)[0] > str(value)[2]:
                issue(f"extensionConfigs.{eid}.{key}")
            else:
                result["extensionConfigs"].setdefault(eid, {})[key] = value
    ids = {e["id"] for e in CAPABILITIES["extensions"]}
    for branch, options in (("extensions", enabled), ("extensionConfigs", configs)):
        for eid in options.keys() - ids:
            issue(f"{branch}.{eid}", "未内置此扩展")
    macros = record(get_field(data, "math.macros"))
    raw_macros = get_field(data, "math.macros")
    if has_field(data, "math.macros") and not isinstance(raw_macros, dict):
        issue("math.macros", "宏应为配置对象")
    normalized_macros = {}
    if len(macros) > 100:
        issue("math.macros", "最多定义 100 个宏")
    for raw_name, raw in list(macros.items())[:100]:
        name = raw_name.removeprefix("\\")
        value = {"body": raw, "args": max([0] + [int(n) for n in re.findall(r"#([1-9])", raw)])} if isinstance(raw, str) else record(raw)
        if not re.fullmatch("[A-Za-z]{1,40}", name) or not isinstance(value.get("body"), str) or len(value["body"]) > 4096 or type(value.get("args")) is not int or not 0 <= value["args"] <= 9 or value.keys() - {"body", "args"}:
            issue(f"math.macros.{raw_name}", "宏名仅含英文字母；参数数为 0–9；展开内容不超过 4096 字符")
        elif name in normalized_macros:
            issue(f"math.macros.{raw_name}", "宏名重复")
        else:
            normalized_macros[name] = value
    result["math"]["macros"] = normalized_macros
    known = {"schemaVersion", "math", "reader", "variant", "primary", "accent", "customCss", "mermaid", "features", "extensions", "extensionConfigs"}
    for key in data.keys() - known:
        issue(key, "未知配置字段")
    for branch in ("reader", "features", "mermaid", "math", "math.katex", "math.mathjax"):
        value = get_field(data, branch)
        if has_field(data, branch) and not isinstance(value, dict):
            issue(branch, "应为配置对象")
            continue
        for key in record(value):
            path = f"{branch}.{key}"
            if path != "math.macros" and not any(field == path or field.startswith(path + ".") for field in CAPABILITIES["fields"]):
                issue(path, "未知配置字段")
    return result, issues
