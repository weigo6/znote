import sys
import unittest
import json
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render_plan import DEFAULT_MARKDOWN_EXTENSIONS, EXTENSIONS, resolve
from znote_renderer import render
from render_config import normalize, get_field
import znote_renderer


class RenderPlanTests(unittest.TestCase):
    def test_shared_typescript_python_configuration_contract(self):
        cases = json.loads((Path(__file__).parent.parent / "tests/fixtures/config-cases.json").read_text(encoding="utf-8"))
        for case in cases:
            with self.subTest(case=case["name"]):
                settings, issues = normalize(case["input"])
                self.assertEqual(sorted(i["path"] for i in issues), sorted(case["paths"]))
                for path, expected in case.get("expected", {}).items():
                    self.assertEqual(get_field(settings, path), expected)

    def test_parse_cache_uses_parser_dependencies_and_copies_toc(self):
        znote_renderer._parse_cache.clear()
        znote_renderer._cache_bytes = 0
        with patch.object(znote_renderer.markdown, "Markdown", wraps=znote_renderer.markdown.Markdown) as parser:
            first = render({"text": "# Cached heading"})
            first["toc"][0]["name"] = "mutated by caller"
            second = render({"text": "# Cached heading", "settings": {"reader": {"preset": "book"}, "math": {"engine": "mathjax"}}})
            self.assertEqual(parser.call_count, 1)
            self.assertEqual(second["toc"][0]["name"], "Cached heading")
            render({"text": "# Cached heading", "settings": {"extensionConfigs": {"toc": {"permalink": False}}}})
            self.assertEqual(parser.call_count, 2)
            render({"text": "# Different source"})
            self.assertEqual(parser.call_count, 3)
    def test_bundled_document_defaults_match_pinned_zensical(self):
        from zensical.config import DEFAULT_MARKDOWN_EXTENSIONS as upstream
        self.assertEqual(DEFAULT_MARKDOWN_EXTENSIONS, upstream)

    def test_every_builtin_extension_can_be_disabled_in_app_settings(self):
        settings = {"extensions": {name: False for name in EXTENSIONS}}
        plan, extensions, _, _, _, _ = resolve({"settings": settings})
        self.assertEqual(extensions, [])
        self.assertEqual(plan["math"]["engine"], "none")
        self.assertNotIn("mermaid", plan["runtimes"])

    def test_options_change_rendering_and_revision(self):
        first = render({"text": "# Heading\n\n```python\nprint(1)\n```"})
        second = render({"text": "# Heading\n\n```python\nprint(1)\n```",
                         "settings": {"options": {"toc_permalink": False, "highlight_line_numbers": True}}})
        self.assertNotEqual(first["plan"]["revisions"]["parse"], second["plan"]["revisions"]["parse"])
        self.assertNotIn("headerlink", second["html"])
        self.assertIn("linenodiv", second["html"])

    def test_theme_palette_and_user_css_override(self):
        css = ":root > * { --md-primary-fg-color: #123456; }"
        result = render({"text": "# Heading", "settings": {
            "variant": "classic", "primary": "teal", "accent": "cyan", "customCss": css}})
        self.assertEqual({key: result["theme"][key] for key in ("variant", "primary", "accent")}, {"variant": "classic", "primary": "teal", "accent": "cyan"})
        self.assertEqual(result["plan"]["styles"], [{"source": "user-custom-css", "css": css}])
        self.assertNotEqual(result["theme"], render({"text": "# Heading"})["theme"])
        night = render({"text": "# Heading", "settings": {"primary": "blue grey", "accent": "light blue"}})
        self.assertEqual(night["theme"]["primary"], "blue-grey")
        self.assertEqual(night["theme"]["accent"], "light-blue")

    def test_revision_boundaries_and_effective_parameters(self):
        base = render({"text": "# H\n\n## H2"})["plan"]
        theme = render({"text": "# H\n\n## H2", "settings": {"reader": {"preset": "book"}}})["plan"]
        self.assertEqual(base["revisions"]["parse"], theme["revisions"]["parse"])
        self.assertEqual(base["revisions"]["runtime"], theme["revisions"]["runtime"])
        self.assertNotIn("style", theme["revisions"])
        changed = render({"text": "# H\n\n## H2", "settings": {"extensionConfigs": {"toc": {"toc_depth": "1"}}},
                          "includeEffectiveConfig": True})
        self.assertEqual(len(changed["toc"][0]["children"]), 0)
        self.assertEqual(changed["effectiveConfig"]["extensionConfigs"]["toc"]["toc_depth"], "1")

    def test_runtime_protocol_excludes_diagnostic_fields_by_default(self):
        result = render({"text": "# Heading"})
        self.assertEqual(result["plan"]["schemaVersion"], 4)
        for field in ("effectiveConfig", "profile", "extensions", "highlightCss"):
            self.assertNotIn(field, result)
        for field in ("engine", "engineVersion", "documentPath", "extensions",
                      "dependencies", "configRevision", "effectiveConfig"):
            self.assertNotIn(field, result["plan"])

    def test_math_input_syntax_macros_and_dependencies(self):
        result = render({"text": "$x$ and \\(y\\)", "settings": {
            "extensionConfigs": {"pymdownx.arithmatex": {"inline_syntax": ["round"]}},
            "math": {"engine": "mathjax", "macros": {"norm": {"body": "\\lVert #1\\rVert", "args": 1}}}}})
        self.assertIn("$x$", result["html"])
        self.assertEqual(result["html"].count('class="arithmatex"'), 1)
        self.assertEqual(result["plan"]["math"]["macros"]["norm"]["args"], 1)
        disabled = render({"text": "$x$", "settings": {"extensions": {"pymdownx.arithmatex": False}}})
        self.assertEqual(disabled["plan"]["math"]["engine"], "none")

    def test_invalid_options_report_paths_and_do_not_execute_callbacks(self):
        result = render({"text": "$x$", "settings": {"extensionConfigs": {"pymdownx.arithmatex": {"generic": False}, "toc": {"slugify": "os.system"}}}})
        self.assertTrue(any("generic" in warning for warning in result["warnings"]))
        self.assertTrue(any("slugify" in warning for warning in result["warnings"]))
        self.assertIn("arithmatex", result["html"])

    def test_explicit_code_line_numbers_and_theme_owned_css(self):
        result = render({"text": '```python linenums="1"\na=1\nb=2\n```'})
        self.assertIn("linenodiv", result["html"])
        self.assertNotIn("highlightCss", result)


if __name__ == "__main__":
    unittest.main()
