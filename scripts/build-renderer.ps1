param([string]$OutputDirectory = 'build/renderer-dist')
# Windows PowerShell 5.1 turns a native command's stderr output into a *terminating*
# error while $ErrorActionPreference is 'Stop'. uv reports progress on stderr, which
# aborted this script before PyInstaller ever ran. Native steps are therefore evaluated
# through their exit codes, which are checked explicitly after every call.
$ErrorActionPreference = 'Continue'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    if (-not (Test-Path '.venv/Scripts/python.exe')) {
        uv venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'venv failed' }
    }
    uv --cache-dir .uv-cache pip install --python .venv/Scripts/python.exe -r python/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'dependencies failed' }
    $hidden = @(Get-ChildItem '.venv/Lib/site-packages' -Filter '*__mypyc*.pyd' | ForEach-Object { '--hidden-import'; $_.Name.Split('.')[0] })
    $configData = (Resolve-Path 'config/render-capabilities.json').Path + ';config'
    $iconData = (Resolve-Path '.venv/Lib/site-packages/zensical/templates/.icons').Path + ';zensical/templates/.icons'
    $workspacePath = (Get-Location).Path
    $resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path $workspacePath $OutputDirectory))
    if (-not $resolvedOutput.StartsWith($workspacePath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Renderer output must stay inside the workspace.' }
    & .venv/Scripts/python.exe -m PyInstaller --noconfirm --onedir --name znote-renderer --distpath $resolvedOutput --workpath build/renderer --specpath build --collect-all pymdownx --collect-all markdown --collect-all pygments --collect-all yaml --add-data $configData --add-data $iconData --copy-metadata zensical --copy-metadata Markdown --copy-metadata pymdown-extensions --copy-metadata Pygments @hidden python/znote_renderer.py
    if ($LASTEXITCODE -ne 0) { throw 'renderer build failed' }
} finally { Pop-Location }
