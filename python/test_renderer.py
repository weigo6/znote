import json
from pathlib import Path
import subprocess
import unittest
import sys
sys.path.insert(0,str(Path(__file__).parent))
from znote_renderer import render, front_matter

FIXTURE=Path(__file__).resolve().parent.parent/'tests/fixtures/syntax-coverage.md'

class RendererTests(unittest.TestCase):
    def test_default_extensions(self):
        result=render({'text':FIXTURE.read_text(encoding='utf-8')})
        for marker in ['admonition note','<details','tabbed-set','footnote-ref','task-list-item','<table','<mark>','<del>','<kbd','md-button','<svg','arithmatex','mermaid','grid cards','中文正文']:
            self.assertIn(marker,result['html'])
    def test_frontmatter_safe(self):
        text,meta,warnings=front_matter('---\ntitle: 测试\n---\n正文')
        self.assertEqual(meta,{'title':'测试'})
        self.assertEqual(text,'正文')
        self.assertFalse(warnings)
    def test_gui_extension_toggle(self):
        text = '!!! note\n\n    ok'
        self.assertIn('admonition note', render({'text': text})['html'])
        self.assertNotIn('admonition note', render({'text': text, 'settings': {
            'extensions': {'admonition': False}}})['html'])
    def test_gui_math_engine(self):
        result = render({'text': '$E=mc^2$', 'settings': {'mathEngine': 'none'}})
        self.assertEqual(result['plan']['math']['engine'], 'none')

    def test_code_annotations_keep_pygments_comments_and_ordered_list(self):
        source = '```python\nx = 42  # (1)!\n```\n\n1. **说明**'
        result = render({'text': source, 'settings': {'features': {'codeAnnotations': True}}})
        self.assertIn('class="c1"', result['html'])
        self.assertIn('(1)!', result['html'])
        self.assertIn('<ol ', result['html'])
        self.assertTrue(result['plan']['features']['codeAnnotations'])

    def test_code_controls_use_zensical_block_classes_without_changing_parse(self):
        source = '```python {.copy .select linenums="1"}\nfirst()\nsecond()\n```'
        result = render({'text': source})
        self.assertIn('class="language-python copy select highlight"', result['html'])
        self.assertIn('id="__span-0-1"', result['html'])
        self.assertIn('id="__codelineno-0-2"', result['html'])
        self.assertTrue(result['plan']['features']['codeCopy'])
        self.assertFalse(result['plan']['features']['codeSelect'])

if __name__=='__main__': unittest.main()
