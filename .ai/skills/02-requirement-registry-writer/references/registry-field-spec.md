# 需求注册表字段规范

本文件定义 `src/requirements/schema.ts` 和各页面 `*.registry.ts` 的字段。除代码字段名外，说明文字优先使用中文。

需求注册表记录的是“完整页面逻辑”，不是“已确认问题列表”。因此，代码里已经清晰实现但没有经过页面逻辑审核 Skill 提问确认的组件、字段、文案、按钮、状态，也要进入注册表，并标记为 `sourceType: 'code'`。

## 总体结构

每个页面或流程生成一个 `RequirementRegistry`：

```ts
export interface RequirementRegistry {
  registryId: string;
  pageName: string;
  route: string;
  module: string;
  description: string;
  sourceDecisionFile: string;
  relatedFiles: string[];
  requirements: RequirementItem[];
  excludedDecisions: ExcludedDecision[];
}
```

## RequirementRegistry 字段

| 字段名 | 中文名称 | 是否必填 | 用途 | 后续使用方 |
| --- | --- | --- | --- | --- |
| `registryId` | 注册表编号 | 是 | 标识当前页面或流程的需求注册表，例如 `ai-chat-panel` | Skill3、Skill4、Skill5 |
| `pageName` | 页面名称 | 是 | 页面、组件或流程的人类可读名称 | Skill3、Skill4、Skill5 |
| `route` | 页面路由/组件标识 | 是 | 页面路由或组件标识；组件可写 `component:AIChatPanel` | Skill3、Skill4、Skill5 |
| `module` | 所属业务模块 | 是 | 用于右侧 PRD 面板和 Markdown PRD 分组 | Skill3、Skill4、Skill5 |
| `description` | 注册表说明 | 是 | 简述本注册表覆盖的页面范围和业务边界 | Skill4、Skill5 |
| `sourceDecisionFile` | 来源决策文件 | 是 | 追溯来自哪个 `.decision.md` | Skill2、Skill5 |
| `relatedFiles` | 相关代码文件 | 是 | 标识与页面逻辑相关的代码文件 | Skill2、Skill3、Skill5 |
| `requirements` | 需求项列表 | 是 | 进入页面角标、右侧 PRD 面板、Markdown PRD 的需求项 | Skill3、Skill4、Skill5 |
| `excludedDecisions` | 未纳入需求卡片的决策 | 是 | 记录本次不改、不属于当前范围、已上线无需处理等边界决策 | Skill5 |

## RequirementItem 字段

```ts
export interface RequirementItem {
  id: string;
  title: string;
  sourceType: RequirementSourceType;
  objectType: RequirementObjectType;
  objectName: string;
  module: string;
  pageName: string;
  route: string;
  anchorId: string;
  anchorStatus: AnchorStatus;
  activate: ActivationStep[];
  display: RequirementDisplay;
  operation: RequirementOperation;
  acceptance: string[];
  source: RequirementSource;
}
```

