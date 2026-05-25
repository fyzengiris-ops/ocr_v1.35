# 右侧 PRD 面板布局与激活实现参考

## 与页面角标 Skill 的关系

`requirement-marker-reviewer` 负责把页面组件、按钮、字段和文案旁边的需求编号角标、`data-req-anchor`、悬浮业务逻辑面板先做出来。

本参考文件只服务于右侧 PRD 面板联动：

- 复用已经存在的 `data-req-anchor`。
- 复用已经存在的需求选中状态或暴露一个共享选中控制。
- 不重复创建第二套页面编号角标。
- 不把 Markdown PRD 生成混入前端联动实现。

如果目标页面缺少锚点，默认先回到 `requirement-marker-reviewer` 补齐。只有用户明确要求时，才在本阶段补最小必要锚点。

## 总体布局

推荐用一个阅读 Shell 包住原型页面：

```tsx
<RequirementReaderShell registries={requirementRegistries}>
  <PrototypePage />
</RequirementReaderShell>
```

Shell 内部负责：

- PRD 面板开关状态。
- PRD 面板宽度状态。
- 当前选中需求。
- 当前高亮锚点。
- 页面锚点查找与滚动。
- 和已有页面角标/悬浮面板同步选中需求。

打开面板时：

```txt
display: grid
grid-template-columns: minmax(0, 1fr) <panelWidth>px
```

关闭面板时：

```txt
grid-template-columns: minmax(0, 1fr)
```

## 拖拽宽度

PRD 面板宽度建议：

- 默认：360px 或浏览器宽度 25%
- 最小：280px
- 最大：浏览器宽度 50%

拖拽时监听 pointer 事件，更新 `panelWidth`。

不要在拖拽时使用 `Date.now()` 或随机数。

## 页面浮层定位

如果原型页面内部有 `fixed right-0` 或 `fixed right-6` 的元素，打开 PRD 面板后会贴到浏览器最右侧并覆盖 PRD 面板。

处理策略：

1. 优先把原型页面包在相对定位容器中。
2. 对需要在原型区域内定位的浮层，改为基于原型容器定位。
3. 如果必须使用 `fixed`，则在 PRD 面板打开时用 CSS 变量补偿右侧面板宽度。

示例：

```css
.prototype-floating-right {
  right: var(--prd-panel-offset, 24px);
}
```

PRD 面板关闭：

```css
--prd-panel-offset: 24px;
```

PRD 面板打开：

```css
--prd-panel-offset: calc(var(--prd-panel-width) + 24px);
```

具体项目中可根据布局选择容器定位或 CSS 变量补偿。对 AI 小乐这类右侧面板，优先保证它出现在原型区域内，不要和 PRD 阅读面板重叠。

## activateRequirement 建议流程

```ts
async function activateRequirement(requirement) {
  setSelectedRequirement(requirement.id);

  for (const step of requirement.activate) {
    switch (step.type) {
      case 'navigate':
        // 如果已经在目标页，不重复跳转。
        break;
      case 'openPanel':
        // 调用页面提供的显式控制器，例如 openAIPanel。
        break;
      case 'openDialog':
        // 调用页面提供的显式控制器，例如 openImportDialog。
        break;
      case 'setTab':
      case 'setStep':
        // 设置页面状态。
        break;
      case 'scrollTo':
        // 等待 DOM 更新后 querySelector(`[data-req-anchor="${step.anchorId}"]`)。
        break;
      case 'highlight':
        // 设置当前高亮 anchorId。
        break;
    }
  }
}
```

关键要求：

- 优先使用显式状态控制器。
- 不要依赖按钮文案模拟点击。
- 需要等待弹窗或面板挂载后，再滚动和高亮。
- 如果某个激活动作暂时无法执行，要降级为滚动/高亮已存在锚点，并在代码注释或后续摘要中说明。

## 过滤空兜底说明

渲染业务逻辑前，统一过滤：

```ts
const emptyFallbacks = new Set([
  '无额外权限限制',
  '无额外数据流转',
  '无异常场景',
  '本对象无操作入口',
  '本对象仅展示',
]);
```

数组字段过滤空数组；字符串字段过滤空字符串和上述兜底内容。
