# ZNote

**把注意力留给内容本身的 Markdown 笔记工具。**

ZNote 是一款本地优先的 Windows 桌面 Markdown 编辑器与阅览器。你的笔记以最朴素的
`.md` 文件保存在自己的磁盘上，随时可以用任何别的工具打开；ZNote 只负责让你写得舒服、
读得好看。

不登录、不联网、不上传、不绑定格式、不建私有数据库。

## 产品特点

### 写得放心

- **原文永不被动。** 编辑、对照、阅读三个视图共享同一份原文。
- **不会被覆盖。** 保存前会核对磁盘上的文件是否被别的程序改过。如果发现变动，ZNote 会停下来提醒你比较或另存为，而不是默默覆盖掉外部修改。
- **细节原样保留。** UTF-8 BOM、CRLF / LF 换行风格都会照原样写回。
- **意外关掉也不怕。** 未保存的内容留有恢复快照，下次打开可以接着写。
- **可选自动保存。** 已命名的文件可以开启，不需要反复按 `Ctrl + S`。

### 读得舒服

- **阅读主题排版。** 内置多种主题预设，还能自己调字体、行距和最大栏宽。
- **真实渲染管线。** 正文由内置的 Python Markdown + PyMdown Extensions 生成。
- **正文样式。** 兼容 Zensical 的 modern / classic 两套组件样式。
- **扩展语法随手可用。** 提示框、折叠块、内容标签页、脚注（支持悬浮查看）、任务列表、代码行号与文件名、`==高亮==`、`++按键++`、网格卡片、五套 SVG 图标……
- **公式与图表。** KaTeX 或 MathJax 二选一，支持识别语法、排版参数和自定义宏（含带参数的宏）。Mermaid 图表离线渲染，文字用原生 SVG，不会丢字。

### 自定义配置

- **界面语言。** 在「设置 → 外观」中切换简体中文或 English，即时生效并保存；不会修改笔记内容。语言资源与注册表独立管理，新增语言可参考 [语言适配说明](docs/localization.md)。
- **界面主题自由搭配。** 内置自然绿、石墨灰、海蓝、紫雾、暖砂、玫瑰六组风格，每组提供亮色与暗色配色。设置「外观」中可分别绑定两种模式的主题，即时生效并保存；选择「跟随系统」时自动使用对应主题。原有纸白与墨绿配色仍然保留。
- **渲染配置可存取。** 命名保存、导入 / 导出 JSON，还能查看当前实际生效的配置。
- **设置分类清晰。** 左侧选择外观、阅读、写作与保存、公式、语法扩展、高级或配置管理，右侧独立滚动；切换分类时保留草稿与滚动位置，方向键可切换分类。
- **自定义 CSS。** 在所有内置样式之后应用，可以主动覆盖；直接编辑或从 `.css` 文件
  导入都行。
- **快速操作。** `Ctrl + K` 打开，按笔记、写作和界面分类查找；支持中英文关键词搜索，使用方向键选择、Enter 执行，快捷键和不可用原因直接显示。
- **侧边栏文件管理。** 右键文件、文件夹或空白处，打开或在新窗口中打开笔记、在指定目录新建文件与文件夹、重命名、创建副本、删除、查看属性、复制路径或打开文件位置。支持文档树与文档列表切换并保存偏好；`Shift + F10` 打开菜单，`F2` 重命名，`Delete` 删除。删除时确认移入回收站，未保存内容保留为草稿；重命名文件夹同步更新已打开笔记的路径。

## 下载与安装

### 便携版（推荐）

下载并解压 `ZNote-<版本>-windows-x64.zip`，直接运行其中的 `ZNote.exe`。

### 系统要求

- Windows 10 / 11（64 位）
- WebView2 Runtime —— Windows 11 已内置；Windows 10 通常随 Edge 一起提供

## 快速上手

1. **打开 ZNote。** 起始页提供新建笔记、打开笔记、打开文件夹和最近使用记录；不会自动打开示例文件。
2. **`Ctrl + O` 打开一篇 Markdown 文件**，或 `Ctrl + N` 新建一篇。
   按 `Ctrl + S` 保存笔记，首次保存时选择文件名和位置。
3. **切到「对照」视图**，左边写、右边实时看效果。
4. **按 `Ctrl + K`** 打开命令面板，看看都有哪些功能。
5. **进设置调排版**：按 `Ctrl + K` 输入「设置」，或点击工具栏的设置按钮，
   在「阅读」里试试三种预设。

关闭最后一个笔记标签后返回起始页。点击顶部的起始页按钮可随时返回，已打开的笔记与未保存内容仍保留在标签栏中。

## 使用说明

### 快捷键

**全局**

