"""Alternate baseline/mapped parses in the actual development Python runtime."""
import argparse
import json
import re
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'python'))
import markdown
from render_plan import resolve
from source_map import SourceMap

parser = argparse.ArgumentParser()
parser.add_argument('document', type=Path)
parser.add_argument('--runs', type=int, default=15)
args = parser.parse_args()
text = args.document.read_text(encoding='utf-8')
_, extensions, configs, *_ = resolve({'text': text})
samples = {'baseline': [], 'mapped': []}
for iteration in range(args.runs + 2):
    outputs = {}
    for mode in (['baseline', 'mapped'] if iteration % 2 else ['mapped', 'baseline']):
        started = time.perf_counter()
        md = markdown.Markdown(extensions=extensions, extension_configs=configs, output_format='html')
        mapping = SourceMap(md, text) if mode == 'mapped' else None
        html = md.convert(text)
        elapsed = (time.perf_counter() - started) * 1000
        if iteration >= 2:
            samples[mode].append(elapsed)
        outputs[mode] = html
        if mapping:
            counts = {kind: sum(entry['precision'] == kind for entry in mapping.entries)
                      for kind in ('exact', 'inherited', 'generated')}
            map_bytes = len(json.dumps(mapping.entries, separators=(',', ':')).encode())
    assert re.sub(r' data-zn-node="\d+"', '', outputs['mapped']) == outputs['baseline']
result = {'python': sys.version.split()[0], 'runs': args.runs, 'sourceBytes': len(text.encode()),
          'entries': counts, 'mapBytes': map_bytes,
          'htmlBytes': {key: len(value.encode()) for key, value in outputs.items()}}
for key, values in samples.items():
    result[key] = {'p50ms': round(statistics.median(values), 3),
                   'p95ms': round(sorted(values)[min(len(values) - 1, int(len(values) * .95))], 3)}
print(json.dumps(result, ensure_ascii=True))
