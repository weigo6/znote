"""Package the release executable with its Python runtime and license notices."""
from pathlib import Path
import hashlib
import importlib.metadata
import json
import shutil
import sys
import zipfile

root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
destination=root/f'release/ZNote-{version}-windows-x64'
if destination.exists():
    raise SystemExit(f'Release directory already exists: {destination}. Keep release artifacts immutable; choose a new version before packaging again.')

# Resolve every input before creating anything, so a missing file fails cleanly
# instead of leaving a half-written release directory behind.
inputs={
    'executable':root/'src-tauri/target/release/znote.exe',
    'renderer runtime':root/'build/renderer-dist/znote-renderer',
    'README':root/'README.md',
    'CHANGELOG':root/'CHANGELOG.md',
    'LICENSE':root/'LICENSE',
    'user documentation':root/'docs',
    'vendored Zensical license':root/'tests/vendor/zensical/LICENSE.md',
    'icon licenses':root/'tests/vendor/icon-licenses',
}
missing=[f'{name}: {path}' for name,path in inputs.items() if not path.exists()]
if missing:
    raise SystemExit('Missing release input(s):\n  '+'\n  '.join(missing))

destination.mkdir(parents=True)
shutil.copy2(inputs['executable'],destination/'ZNote.exe')
shutil.copytree(inputs['renderer runtime'],destination/'bin/znote-renderer',copy_function=shutil.copyfile)
shutil.copy2(inputs['README'],destination/'README.md')
shutil.copy2(inputs['CHANGELOG'],destination/'CHANGELOG.md')
shutil.copy2(inputs['LICENSE'],destination/'LICENSE')
# Only user-facing documentation ships. Internal engineering records live in the
# repository's gitignored .dev-archive/ and are deliberately not packaged.
shutil.copytree(inputs['user documentation'],destination/'docs')
shutil.copy2(root/'docs/theme-override.example.css',destination/'theme-override.example.css')
licenses=destination/'licenses';licenses.mkdir(exist_ok=True)
shutil.copy2(inputs['vendored Zensical license'],licenses/'Zensical-MIT.md')
shutil.copy2(root/'node_modules/mathjax-full/LICENSE',licenses/'MathJax-Apache-2.0.txt')
shutil.copytree(inputs['icon licenses'],licenses/'icons')
for package, file in [('katex','LICENSE'),('mermaid','LICENSE'),('dompurify','LICENSE'),('lucide','LICENSE')]:
    shutil.copy2(root/f'node_modules/{package}/{file}',licenses/f'{package}-LICENSE.txt')
for package in ['Markdown','pymdown-extensions','Pygments','PyYAML','zensical','pyinstaller']:
    distribution=importlib.metadata.distribution(package)
    for file in distribution.files or []:
        if ('license' in file.name.lower() or file.name.startswith('COPYING')) and '.dist-info' in str(file):
            shutil.copy2(distribution.locate_file(file),licenses/f'{package}-{file.name}')
python_license=Path(sys.base_prefix)/'LICENSE.txt'
if python_license.exists():shutil.copy2(python_license,licenses/'Python-LICENSE.txt')
for font in ['inter','jetbrains-mono','roboto','roboto-mono']:
    shutil.copy2(root/f'node_modules/@fontsource-variable/{font}/LICENSE',licenses/f'{font}-OFL.txt')
archive=destination.parent/(destination.name+'.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(destination.rglob('*')):
        if p.is_file():z.write(p,p.relative_to(destination.parent))
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.sha256').write_text(f'{checksum}  {archive.name}\n',encoding='utf-8')
print(archive)
print(f'{archive.stat().st_size/1024/1024:.1f} MB; SHA256 {checksum}')
