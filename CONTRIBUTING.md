# 参与开发

感谢你有兴趣改进 ZNote。本文覆盖从零搭建开发环境、构建、测试与提交约定。

面向使用者的功能与操作说明见 [README.md](README.md)；版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 环境要求

| 组件 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | 20 或更高 | 前端构建与测试 |
| pnpm | 任意近期版本 | 依赖管理（`pnpm-lock.yaml` 是唯一锁文件） |
| Rust | 1.77+ MSVC 工具链 | Tauri 桌面外壳 |
| Python | 3.11 | 内置渲染器（冻结运行时为 `python311.dll`） |
| uv | 任意近期版本 | 创建 `.venv`、安装渲染器依赖 |
| WebView2 Runtime | — | 运行与调试（Windows 11 已内置） |

`pnpm run` 与 `npm run` 都能执行脚本；`.npmrc` 把 pnpm store 固定在项目内的 `.pnpm-store/`。

## 首次设置

```powershell
# 1. 前端依赖
pnpm install

# 2. 构建内置渲染器（桌面端必做，见下方说明）
& .\scripts\build-renderer.ps1
```

### 为什么必须先构建渲染器

ZNote 的 Markdown 渲染不在 JavaScript 里，而是由一个**用 PyInstaller 冻结的 Python 可执行文件**
完成。这个进程不随源码分发，必须本地构建：

- 脚本会创建 `.venv`，按 `python/requirements.txt` 安装**固定版本**依赖（zensical / Markdown /
  pymdown-extensions / Pygments）。
- 产物落在 `build/renderer-dist/znote-renderer/`。
- 开发模式下 `src-tauri/src/main.rs` 从该路径启动渲染器；不构建它，预览功能不可用。

脚本还会注入两样很容易漏掉的运行时资源：

- `config/render-capabilities.json` → 运行时 `config/`
- `.venv/.../zensical/templates/.icons` → 运行时 `zensical/templates/.icons`

> 脚本在 Windows PowerShell 5.1 与 PowerShell 7 下都能运行。它依靠各原生命令的
> `$LASTEXITCODE` 判断失败，而不是依赖 `$ErrorActionPreference`。

## 项目结构

```
znote/
├── src/                        前端（TypeScript，无框架）
│   ├── main.ts                 应用入口：视图、文件导航、编辑命令、设置持久化
│   ├── editor.ts               CodeMirror 6 装配与快捷键
│   ├── render-config.ts        渲染配置校验、默认值补全、旧版本迁移
│   ├── render-settings-ui.ts   设置面板：分组控件、草稿、导入导出
│   ├── render-plugins.ts       内置运行时：公式、Mermaid、标签页、脚注
│   ├── runtime-mathjax.ts      按需加载 MathJax
│   ├── preview-surface.ts      隔离 iframe 的生命周期与主题同步
│   ├── preview.ts              HTML 清理、标识符命名空间、提交顺序
│   ├── preview-sync.ts         编辑光标与预览滚动同步
│   ├── preview-source-map.ts   DOM 节点源范围侧表与复用时的映射更新
│   ├── reader-theme.ts         应用主题令牌 → 正文颜色映射
│   ├── markdown-theme.css      应用侧排版适配
│   ├── zensical.generated.css  ← 生成文件，请勿手改
│   └── types.ts                前后端共享的类型契约
├── python/                     渲染器
│   ├── znote_renderer.py       JSONL 协议入口（常驻进程）
│   ├── source_map.py           解析阶段的块位置传播（固定 Markdown 版本适配）
│   ├── render_plan.py          渲染计划、扩展依赖、修订号、有界解析缓存
│   ├── render_config.py        配置规范化
│   └── test_*.py               渲染器单元测试
├── src-tauri/                  桌面外壳（Rust）
│   ├── src/main.rs             文件读写、访问授权、原子保存、渲染器进程管理
│   ├── tauri.conf.json         窗口、CSP、打包与资源映射
│   └── icons/                  应用图标资源
├── config/
│   └── render-capabilities.json  扩展与选项的单一事实来源（TS 与 Python 共用）
├── tests/                      全部测试与测试支持
│   ├── *.spec.ts               Playwright 浏览器回归
│   ├── generate-fixtures.py    生成 fixtures/rendered.json
│   ├── test-bundled-renderer.py 冻结渲染器端到端
│   ├── check-editor-templates.mjs 编辑器模板与 Python 渲染器集成测试
│   ├── benchmark-*             源码映射与预览同步性能测量
│   ├── *.html + *-fixture.ts   测试载具与夹具装配器
│   └── fixtures/               渲染样本、跨语言配置边界用例、语法覆盖样本
├── docs/                       面向使用者的文档与示例
├── scripts/                    构建与发版脚本
├── public/vendor/zensical/     内置的 Zensical 官方 CSS 与许可证
└── assets/icon.svg             应用图标 SVG 源文件
```

---

## 构建与运行

```powershell
# 桌面开发（需要已构建渲染器）
pnpm run tauri dev

# 仅前端，浏览器里调试界面
pnpm run dev            # http://127.0.0.1:1420
pnpm run build          # tsc --noEmit && vite build
pnpm run check          # 仅类型检查

# 便携版可执行文件
pnpm run tauri -- build --no-bundle

# NSIS 安装器
pnpm run tauri -- build
```

开发版 WebView2 数据保存在项目的 `.znote/webview-dev`，与安装版隔离，避免配置目录争用。
可用 `WEBVIEW2_USER_DATA_FOLDER` 覆盖；`tauri build` 不使用该开发路径。

