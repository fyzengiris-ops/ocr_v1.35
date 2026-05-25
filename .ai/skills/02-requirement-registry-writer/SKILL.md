---
name: requirement-registry-writer
description: 当需要把页面代码事实和 docs/prd-workflow/decisions 下的已确认页面决策合并成完整结构化需求注册表时使用；用于生成或更新 src/requirements/schema.ts、页面 registry.ts 和统一导出 index.ts，让后续页面逻辑角标、悬浮业务逻辑面板、右侧 PRD 阅读面板、页面锚点激活、高亮定位、Markdown PRD 生成都读取同一份完整页面逻辑源数据。
---

# 需求注册表生成 Skill

## 目标

把“页面代码中已经体现的业务逻辑”和“页面逻辑审核 Skill 产出的已确认决策记录”合并成完整的结构化需求注册表。

需求注册表不是“只记录被用户确认过的问题”。它是当前页面或组件的完整业务逻辑源数据。后续页面逻辑角标、悬浮业务逻辑说明、右侧 PRD 阅读面板、页面锚点激活、Markdown PRD 生成都必须读取它。

本 Skill 不负责重新向用户审核问题，也不负责实现右侧面板。它负责从代码和决策文件中提取、合并、编号、结构化。

## 输入来源

本 Skill 有两个输入来源：

1. 页面代码事实  
   从页面、组件、弹窗、状态变量、props、事件处理函数、条件渲染、禁用逻辑、文案和数据流中提取已经明确实现的业务逻辑。

2. 已确认决策记录  
   默认读取：

```txt
docs/prd-workflow/decisions/*.decision.md
```

如果用户没有指定具体决策文件：

1. 如果 `docs/prd-workflow/decisions/` 下只有一个 `.decision.md` 文件，直接使用该文件。
2. 如果有多个 `.decision.md` 文件，先列出文件名并询问用户要转换哪一个。
3. 如果没有决策文件，也可以继续只基于页面代码事实生成注册表，但必须在回复中说明“本次无决策补充，仅基于代码事实生成”。

## 输出文件

运行完成后，生成或更新：

```txt
src/requirements/schema.ts
src/requirements/<页面或流程>.registry.ts
src/requirements/index.ts
```

输出文件含义：

- `schema.ts`：需求注册表字段结构定义。字段注释必须使用中文，说明中文名称、用途、后续使用方。
- `<页面或流程>.registry.ts`：当前页面或流程的完整结构化需求注册表。
- `index.ts`：统一导出所有需求注册表，供后续功能统一读取。

## 必须读取的字段规范

生成或更新注册表前，必须读取：

```txt
.ai/skills/02-requirement-registry-writer/references/registry-field-spec.md
.ai/skills/shared/logic-writing-spec.md
```

字段规范定义所有字段的中文名称、含义、用途、后续 Skill3/Skill4/Skill5 使用方式。

业务逻辑写作规范定义 `display` 和 `operation` 的分层写法，以及用户侧 PRD 渲染时如何过滤空兜底说明。

## 必须避免的错误

不要只把 `.decision.md` 里的内容转成需求注册表。这样会漏掉代码里已经清晰实现、但没有经过 Skill1 提问确认的组件、字段、按钮和状态。

正确结果应该是：

```txt
页面代码事实 + 已确认决策记录 -> 完整页面逻辑注册表
```

例如：

- 组件 A 的代码逻辑已经实现，Skill1 又补充确认了异常处理：生成一条 `sourceType: 'code+decision'` 的需求。
- 组件 B 的代码逻辑已经清晰，不需要 Skill1 确认：也必须生成一条 `sourceType: 'code'` 的需求。
- 某条决策说明“本次不改”或“不属于本页面”：不生成需求卡片，放入 `excludedDecisions`。

## 执行流程

