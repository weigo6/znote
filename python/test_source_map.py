import json
import re
import unittest
from pathlib import Path

import markdown
from render_plan import resolve
from znote_renderer import render, front_matter


def mapped(result, kind):
    return [entry for entry in result["sourceMap"]["entries"] if entry["kind"] == kind]


def utf16(text):
    return len(text.encode("utf-16-le")) // 2


class SourceMapTests(unittest.TestCase):
    def test_list_quote_ranges_do_not_consume_following_blocks(self):
        source = '# A\n\n- one\n- two\n\n> quote\n> second\n\n# B'
        result = render({"text": source})
        self.assertEqual([(entry["from"], entry["to"]) for entry in mapped(result, "li")], [(5, 10), (11, 16)])
        self.assertEqual(mapped(result, "ul")[0]["to"], 16)
        self.assertEqual(mapped(result, "blockquote")[0]["to"], 34)
        self.assertEqual(mapped(result, "h1")[-1]["from"], 36)

    def test_nested_lists_and_duplicate_text_have_independent_ranges(self):
        source = '- same\n    - same\n- same\n\n# End'
        items = mapped(render({"text": source}), "li")
        self.assertEqual([entry["from"] for entry in items], [0, 7, 18])
        self.assertTrue(all(entry["precision"] == "exact" for entry in items))

    def test_multiple_headers_without_blank_lines(self):
        result = render({"text": 'before\n# A\nafter\n# B'})
        self.assertEqual([entry["from"] for entry in mapped(result, "h1")], [7, 17])
        self.assertEqual([entry["from"] for entry in mapped(result, "p")], [0, 11])

    def test_frontmatter_cache_is_relative_and_not_mutated(self):
        body = '# 😀标题\n\ntext'
        first = '---\ntitle: short\n---\n'
        second = '---\ntitle: long\nauthor: me\n---\n'
        a = render({"text": first + body})
        b = render({"text": second + body})
        c = render({"text": first + body})
        self.assertEqual(mapped(a, "h1")[0]["from"], utf16(first))
        self.assertEqual(mapped(b, "h1")[0]["from"], utf16(second))
        self.assertEqual(a["sourceMap"], c["sourceMap"])

    def test_crlf_and_utf16_offsets(self):
        source = '😀\r\n\r\n# B\r\n'
        heading = mapped(render({"text": source}), "h1")[0]
        self.assertEqual(heading["from"], 6)
        self.assertEqual(heading["precision"], "exact")

    def test_fenced_code_placeholder_retains_original_range(self):
        source = '```python\n# fake\nx=1\n```\n\n# Real'
        result = render({"text": source})
        self.assertEqual(len(mapped(result, "h1")), 1)
        code = next(entry for entry in mapped(result, "div") if entry["precision"] == "exact")
        self.assertEqual((code["from"], code["to"]), (0, source.index('\n\n')))

    def test_reserved_user_attributes_are_overwritten(self):
        result = render({"text": '<div data-zn-node="forged">text</div>'})
        self.assertNotIn('forged', result["html"])
        self.assertIn('data-zn-node=', result["html"])
        result = render({"text": '<div data-zn-node title="literal data-zn-node=x">literal data-zn-node=x</div>'})
        self.assertIn('title="literal data-zn-node=x"', result["html"])
        self.assertIn('>literal data-zn-node=x</div>', result["html"])
        self.assertRegex(result["html"], r'<div data-zn-node="\d+" title=')

    def test_generated_footnote_does_not_match_same_body_text(self):
        result = render({"text": 'same\n\nreference[^a]\n\n[^a]: same'})
        paragraphs = mapped(result, "p")
        self.assertEqual(paragraphs[0]["from"], 0)
        self.assertEqual(paragraphs[-1]["precision"], 'generated')
        self.assertNotIn('from', paragraphs[-1])

    def test_mapping_does_not_change_rendered_semantics(self):
        source = (Path(__file__).resolve().parent.parent / 'tests/fixtures/syntax-coverage.md').read_text(encoding='utf-8')
        source, _, _ = front_matter(source)
        _, extensions, configs, *_ = resolve({"text": source})
        baseline = markdown.Markdown(extensions=extensions, extension_configs=configs, output_format='html').convert(source)
        result = render({"text": source})
        self.assertEqual(re.sub(r' data-zn-node="\d+"', '', result["html"]), baseline)
        generated = [entry for entry in result["sourceMap"]["entries"] if entry["precision"] == "generated"]
        self.assertTrue(generated)
        self.assertTrue(all('from' not in entry for entry in generated))
        json.dumps(result)


if __name__ == '__main__':
    unittest.main()