### 同步 Zensical 样式

当 `python/requirements.txt` 里的 Zensical 版本变化时：

```powershell
pnpm run styles:sync
```

该脚本从 `.venv` 中**同一个固定版本的 wheel** 读取样式表与许可证，写入
`src/zensical.generated.css` 与 `public/vendor/zensical/`，使随包 CSS 永远与解析器版本一致。
`src/zensical.generated.css` 与应用侧适配分开：**生成文件不要手改**，
排版调整写在 `src/markdown-theme.css` 与 `src/reader-theme.ts`。

## 测试

```powershell
# 前端单元测试（vitest）
pnpm test

# 类型检查
pnpm run check

# 编辑器插入模板与实际 Python 渲染器的集成测试
pnpm run test:editor-render

# 渲染器单元测试
& .venv/Scripts/python.exe -m unittest discover -s python -p 'test_*.py'

# Rust 测试（编码、BOM、CRLF、冲突检测、目录树过滤）
cargo test --manifest-path src-tauri/Cargo.toml

# 冻结渲染器端到端（测的是 build/renderer-dist 里的产物）
& .venv/Scripts/python.exe tests/test-bundled-renderer.py

# 浏览器回归（Playwright + Edge）
pnpm run test:browser
```

### 测试夹具

| 文件 | 说明 |
| --- | --- |
| `tests/fixtures/syntax-coverage.md` | **最大语法覆盖**样本。用最小体积同时触发全部内置扩展，`test_renderer.py` 靠它一次断言 15 个扩展标记，是「某个扩展被意外关掉」的主要回归网 |
| `tests/fixtures/rendered.json` | 浏览器回归的比对基准，由渲染器生成 |
| `tests/fixtures/config-cases.json` | 跨语言配置边界用例，**同时**被 TypeScript 与 Python 测试消费 |

## 代码约定

### 共享能力清单

新增或修改扩展选项时，先改 `config/render-capabilities.json`，再让两侧各自读取：

- 字段类型、取值范围、默认值、扩展选项、阅读预设都定义在这里。
- TypeScript 侧由它生成设置面板控件；Python 侧由它生成扩展配置。
- 前端与 Python 都运行 `tests/fixtures/config-cases.json` 的边界用例，
  确保两侧校验行为不漂移。

不要在两处分别硬编码选项定义。

### 渲染配置协议

渲染配置的 `schemaVersion` 当前为 **3**。修改协议时需要：

1. 在 `src/render-config.ts` 与 `python/render_config.py` 两侧同时更新迁移逻辑（兼容 1 / 2）。
2. 更新 `config/render-capabilities.json` 的 `schemaVersion`。
3. 补充 `tests/fixtures/config-cases.json` 的边界用例。

修订号 `revisions.parse` / `revisions.runtime` / `revisions.style` 决定失效范围：
只改阅读样式或公式引擎时应复用解析结果，不要重新解析全文。

### 内部协议

HTML 类名、生成器函数、格式化回调、资源路径属于应用内部协议。
配置校验必须拒绝回调或模块路径，只接受数据参数。

渲染结果可携带 `sourceMap`，其独立 `version` 为 1，坐标为原文的 UTF-16 半开区间。
`exact` 表示可信块范围，`inherited` 表示继承范围，`generated` 不提供源范围。
它是块级映射；普通多行块内部的视觉定位仍是估计。渲染配置的 `schemaVersion` 继续为 3。

`data-zn-node` 仅用于把 HTML 节点绑定到侧表，清理后移除，不参与内容复用签名。
复用节点的映射与新 DOM 一起提交；不能把绝对位置加入签名，也不能继续使用旧范围。
预处理修改不明确或扩展生成的内容必须降级，禁止从渲染文本进行无界反查。

性能测量脚本为 `tests/benchmark-source-map.py`（交替比较原生/映射解析）与
`tests/benchmark-preview-sync.mjs`（需要 1430 端口的 Vite 测试服务器）。两者接受文档路径，
只读取文档；前端测量包括稳定布局下的索引、查询和插入内容后的公式节点复用，不能代替桌面 IPC 整链路测量。

### 前端

- 无框架的 TypeScript，直接操作 DOM。
- 界面文案使用中文。
- 预览相关改动请保持隔离边界：正文在禁止脚本的 iframe 内，
  不向主应用暴露桥接，不给文档 JavaScript 执行入口。

### Rust

- 文件访问必须经过 `authorize()`，不要绕过访问根检查。
- 保存必须走 `atomic_write()` 与 SHA-256 冲突检查。

## 提交范围约定

仓库遵循一条原则：**只提交手写代码、手写文档，以及 `public/vendor/` 下按字节固定的第三方资源。**
可重建的东西、机器相关的东西、本机数据都不提交。

## 提交前检查清单

- [ ] `pnpm run check` 通过
- [ ] `pnpm test` 通过
- [ ] Python 渲染器测试通过
- [ ] `cargo test` 通过
- [ ] 改动涉及渲染逻辑时：已运行 `tests/generate-fixtures.py` 重新生成 `tests/fixtures/rendered.json`
- [ ] 改动涉及 `python/` 时：已重建渲染器，且 `tests/test-bundled-renderer.py` 通过
- [ ] `pnpm run test:browser` 通过
- [ ] 改动涉及 Zensical 版本时：已运行 `pnpm run styles:sync`，且产物无意外差异
- [ ] 新增扩展选项时：已同步更新 `config/render-capabilities.json`
- [ ] 未提交任何构建产物或本机数据（`git status` 应保持干净）