1. 确认页面或流程范围。优先从用户指定、决策文件“页面范围”、相关代码文件中确定。
2. 读取 `package.json`，理解项目类型。
3. 读取字段规范文件 `registry-field-spec.md`。
4. 读取目标页面/组件代码及其直接相关组件。
5. 提取代码事实需求项，覆盖有业务含义的字段、文案、按钮、区域、状态、弹窗、Tab、步骤、数据展示和数据流转。
6. 读取目标 `.decision.md` 文件；如果没有决策文件，则跳过决策合并，但说明原因。
7. 将决策记录和代码事实合并：
   - 如果决策补充的是同一个对象，把它合并进同一条需求，并设置 `sourceType: 'code+decision'`。
   - 如果决策描述的是代码未体现但本页面需要进入 PRD 的逻辑，生成 `sourceType: 'decision'` 的需求。
   - 如果决策是范围边界、本次不改、已上线不处理、不属于当前页面，放入 `excludedDecisions`。
8. 为所有进入 `requirements` 的需求生成稳定编号、锚点、激活路径、显示说明、操作说明、验收标准和来源信息。
9. 如果 `src/requirements/schema.ts` 不存在，按字段规范创建。
10. 如果 `src/requirements/schema.ts` 已存在，优先复用现有字段；除非字段无法支持完整页面逻辑，否则不要破坏已有结构。
11. 创建或更新当前页面的 `<页面或流程>.registry.ts`。
12. 创建或更新 `src/requirements/index.ts`，统一导出所有 registry。
13. 输出“生成结果摘要”，不要把完整文件内容大段贴给用户。

## 代码事实提取规则

从代码中提取需求项时，至少检查：

- 可见文案：标题、欢迎语、提示语、placeholder、状态文案、按钮文案。
- 操作入口：按钮、快捷入口、关闭入口、上传入口、保存入口、确认/取消入口。
- 条件展示：什么情况下显示、隐藏、置灰、禁用。
- 状态变化：点击后如何改变状态、追加消息、打开弹窗、跳转页面、切换步骤。
- 数据来源：props、mock 数据、本地 state、sessionStorage、API 响应。
- 数据去向：回调、状态更新、缓存、页面跳转、传给子组件。
- 异常或禁用：不可点击、开发中、无数据、加载中、接口失败、输入缺失。
- 隐藏交互：弹窗、侧边面板、Tab、hover 后展示、条件渲染。

只有纯装饰且没有业务含义的元素可以不进注册表。

## 来源类型 sourceType

每条需求必须标记来源类型：

- `code`：来自页面代码事实，逻辑已经清晰实现，无需额外决策。
- `decision`：来自已确认决策，代码里没有体现或需要 PRD 明确补充。
- `code+decision`：代码已有基础逻辑，决策记录补充了边界、异常、范围或说明。

后续 Skill3、Skill4 和 Skill5 必须能看到这个字段，用于区分“代码事实”和“决策补充”。

## 哪些内容进入 requirements

进入 `requirements` 的内容必须满足至少一个条件：

- 页面上有业务含义的可见对象。
- 用户可以执行或不能执行的操作。
- 条件显示、禁用、隐藏、状态变化。
- 数据展示、数据传入、数据输出、页面跳转或回调。
- 需要在右侧 PRD 面板中展示。
- 需要点击需求后定位到页面组件、字段、按钮、弹窗或状态。
- 需要进入 Markdown PRD 正文。

注意：即使某个组件没有经过 Skill1 决策确认，只要代码里已经有明确业务逻辑，也要进入 `requirements`，并标记为 `sourceType: 'code'`。

## 哪些内容进入 excludedDecisions

不要把下面内容作为 `requirements` 需求卡片生成：

- 明确说明“本次不改”“本期不用管”“已上线功能，不属于本次范围”的决策。
- 明确说明“不属于当前页面/当前组件”的决策。
- 只是范围边界说明，而不是当前页面业务逻辑本身。
- 只是解释为什么某能力不纳入本次迭代。

这些内容放入 registry 的 `excludedDecisions`，作为范围边界保留，供后续右侧 PRD 面板或 Markdown PRD 生成时决定是否写入“范围边界”。

## 需求编号规则

使用稳定、可读、可追溯的编号：

```txt
<页面或模块大写英文前缀>-001
<页面或模块大写英文前缀>-002
```

示例：

