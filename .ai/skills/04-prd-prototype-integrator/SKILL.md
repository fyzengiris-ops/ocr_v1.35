---
name: prd-prototype-integrator
description: 当需要在已经生成需求注册表，并且页面角标/锚点已完成或已确认后，实现右侧 PRD 阅读面板与原型页面联动时使用；用于创建可开关可拖拽的右侧 PRD 面板、点击 PRD 卡片定位页面锚点、高亮组件、执行 activate 路径，并与已有角标/悬浮面板同步选中状态。不负责分批添加初始页面角标，也不生成 Markdown PRD。
---

# 右侧 PRD 面板联动 Skill

## 目标

基于 `src/requirements` 中的需求注册表和页面上已经存在的需求锚点，把右侧 PRD 阅读面板与原型页面打通。

最终效果：

- 默认不打开右侧 PRD 面板，原型页面正常占满浏览器。
- 点击小 icon 可以打开右侧 PRD 阅读面板。
- 右侧 PRD 面板打开时，原型页面和 PRD 面板同层显示，原型区域被压缩。
- 右侧 PRD 面板左边缘可拖拽，用户可以自由调整面板宽度。
- 点击右侧需求卡片时，执行需求注册表中的 `activate` 路径，自动打开对应页面状态、定位锚点、高亮页面对象。
- 如果页面已由 `requirement-marker-reviewer` 添加编号角标和悬浮面板，右侧面板应尽量同步当前选中需求。
- 业务逻辑展示必须按“显示说明 / 操作说明”两个维度呈现。

## 必须读取的文件

执行前必须读取：

```txt
src/requirements/index.ts
src/requirements/schema.ts
.ai/skills/shared/logic-writing-spec.md
.ai/skills/04-prd-prototype-integrator/references/layout-and-activation.md
```

如果用户指定某个页面或组件，还要读取对应的：

```txt
src/requirements/<页面或流程>.registry.ts
```

如果 `src/requirements` 不存在，停止执行，并提示用户先运行 `requirement-registry-writer`。

如果目标页面还没有稳定 `data-req-anchor`，也没有完成页面编号角标核对，默认停止执行，并提示用户先运行 `requirement-marker-reviewer`。只有用户明确要求“本次直接补锚点并接入右侧面板”时，才可以在本 Skill 中补最小必要锚点。

## 执行边界

本 Skill 只负责“右侧 PRD 阅读面板与原型联动”：

- 可以新增或更新 `RequirementReaderShell`、`RequirementPanel`、`RequirementHighlight`、`requirement-utils`。
- 可以包装目标页面，让原型区域和右侧 PRD 面板同层布局。
- 可以实现面板开关、拖拽宽度、PRD 卡片列表、详情区、定位锚点、高亮组件和 `activate` 执行。
- 可以复用已有 `RequirementMarker`、`RequirementFloatingCard` 的选中状态。
- 不负责把每个组件、按钮、字段逐一加初始角标。
- 不生成 `docs/prd/*.prd.md`。

在 DeepSeek 或其他工具并行修改项目时，执行前必须先向用户列出预计会修改的文件。除非用户明确允许，不要改本次页面以外的业务页面、全局布局、全局样式或 shadcn/ui 基础组件。

## 设计原则

### 1. PRD 面板按需显示

右侧 PRD 面板默认关闭，不影响原型页面正常使用。

页面上应提供一个小 icon 作为 PRD 阅读入口。用户点击后打开右侧面板，再次点击或点击关闭按钮后收起。

### 2. 面板不覆盖原型，而是挤压原型

打开右侧 PRD 面板时，不要用 fixed 面板直接覆盖原型主体区域。

应使用同层级布局：

```txt
┌──────────────────────────────┬──────────────┐
│ 原型页面区域                  │ PRD 阅读面板 │
│ 宽度随面板拖拽变化            │ 可拖拽宽度   │
└──────────────────────────────┴──────────────┘
```

默认可使用：

- 原型区域：约 75%
- PRD 面板：约 25%

但实际宽度必须支持拖拽调整。建议限制最小宽度和最大宽度，避免原型或 PRD 面板不可用。

### 3. 页面角标独立于右侧面板

页面编号角标和悬浮业务逻辑面板属于 `requirement-marker-reviewer` 的职责。右侧 PRD 面板关闭时，已有角标仍应独立可用。

本 Skill 只需要在可行时同步选中状态，不要让角标依赖右侧面板打开。

### 4. AI 小乐等右侧浮层要在原型区域内定位

如果原型页面本身有右侧浮层或侧边面板，例如 AI 小乐侧边面板，打开 PRD 面板后，这些浮层不能继续贴浏览器最右侧，否则会和 PRD 面板冲突。

应让它们定位在“原型页面区域”的右侧，而不是整个浏览器右侧。

## 推荐实现结构

优先新增通用组件，不要把所有逻辑写死在某个页面里。

建议文件：

```txt
src/components/prd/RequirementReaderShell.tsx
src/components/prd/RequirementPanel.tsx
src/components/prd/RequirementHighlight.tsx
src/components/prd/requirement-utils.ts
```

