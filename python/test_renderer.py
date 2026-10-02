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
        for marker in ['admonition note','<details','tabbed-set','footnote-ref','task-list-item','<table>','<mark>','<del>','<kbd','md-button','<svg','arithmatex','mermaid','grid cards','中文正文']:
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

if __name__=='__main__': unittest.main()