| 字段名 | 中文名称 | 是否必填 | 用途 | 后续使用方 |
| --- | --- | --- | --- | --- |
| `id` | 需求编号 | 是 | 稳定引用编号，例如 `AI_CHAT_PANEL-001` | Skill3、Skill4、Skill5 |
| `title` | 需求标题 | 是 | 右侧 PRD 列表和 Markdown PRD 标题 | Skill3、Skill4、Skill5 |
| `sourceType` | 来源类型 | 是 | 区分需求来自代码事实、决策记录，或二者合并 | Skill2、Skill3、Skill4、Skill5 |
| `objectType` | 对象类型 | 是 | 标识需求对应对象，如按钮、文案、区域、弹窗、字段、状态 | Skill3、Skill4、Skill5 |
| `objectName` | 对象名称 | 是 | 页面上的具体对象名称，例如“底部文字输入区” | Skill3、Skill4、Skill5 |
| `module` | 所属模块 | 是 | 用于分组展示 | Skill3、Skill4、Skill5 |
| `pageName` | 页面名称 | 是 | 所属页面/组件/流程名称 | Skill3、Skill4、Skill5 |
| `route` | 页面路由/组件标识 | 是 | 页面跳转或组件定位依据 | Skill3、Skill4、Skill5 |
| `anchorId` | 页面锚点编号 | 是 | 对应页面中的 `data-req-anchor`，用于定位和高亮 | Skill3、Skill4 |
| `anchorStatus` | 锚点状态 | 是 | `implemented` 表示页面已存在锚点，`planned` 表示建议锚点待 Skill3 实现 | Skill3、Skill4 |
| `activate` | 激活路径 | 是 | 点击右侧需求时，如何跳转、打开弹窗、切 Tab、定位并高亮 | Skill4 |
| `display` | 显示说明 | 是 | 描述页面展示什么，不写操作逻辑 | Skill3、Skill4、Skill5 |
| `operation` | 操作说明 | 是 | 描述用户操作、权限、数据流转、异常情况，不重复显示说明 | Skill3、Skill4、Skill5 |
| `acceptance` | 验收标准 | 是 | 用于验证需求是否实现 | Skill5，也可供测试使用 |
| `source` | 来源信息 | 是 | 追溯来自哪个决策和代码文件 | Skill2、Skill5 |

## 代码事实提取规则

生成 `requirements` 时，必须先从页面代码提取“代码事实需求项”。不要只读取决策文件。

代码事实需求项包括：

- 页面标题、组件标题、区域标题。
- 欢迎语、说明文案、placeholder、状态提示、错误提示、空状态提示。
- 按钮、图标按钮、快捷入口、关闭入口、确认/取消入口。
- 条件渲染逻辑，例如 `messages.length === 1` 时才展示快捷按钮。
- 禁用逻辑，例如输入框和发送按钮 `disabled`。
- 状态更新逻辑，例如点击快捷按钮后追加用户消息和 AI 消息。
- 回调逻辑，例如 `onActionClick(action)`。
- props 数据展示，例如 `uploadedFile` 展示文件名称和大小。
- 弹窗、面板、Tab、步骤、hover 后展示的操作。

不进入注册表的代码元素：

- 纯布局容器，且没有业务含义。
- 纯装饰图形，且没有业务含义。
- 与页面逻辑无关的样式类。

## 代码事实与决策合并规则

合并时遵循以下规则：

1. 同一对象优先合并  
   如果代码事实和决策记录描述的是同一个对象，例如“底部文字输入区”，生成一条需求，`sourceType` 写 `code+decision`。

2. 只有代码事实也要保留  
   如果某个对象代码逻辑清晰，但 Skill1 没有提问确认，也要生成需求，`sourceType` 写 `code`。

3. 只有决策补充也可进入  
   如果决策记录补充了代码没有体现、但需要进入 PRD 或右侧面板的业务规则，生成需求，`sourceType` 写 `decision`。

4. 范围边界不生成需求卡片  
   如果决策是“已上线，本次不改”“不属于当前页面”“本期不用管”，不要生成 `requirements`，应写入 `excludedDecisions`。

5. 不重复生成  
   不要因为一个对象既出现在代码又出现在决策记录里，就生成两条重复需求。

## 枚举字段

```ts
export type RequirementObjectType =
  | 'field'
  | 'copy'
  | 'button'
  | 'region'
  | 'dialog'
  | 'panel'
  | 'tab'
  | 'step'
  | 'state'
  | 'data';

export type AnchorStatus = 'implemented' | 'planned';

export type RequirementSourceType = 'code' | 'decision' | 'code+decision';
```

中文含义：

- `field`：字段
- `copy`：文案
- `button`：按钮
- `region`：区域
- `dialog`：弹窗
- `panel`：面板
- `tab`：Tab
- `step`：步骤
- `state`：状态
- `data`：数据展示或数据流转对象

来源类型中文含义：

- `code`：来自页面代码事实，逻辑已经清晰实现，无需额外决策。
- `decision`：来自已确认决策，代码里没有体现或需要 PRD 明确补充。
- `code+decision`：代码已有基础逻辑，决策记录补充了边界、异常、范围或说明。