职责划分：

- `RequirementReaderShell`：负责 PRD 阅读模式总布局、面板开关、拖拽宽度、选中需求状态。
- `RequirementPanel`：负责右侧需求列表、需求详情、显示说明/操作说明分组。
- `RequirementHighlight`：负责页面锚点高亮样式或高亮 class 管理。
- `requirement-utils.ts`：负责按 id 查找需求、过滤空兜底说明、执行 activate 辅助逻辑。

如果 `RequirementMarker`、`RequirementFloatingCard` 已由 `requirement-marker-reviewer` 创建，应复用，不要重复实现第二套角标或悬浮面板。

## 注册表使用规则

从 `src/requirements/index.ts` 读取 `requirementRegistries`。

渲染需求时使用：

- `registry.pageName`
- `registry.module`
- `registry.requirements`
- `requirement.id`
- `requirement.title`
- `requirement.anchorId`
- `requirement.display`
- `requirement.operation`
- `requirement.activate`
- `requirement.sourceType`

不要把 `excludedDecisions` 渲染成普通需求卡片。它只用于后续范围边界说明，除非用户明确要求展示。

## 显示说明 / 操作说明渲染规则

必须遵循：

```txt
.ai/skills/shared/logic-writing-spec.md
```

右侧 PRD 面板必须按下面结构展示：

```txt
显示说明
<display.title>
<display.description>
<fields/states 中有信息量的内容>

操作说明
<operation.title>
<operation.description>
<permission/dataFlow/exceptions 中有信息量的内容>
```

不要把“显示说明”和“操作说明”合并成一段。

### 空兜底说明过滤

用户侧默认不展示下列内容：

- 无额外权限限制
- 无额外数据流转
- 无异常场景
- 本对象无操作入口
- 本对象仅展示
- 空字符串
- 空数组

只有用户要求展示完整字段或原始注册表时，才展示这些内容。

## 激活路径执行规则

点击右侧 PRD 面板中的需求卡片时，执行该需求的 `activate` 数组。

需要支持的动作：

- `navigate`：跳转到页面。
- `openPanel`：打开页面侧边面板，例如 AI 小乐。
- `openDialog`：打开弹窗。
- `setStep`：切换步骤。
- `setTab`：切换 Tab。
- `scrollTo`：滚动到 `data-req-anchor`。
- `highlight`：高亮 `data-req-anchor`。

实现方式要优先使用显式状态控制，不要依赖模拟鼠标点击。

例如：

- 打开 AI 小乐面板时，应调用或暴露 `setShowAIPanel(true)` 这类状态控制。
- 打开弹窗时，应调用对应 `setShowDialog(true)`。
- 切 Tab 时，应设置对应 Tab 状态。

如果当前页面还没有这些控制入口，应先加清晰的控制器或 context，不要用脆弱的 DOM 文本查找。

## 右侧 PRD 阅读面板

右侧面板应包含：

- 面板标题，例如“PRD 需求说明”
- 页面/模块信息
- 需求卡片列表
- 当前选中需求详情
- 关闭按钮
- 拖拽调整宽度的左侧边缘

需求卡片应展示：

- 需求编号
- 需求标题
- 来源类型：`code`、`decision`、`code+decision` 可用小标签显示
- 简短摘要

点击需求卡片后：

1. 设置当前选中需求。
2. 执行 `activate`。
3. 高亮对应页面对象。
4. 滚动或定位到锚点。
5. 如果页面已有悬浮业务逻辑面板，同步其当前需求；否则在右侧详情区展示完整内容。

## 样式要求

- 使用项目现有 Next.js、React、TypeScript、Tailwind CSS 风格。
- 优先使用 shadcn/ui 和现有 `src/components/ui/` 组件。
- 图标优先使用 `lucide-react`。
- 不要做营销式 UI，不要使用大面积渐变背景。
- 面板样式要偏工具型、信息阅读型，紧凑清晰。
- 确保按钮、标记、面板文本在窄屏和拖拽宽度变化时不溢出。

## 验证要求

实现后必须运行：

```txt
pnpm ts-check
```

如果改动涉及 lint 规则，也运行：

```txt
pnpm lint
```

如果实现了可视交互，尽量启动开发服务并手动或自动检查：

- 默认 PRD 面板关闭。
- 点击 icon 后 PRD 面板打开。
- 拖拽面板宽度有效。
- 原型区域随面板宽度变化被压缩。
- 点击右侧需求卡片能执行 `activate`、定位锚点、高亮对象。
- 页面已有需求编号和悬浮业务逻辑仍可独立使用。
- 空兜底说明不会显示给用户。

## 输出给用户的完成摘要

实现完成后，按下面格式简要回复：

```md
一、实现结果
- 新增/更新文件：...

二、已支持能力
- 右侧 PRD 面板开关
- 拖拽调整宽度
- 点击 PRD 需求定位和高亮
- activate 路径执行
- 与页面角标/悬浮面板同步：支持/不支持/部分支持

三、验证结果
- pnpm ts-check：通过/失败
- 其他验证：...

四、后续建议
- ...
```
