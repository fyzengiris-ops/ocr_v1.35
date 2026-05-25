---
name: requirement-marker-reviewer
description: 当需要在 src/requirements 需求注册表基础上，为已经调整好的前端页面或页面局部添加需求编号角标、稳定 data-req-anchor、点击悬浮业务逻辑面板时使用；用于让用户在具体组件、按钮、字段、文案旁边分批核对业务逻辑。不创建右侧 PRD 阅读面板、不实现拖拽分栏、不执行 PRD 卡片定位/activate 联动，也不生成 Markdown PRD。
---

# 页面逻辑角标核对 Skill

## 目标

基于 `src/requirements` 中的需求注册表，把页面里需要核对业务逻辑的组件、按钮、字段、文案和状态入口标出来。

最终效果：

- 页面对象附近展示需求编号角标。
- 点击编号角标后，以悬浮业务逻辑面板阅读对应需求。
- 悬浮面板按“显示说明 / 操作说明”展示。
- 可以按页面、模块、组件或一组需求分批完成，方便用户边看边审。
- 不接入右侧 PRD 阅读面板，不做全局高亮联动，不生成 Markdown PRD。

## 必须读取的文件

执行前必须读取：

```txt
src/requirements/index.ts
src/requirements/schema.ts
.ai/skills/shared/logic-writing-spec.md
```

如果用户指定某个页面、组件或流程，还要读取对应的：

```txt
src/requirements/<页面或流程>.registry.ts
```

如果 `src/requirements` 不存在，停止执行，并提示用户先运行 `requirement-registry-writer`。

## 执行边界

本 Skill 只负责“页面内核对入口”：

- 可以新增或复用 `RequirementMarker`、`RequirementAnchor`、`RequirementFloatingCard`、`requirement-utils`。
- 可以在本次指定页面或组件中添加 `data-req-anchor` 和需求编号角标。
- 可以调整很小范围的局部包裹结构，但不能破坏页面视觉和交互。
- 不创建 `RequirementReaderShell`。
- 不创建右侧 `RequirementPanel`。
- 不实现拖拽分栏。
- 不执行 `activate` 路径。
- 不生成 `docs/prd/*.prd.md`。

在 DeepSeek 或其他工具并行修改项目时，执行前必须先向用户列出预计会修改的文件。除非用户明确允许，不要改本次页面以外的业务页面、全局布局、全局样式或 shadcn/ui 基础组件。

## 推荐实现结构

优先新增通用组件，不要把悬浮逻辑写死在某个页面里。

建议文件：

```txt
src/components/prd/RequirementMarker.tsx
src/components/prd/RequirementAnchor.tsx
src/components/prd/RequirementFloatingCard.tsx
src/components/prd/requirement-utils.ts
```

职责划分：

- `RequirementMarker`：显示需求编号角标，负责点击、选中态和基础定位。
- `RequirementAnchor`：可选包装器，为页面对象绑定 `data-req-anchor` 和角标。
- `RequirementFloatingCard`：展示悬浮业务逻辑说明。
- `requirement-utils.ts`：按 id 查找需求、按 anchor 查找需求、过滤空兜底说明。

如果页面结构不适合包装，优先手动放置 `RequirementMarker`，避免改变原型布局。

## 页面锚点规则

每个需要核对的页面对象都应有稳定锚点：

```tsx
data-req-anchor="<anchorId>"
```

锚点必须来自注册表中的 `requirement.anchorId`，不能基于数组下标、随机数或运行时动态值生成。

如果对应对象不方便直接加属性，可以在外层包一层 `span` 或 `div`，但要保持原布局、间距、点击区域和无障碍语义。

## 需求编号角标规则

角标建议显示短编号，例如：

- `001`
- `002`
- `AI_CHAT_PANEL-005`

角标必须：

- 靠近对应组件、按钮、字段或文案。
- 不遮挡用户主要阅读和点击区域。
- 可点击。
- 支持选中态。
- hover 或悬浮面板中展示完整编号和标题。

如果一个页面区域对应多条需求，可以放一个聚合入口，但悬浮面板中必须能区分每条需求。

## 悬浮业务逻辑面板

点击页面需求编号角标时，显示悬浮面板。

悬浮面板应包含：

- 需求编号
- 需求标题
- 显示说明
- 操作说明

悬浮面板不应包含：

- 空兜底说明
- 大段来源文件路径
- `excludedDecisions`
- 右侧 PRD 面板入口或拖拽控制

业务逻辑展示必须遵循：

```txt
.ai/skills/shared/logic-writing-spec.md
```

用户侧默认不展示下列空兜底内容：

- 无额外权限限制
- 无额外数据流转
- 无异常场景
- 本对象无操作入口
- 本对象仅展示
- 空字符串
- 空数组

## 分批核对规则

如果一个页面需求较多，优先按下面粒度分批：

1. 页面主流程区域。
2. 关键按钮和操作入口。
3. 表单字段、筛选项、上传入口。
4. 弹窗、面板、空状态、异常状态。

每完成一批，回复中必须说明：

- 本批已加角标的需求编号。
- 本批涉及的页面对象。
- 暂未处理的需求编号或页面区域。
- 是否改动了公共组件。

## 验证要求

实现后必须运行：

```txt
pnpm ts-check
```

如果改动涉及 lint 规则，也运行：

```txt
pnpm lint
```

如果实现了可视交互，尽量启动开发服务并检查：

- 页面正常显示。
- 编号角标不遮挡主要内容。
- 点击角标能打开悬浮业务逻辑面板。
- 切换角标时悬浮内容同步变化。
- 空兜底说明不会显示给用户。

## 输出给用户的完成摘要

实现完成后，按下面格式简要回复：

```md
一、实现结果
- 新增/更新文件：...

二、本批已支持核对
- 已加角标需求：...
- 对应页面对象：...

三、未处理范围
- ...

四、验证结果
- pnpm ts-check：通过/失败
- 其他验证：...
```