## ActivationStep 字段

```ts
export type ActivationStep =
  | { type: 'navigate'; label: string; to: string }
  | { type: 'openPanel'; label: string; panel: string }
  | { type: 'openDialog'; label: string; dialog: string }
  | { type: 'setStep'; label: string; step: string }
  | { type: 'setTab'; label: string; tab: string }
  | { type: 'scrollTo'; label: string; anchorId: string }
  | { type: 'highlight'; label: string; anchorId: string };
```

| 字段名 | 中文名称 | 用途 | 后续使用方 |
| --- | --- | --- | --- |
| `type` | 激活动作类型 | 标识要执行的动作 | Skill4 |
| `label` | 动作说明 | 给人读的动作解释，也可生成 PRD 路径说明 | Skill4、Skill5 |
| `to` | 目标路由 | `navigate` 使用 | Skill4 |
| `panel` | 面板标识 | `openPanel` 使用 | Skill4 |
| `dialog` | 弹窗标识 | `openDialog` 使用 | Skill4 |
| `step` | 步骤标识 | `setStep` 使用 | Skill4 |
| `tab` | Tab 标识 | `setTab` 使用 | Skill4 |
| `anchorId` | 锚点编号 | `scrollTo` 和 `highlight` 使用 | Skill4 |

## RequirementDisplay 字段

```ts
export interface RequirementDisplay {
  title: string;
  description: string;
  fields?: string[];
  states?: string[];
}
```

| 字段名 | 中文名称 | 是否必填 | 用途 | 后续使用方 |
| --- | --- | --- | --- | --- |
| `title` | 显示说明标题 | 是 | 概括页面展示点 | Skill3、Skill4、Skill5 |
| `description` | 显示说明正文 | 是 | 只描述用户能看见什么 | Skill3、Skill4、Skill5 |
| `fields` | 涉及字段 | 否 | 列出展示相关字段、按钮、文案、区域 | Skill3、Skill4、Skill5 |
| `states` | 涉及状态 | 否 | 列出禁用态、空态、加载态等 | Skill3、Skill4、Skill5 |

## RequirementOperation 字段

```ts
export interface RequirementOperation {
  title: string;
  description: string;
  permission: string;
  dataFlow: string;
  exceptions: string;
}
```

| 字段名 | 中文名称 | 是否必填 | 用途 | 后续使用方 |
| --- | --- | --- | --- | --- |
| `title` | 操作说明标题 | 是 | 概括操作规则 | Skill3、Skill4、Skill5 |
| `description` | 操作说明正文 | 是 | 描述用户如何操作或不能如何操作 | Skill3、Skill4、Skill5 |
| `permission` | 权限说明 | 是 | 描述角色、页面权限、是否沿用父页面权限 | Skill3、Skill4、Skill5 |
| `dataFlow` | 数据流转 | 是 | 描述是否产生数据、写入哪里、如何传递 | Skill3、Skill4、Skill5 |
| `exceptions` | 异常情况 | 是 | 描述异常、禁用、失败、重复操作等处理 | Skill3、Skill4、Skill5 |

### 空兜底说明与渲染规则

注册表允许在 `permission`、`dataFlow`、`exceptions`、`operation.description` 等字段中保留结构化兜底说明，例如：

- 无额外权限限制
- 无额外数据流转
- 无异常场景
- 本对象无操作入口
- 本对象仅展示

这些内容用于证明生成时已经检查过对应层面，不代表需要展示给用户。

右侧 PRD 阅读面板、悬浮业务逻辑面板、Markdown PRD 默认应过滤这些兜底说明，避免增加阅读成本。只有当用户明确要求展示完整字段或原始注册表时，才展示这些内容。

## RequirementSource 字段

```ts
export interface RequirementSource {
  decisionFile: string;
  decisionObject: string;
  relatedFiles: string[];
}
```