```txt
AI_CHAT_PANEL-001
AI_CHAT_PANEL-002
HOMEWORK_UPLOAD-001
```

规则：

- 同一个 registry 内编号从 `001` 开始递增。
- 已存在编号不要重排，避免后续页面标注和 PRD 引用失效。
- 新增需求追加编号。
- 删除需求时不要复用旧编号。

## 锚点规则

每条进入 `requirements` 的需求都应有 `anchorId`。

命名建议：

```txt
<页面或组件>.<区域或对象>.<具体字段或动作>
```

示例：

```txt
ai-chat-panel.input.disabled
ai-chat-panel.quick-actions.group
homework.import-dialog.subject
upload-question-dialog.answer-link-picker
```

如果当前页面还没有真实 `data-req-anchor`，也要先生成建议锚点，并在 `anchorStatus` 标记为 `planned`。后续 Skill3 会根据这些锚点去改页面。

## 激活路径规则

`activate` 用于 Skill4 点击右侧需求时打开正确页面状态。

常见动作：

- `navigate`：跳转到页面路由。
- `openPanel`：打开侧边面板。
- `openDialog`：打开弹窗。
- `setStep`：切换步骤。
- `setTab`：切换 Tab。
- `scrollTo`：滚动到锚点。
- `highlight`：高亮锚点。

如果当前需求只在组件内部展示，不需要额外状态激活，至少保留 `scrollTo` 和 `highlight`。

## display 和 operation 的拆分规则

`display` 是显示说明，只写“页面上看见什么”。

`operation` 是操作说明，只写“用户怎么操作、系统怎么处理、权限、数据流转、异常情况”。

两者不能重复：

- 不要在 `display.description` 里写点击后发生什么。
- 不要在 `operation.description` 里重复描述页面长什么样。
- 如果一个需求只有显示，没有操作，`operation.description` 也要说明“用户不可操作”或“无操作入口”。
- 如果一个需求只有操作，没有显性页面元素，也要在 `display.description` 说明页面是否有可见提示或无可见变化。

生成 `display` 和 `operation` 时，必须按 `.ai/skills/shared/logic-writing-spec.md` 的分层框架检查，避免漏掉状态、条件、数据流、权限、异常和操作后状态。

注册表中允许保留结构化兜底说明，例如“无额外权限限制”“无额外数据流转”“无异常场景”“本对象无操作入口”“本对象仅展示”。这些内容用于机器判断字段完整性。

后续右侧 PRD 阅读面板、悬浮业务逻辑面板、Markdown PRD 默认不展示这些空兜底说明，除非用户要求展示原始注册表。

## 运行后给用户的摘要格式

完成文件写入后，按下面格式回复：

```md
一、生成结果
- 已生成/更新 schema：src/requirements/schema.ts
- 已生成/更新注册表：src/requirements/<页面或流程>.registry.ts
- 已生成/更新统一出口：src/requirements/index.ts

二、进入注册表的需求
1. <需求编号>：<需求标题>（来源：code/code+decision/decision）
2. <需求编号>：<需求标题>（来源：code/code+decision/decision）

三、未纳入需求卡片的决策
- <对象>：<原因>

四、需要后续处理
- <例如：需要 Skill3 为 anchorId 增加 data-req-anchor>
```

如果没有生成任何进入注册表的需求，要明确说明原因，并询问用户是否要补充页面范围或代码入口。

## 输出约束

- 除文件路径、代码字段、类型名、导出名等必要内容外，尽量使用中文。
- 不要把未确认的审核建议写入 registry。
- 不要把“本次不改”的内容伪装成需求卡片。
- 不要遗漏代码中已经清晰实现、但没有经过 Skill1 确认的页面逻辑。
- 不要为了凑字段而编造权限、数据流转或异常；如果决策记录没有说明，需要从代码事实推断，并标注为“沿用页面权限”或“无额外数据流转”。
- 生成的 TypeScript 文件必须可以被项目正常导入。
- 不要在 React 渲染逻辑中引入 `Date.now()`、`Math.random()` 等动态值。注册表里的更新时间如果需要填写，使用明确日期字符串。
