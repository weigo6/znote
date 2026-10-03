# 阅读与渲染验证

这是一段没有链接和特殊组件的普通正文。切换「随应用 · 舒适」「书页 · 宋体」「紧凑 · 技术笔记」，可以比较字体、行距与栏宽。切换应用深色主题，对照与阅读区应使用协调的底色。

## Mermaid 图表

```mermaid
graph LR
    A[开始 Start] --> B{发现问题 Error?}
    B -->|是 Yes| C[调试 Debug]
    C --> B
    B -->|否 No| D[完成 Done]
```

## 代码行号

```python title="example.py" linenums="1"
values = []
for index in range(1, 21):
    values.append(index)

def average(items):
    return sum(items) / len(items)

print(values)
print(average(values))
print("行号应与每一行代码对齐")
```

## 代码注释

在「渲染设置 → 内容交互」开启「代码注释」可对所有代码块启用；也可以像下面这样用 `.annotate` 只启用一个代码块。编号写在代码注释中，紧随代码块的有序列表提供说明。`!` 会在阅读视图中隐藏包裹编号的注释文字，Markdown 源码保持不变。

```{ .python .annotate }
answer = 42  # (1)!
print(answer)  #测试 (2)
```

1. 第一条说明支持 **Markdown** 格式。
2. 第二条说明仍保留代码中的普通注释文字。

## 代码复制与逐行选择

「渲染设置 → 内容交互」中的「代码复制按钮」默认开启；「代码逐行选择」默认关闭。每个代码块可用 `.copy` / `.no-copy` 和 `.select` / `.no-select` 单独覆盖。启用逐行选择后，点击选择按钮，再点击一行；按住 Shift 点击可扩展到多行，并在当前窗口地址中记录行范围。

````markdown
```python {.copy .select linenums="1"}
print("第一行")
print("第二行")
```
````

## 脚注与图标

悬浮或键盘聚焦这个脚注编号可以看到说明[^example]。按 Esc 或点击编号后提示应收起。

:material-home: :fontawesome-brands-github: :octicons-mark-github-16: :lucide-book-open: :simple-python:

[^example]: 脚注提示来自正文中的脚注定义。关闭「脚注悬浮提示」只关闭提示交互，脚注链接仍然可用。

## 数学公式

默认配置支持 $E=mc^2$ 和块公式：

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

默认配置可直接排版 $\mathbb{R}$ 与 $\lVert x\rVert$。导入 `math-notes.example.json` 并应用后，还可在公式中使用自定义命令 `\RR` 与参数宏 `\norm{x}`。切换公式引擎时命令配置保留。

## 文档 HTML 与 CSS

<div style="border: 1px solid currentColor; border-radius: 8px; padding: 12px;">这段 HTML 的 style 属性应在阅读区显示。</div>

<style>
.demo-note { padding: 12px; border-left: 3px solid var(--md-primary-fg-color); font-weight: bold; }
</style>

<div class="demo-note">这段样式块只影响隔离的阅读区域。</div>

关闭「显示文档内的 CSS」后，上面两段仍保留内容，文档样式失效。文档脚本不执行。