| 字段名 | 中文名称 | 是否必填 | 用途 | 后续使用方 |
| --- | --- | --- | --- | --- |
| `decisionFile` | 决策文件 | 是 | 追溯需求来源 | Skill2、Skill5 |
| `decisionObject` | 决策对象 | 是 | 对应 `.decision.md` 中的对象名称 | Skill2、Skill5 |
| `relatedFiles` | 相关代码文件 | 是 | 追溯影响代码 | Skill2、Skill3、Skill4、Skill5 |

## ExcludedDecision 字段

```ts
export interface ExcludedDecision {
  objectName: string;
  reason: string;
  sourceDecision: string;
}
```

| 字段名 | 中文名称 | 是否必填 | 用途 | 后续使用方 |
| --- | --- | --- | --- | --- |
| `objectName` | 对象名称 | 是 | 哪个字段、按钮、区域或逻辑对象未纳入需求卡片 | Skill5 |
| `reason` | 未纳入原因 | 是 | 例如“已上线能力，本次不改”或“不属于当前页面范围” | Skill5 |
| `sourceDecision` | 来源决策 | 是 | 摘录或概括来源决策结论 | Skill5 |

## schema.ts 推荐模板

生成 `src/requirements/schema.ts` 时，必须包含中文注释。可以按以下结构生成：