| 操作 | 快捷键 |
| --- | --- |
| 命令面板 | `Ctrl + K` |
| 新建文档 | `Ctrl + N` |
| 打开文件 | `Ctrl + O` |
| 打开文件夹 | `Ctrl + Shift + O` |
| 保存 | `Ctrl + S` |
| 另存为 | `Ctrl + Shift + S` |
| 关闭当前标签页 | `Ctrl + W` |
| 查找 | `Ctrl + F` |
| 替换 | `Ctrl + H` |
| 显示 / 收起左侧导航 | `Ctrl + Shift + L` |
| 专注模式 | `Ctrl + Shift + F` |
| 关闭当前浮层 | `Esc` |

**编辑器内**

| 操作 | 快捷键 |
| --- | --- |
| 粗体 | `Ctrl + B` |
| 斜体 | `Ctrl + I` |
| 插入代码块 | `Ctrl + Shift + K` |
| 插入公式块 | `Ctrl + Shift + M` |
| 插入表格 | `Ctrl + T` |
| 插入图片 | `Ctrl + Shift + I` |
| 切换行注释 | `Ctrl + /` |

### 三个视图

三个视图看的是同一份原文，随时切换，不会丢内容也不会改动文件：

| 视图 | 适合什么时候用 |
| --- | --- |
| **编辑** | 专心写。只有原文编辑器，响应最快 |
| **对照** | 边写边看。左边原文，右边预览（延迟更新，不干扰打字） |
| **阅读** | 专心读。只显示排版结果，适合长文 |

### 设置

设置分为四组：

**阅读** — 排版预设、字体、行距、最大栏宽。设置面板里就能看到普通正文的实际效果。

**公式** — 选择 KaTeX / MathJax / 关闭；设置识别语法、排版选项和自定义宏。
排版失败时可以选择保留原文或显示错误。

**语法扩展** — 内置扩展逐项启停，并可展开配置细节。关掉某个扩展不会丢失它的配置，
重新打开即恢复。

**高级** — 组件样式（Modern / Classic）、主色、强调色、自定义 CSS，
以及渲染配置的命名保存与导入 / 导出。

> 所有设置都保存在本机，不会写入你的笔记目录，也不会同步到任何地方。

## 示例素材

仓库的 `docs/` 目录里有几个可以直接拿来用的文件：

| 文件 | 用途 |
| --- | --- |
| [`docs/rendering-demo.md`](docs/rendering-demo.md) | 渲染能力总览。用阅读视图打开，一次性看到所有语法效果 |
| [`docs/theme-override.example.css`](docs/theme-override.example.css) | 自定义 CSS 起点。在「高级」里导入后按需修改配色 |
| [`docs/math-notes.example.json`](docs/math-notes.example.json) | 公式配置示例。演示自定义宏和带参数的宏 |

## 第三方组件与许可

ZNote 以 MIT 许可证发布。便携包里带有完整的第三方许可证文本，位于 `licenses/` 目录。

| 组件 | 许可 | 用途 |
| --- | --- | --- |
| [Zensical](https://zensical.org/) | MIT | 正文样式、图标资源、Markdown 扩展基线 |
| Python Markdown | BSD-3-Clause | Markdown 解析 |
| PyMdown Extensions | MIT | 扩展语法 |
| Pygments | BSD-2-Clause | 代码高亮 |
| PyYAML | MIT | YAML 解析 |
| Python | PSF | 渲染器运行时 |
| PyInstaller | GPL-2.0-or-later with bootloader exception | 打包内置渲染器 |
| KaTeX | MIT | 公式排版 |
| MathJax | Apache-2.0 | 公式排版 |
| Mermaid | MIT | 图表渲染 |
| DOMPurify | Apache-2.0 / MPL-2.0 | HTML 清理 |
| Lucide | ISC | 图标 |
| Tauri | MIT / Apache-2.0 | 桌面框架 |
| CodeMirror 6 | MIT | 编辑器 |
| Inter / JetBrains Mono / Roboto / Roboto Mono | OFL-1.1 | 界面字体 |

内置的 Zensical 图标资源来自 FontAwesome、Lucide、Material Design、Octicons
与 Simple Icons，许可证文本见 [`public/vendor/icon-licenses/`](public/vendor/icon-licenses/)。
内置的官方 CSS 附有来源记录与逐文件校验值，见
[`public/vendor/zensical/manifest.json`](public/vendor/zensical/manifest.json)。

## 许可证

[MIT](LICENSE) © 2026 Luwei

版本变化见 [CHANGELOG.md](CHANGELOG.md)。
想从源码构建或参与开发，见 [CONTRIBUTING.md](CONTRIBUTING.md)。
