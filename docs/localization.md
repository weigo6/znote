# 界面语言

用户在「设置 → 外观 → 界面语言」中选择语言。配置写入 `znote:preferences.language`，立即生效，不重新载入应用，也不修改笔记原文、文件名、撤销历史或设置草稿。现有配置默认使用简体中文；无法识别的语言回退到简体中文。

## 添加一种语言

1. 在 `src/locales/` 创建资源模块，例如 `de.ts`，导出消息字典。
2. 在 `src/i18n.ts` 导入模块，并在 `languagePacks` 注册语言标识、原生语言名、方向（`ltr` 或 `rtl`）与 `messages`。语言选项自动从该注册表生成。
3. 运行 `npm test`、`npm run build` 及 `npx playwright test tests/language.spec.ts`，检查文案与布局。

消息标识采用 gettext 风格的中文源文案。不要为了翻译而修改消息标识。完整资源可以使用 `satisfies Messages`（类型来自 `src/locales/zh-CN.ts`）校验；新增语言也可以提供部分翻译，缺失条目自动使用中文默认文案。英文资源要求完整，单元测试会检查条目和占位符一致性。

```ts
import type { Messages } from "./zh-CN";

const messages = {
  "设置": "Einstellungen",
  "已保存：{0}": "Gespeichert: {0}",
} satisfies Partial<Messages>;
export default messages;
```

`tr(message, values)` 在调用时读取当前语言。动态文本使用 `{0}`、`{1}` 等占位符；参数一次性替换，参数自身包含占位符时不会再次展开。保留所有占位符，可以按目标语言重新排序。无需翻译的技术标识、快捷键与资源 ID 保持原样。

## 更新已有界面

静态界面与语言资源分离。常驻界面的文案通过 `localizeUi` 就地更新，设置控件、草稿值与焦点无需重新挂载；动态菜单在创建时读取当前语言。文件列表、标签页文件名、笔记原文、正文预览、用户配置名称与 JSON/CSS 输入区域不会交给界面翻译函数。

CodeMirror 使用独立的语言 Compartment 更新查找文案、占位提示和辅助标签，保留文档、选择与编辑历史。正文预览仅更新应用生成的按钮文案与语言属性。设置中的排版示例单独更新语言，用户笔记不参与翻译。

原生文件窗口的自定义标题与筛选标签由前端传入翻译结果，后端在参数缺失时保留中文默认值。操作系统自带的按钮随 Windows 的显示语言。新增语言不需要在原生端添加分支。