```ts
// 需求注册表结构定义
// 说明：本文件定义页面需求注册表的数据结构，供页面角标核对、右侧 PRD 阅读面板、页面锚点激活和 Markdown PRD 生成共用。

export type RequirementObjectType =
  | 'field'
  | 'copy'
  | 'button'
  | 'region'
  | 'dialog'
  | 'panel'
  | 'tab'
  | 'step'
  | 'state'
  | 'data';

export type AnchorStatus = 'implemented' | 'planned';

export type RequirementSourceType = 'code' | 'decision' | 'code+decision';

export type ActivationStep =
  | { type: 'navigate'; label: string; to: string }
  | { type: 'openPanel'; label: string; panel: string }
  | { type: 'openDialog'; label: string; dialog: string }
  | { type: 'setStep'; label: string; step: string }
  | { type: 'setTab'; label: string; tab: string }
  | { type: 'scrollTo'; label: string; anchorId: string }
  | { type: 'highlight'; label: string; anchorId: string };

export interface RequirementDisplay {
  /** 中文名称：显示说明标题；用途：概括页面展示点；使用方：Skill3、Skill4、Skill5 */
  title: string;
  /** 中文名称：显示说明正文；用途：只描述用户能看见什么；使用方：Skill3、Skill4、Skill5 */
  description: string;
  /** 中文名称：涉及字段；用途：列出展示相关字段、按钮、文案、区域；使用方：Skill3、Skill4、Skill5 */
  fields?: string[];
  /** 中文名称：涉及状态；用途：列出禁用态、空态、加载态等；使用方：Skill3、Skill4、Skill5 */
  states?: string[];
}

export interface RequirementOperation {
  /** 中文名称：操作说明标题；用途：概括操作规则；使用方：Skill3、Skill4、Skill5 */
  title: string;
  /** 中文名称：操作说明正文；用途：描述用户如何操作或不能如何操作；使用方：Skill3、Skill4、Skill5 */
  description: string;
  /** 中文名称：权限说明；用途：描述角色、页面权限、是否沿用父页面权限；使用方：Skill3、Skill4、Skill5 */
  permission: string;
  /** 中文名称：数据流转；用途：描述是否产生数据、写入哪里、如何传递；使用方：Skill3、Skill4、Skill5 */
  dataFlow: string;
  /** 中文名称：异常情况；用途：描述异常、禁用、失败、重复操作等处理；使用方：Skill3、Skill4、Skill5 */
  exceptions: string;
}

export interface RequirementSource {
  /** 中文名称：决策文件；用途：追溯需求来源；使用方：Skill2、Skill5 */
  decisionFile: string;
  /** 中文名称：决策对象；用途：对应 decision.md 中的对象名称；使用方：Skill2、Skill5 */
  decisionObject: string;
  /** 中文名称：相关代码文件；用途：追溯影响代码；使用方：Skill2、Skill3、Skill4、Skill5 */
  relatedFiles: string[];
}

export interface RequirementItem {
  /** 中文名称：需求编号；用途：稳定引用编号；使用方：Skill3、Skill4、Skill5 */
  id: string;
  /** 中文名称：需求标题；用途：右侧 PRD 列表和 Markdown PRD 标题；使用方：Skill3、Skill4、Skill5 */
  title: string;
  /** 中文名称：来源类型；用途：区分代码事实、决策补充或二者合并；使用方：Skill2、Skill3、Skill4、Skill5 */
  sourceType: RequirementSourceType;
  /** 中文名称：对象类型；用途：标识需求对应对象；使用方：Skill3、Skill4、Skill5 */
  objectType: RequirementObjectType;
  /** 中文名称：对象名称；用途：页面上的具体对象名称；使用方：Skill3、Skill4、Skill5 */
  objectName: string;
  /** 中文名称：所属模块；用途：分组展示；使用方：Skill3、Skill4、Skill5 */
  module: string;
  /** 中文名称：页面名称；用途：所属页面/组件/流程名称；使用方：Skill3、Skill4、Skill5 */
  pageName: string;
  /** 中文名称：页面路由/组件标识；用途：页面跳转或组件定位依据；使用方：Skill3、Skill4、Skill5 */
  route: string;
  /** 中文名称：页面锚点编号；用途：定位和高亮；使用方：Skill3、Skill4 */
  anchorId: string;
  /** 中文名称：锚点状态；用途：标记锚点已实现或待实现；使用方：Skill3、Skill4 */
  anchorStatus: AnchorStatus;
  /** 中文名称：激活路径；用途：点击右侧 PRD 需求后打开正确页面状态；使用方：Skill4 */
  activate: ActivationStep[];
  /** 中文名称：显示说明；用途：描述页面展示什么；使用方：Skill3、Skill4、Skill5 */
  display: RequirementDisplay;
  /** 中文名称：操作说明；用途：描述操作、权限、数据流转、异常情况；使用方：Skill3、Skill4、Skill5 */
  operation: RequirementOperation;
  /** 中文名称：验收标准；用途：验证需求是否实现；使用方：Skill5、测试 */
  acceptance: string[];
  /** 中文名称：来源信息；用途：追溯需求来自哪里；使用方：Skill2、Skill5 */
  source: RequirementSource;
}

export interface ExcludedDecision {
  /** 中文名称：对象名称；用途：说明哪个对象未纳入需求卡片；使用方：Skill5 */
  objectName: string;
  /** 中文名称：未纳入原因；用途：说明范围边界；使用方：Skill5 */
  reason: string;
  /** 中文名称：来源决策；用途：追溯原始决策；使用方：Skill5 */
  sourceDecision: string;
}

export interface RequirementRegistry {
  /** 中文名称：注册表编号；用途：标识当前页面或流程的需求注册表；使用方：Skill3、Skill4、Skill5 */
  registryId: string;
  /** 中文名称：页面名称；用途：人类可读名称；使用方：Skill3、Skill4、Skill5 */
  pageName: string;
  /** 中文名称：页面路由/组件标识；用途：页面跳转或组件定位依据；使用方：Skill3、Skill4、Skill5 */
  route: string;
  /** 中文名称：所属业务模块；用途：分组展示；使用方：Skill3、Skill4、Skill5 */
  module: string;
  /** 中文名称：注册表说明；用途：描述覆盖范围和业务边界；使用方：Skill4、Skill5 */
  description: string;
  /** 中文名称：来源决策文件；用途：追溯来源；使用方：Skill2、Skill5 */
  sourceDecisionFile: string;
  /** 中文名称：相关代码文件；用途：追溯影响代码；使用方：Skill2、Skill3、Skill4、Skill5 */
  relatedFiles: string[];
  /** 中文名称：需求项列表；用途：进入页面角标、右侧面板、Markdown PRD；使用方：Skill3、Skill4、Skill5 */
  requirements: RequirementItem[];
  /** 中文名称：未纳入需求卡片的决策；用途：保留范围边界；使用方：Skill5 */
  excludedDecisions: ExcludedDecision[];
}
```

