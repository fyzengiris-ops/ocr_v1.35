import type { RequirementRegistry } from './schema';

const relatedFiles = [
  'src/components/AIChatPanel.tsx',
  'src/app/homework/page.tsx',
  'src/app/paper-edit/page.tsx',
];

export const aiChatPanelRegistry: RequirementRegistry = {
  registryId: 'ai-chat-panel',
  pageName: 'AI 小乐侧边面板组件',
  route: 'component:AIChatPanel',
  module: 'AI 小乐',
  description:
    '记录 AI 小乐侧边面板的完整页面逻辑。本注册表包含组件代码中已经体现的显示、操作、状态流转逻辑，并合并已确认的本次迭代边界决策。',
  sourceDecisionFile: 'docs/prd-workflow/decisions/ai-chat-panel.decision.md',
  relatedFiles,
  requirements: [
    {
      id: 'AI_CHAT_PANEL-004',
      title: '识别作业资料快捷任务',
      sourceType: 'code',
      objectType: 'button',
      objectName: '帮我识别作业资料',
      module: 'AI 小乐',
      pageName: 'AI 小乐侧边面板组件',
      route: 'component:AIChatPanel',
      anchorId: 'ai-chat-panel.quick-actions.recognize-homework',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '跳转到可打开 AI 小乐的作业管理页', to: '/homework' },
        { type: 'openPanel', label: '打开 AI 小乐侧边面板', panel: 'AIChatPanel' },
        {
          type: 'scrollTo',
          label: '定位到“帮我识别作业资料”按钮',
          anchorId: 'ai-chat-panel.quick-actions.recognize-homework',
        },
        {
          type: 'highlight',
          label: '高亮“帮我识别作业资料”按钮',
          anchorId: 'ai-chat-panel.quick-actions.recognize-homework',
        },
      ],
      display: {
        title: '识别作业资料入口展示',
        description:
          '快捷功能按钮组中展示“帮我识别作业资料”按钮。用户点击后，AI 小乐会提示用户上传待识别的作业资料，并说明支持的文件格式。',
        fields: ['帮我识别作业资料按钮', '上传资料提示消息'],
        states: ['初始展示态', '点击后回复态'],
      },
      operation: {
        title: '进入资料识别流程',
        description:
          '用户点击“帮我识别作业资料”后，应进入上传作业资料的下一步流程。AI 小乐只负责引导用户发起识别任务，后续上传和识别在资料上传流程中完成。',
        permission: '沿用当前页面的 AI 小乐使用权限。',
        dataFlow:
          '用户选择识别作业资料后，页面应继续承接资料上传和识别流程；AI 小乐本身不承担文件上传处理。',
        exceptions: '如果当前页面暂未接入上传资料流程，用户点击后只能看到上传资料提示，不能继续完成识别。',
      },
      acceptance: [
        '点击“帮我识别作业资料”后，应追加对应用户消息。',
        '点击后应展示上传资料格式提示。',
        '点击后应进入上传作业资料的下一步流程。',
      ],
      source: {
        decisionFile: 'docs/prd-workflow/decisions/ai-chat-panel.decision.md',
        decisionObject: '代码事实：识别作业资料快捷任务',
        relatedFiles,
      },
    },
    {
      id: 'AI_CHAT_PANEL-005',
      title: '底部文字输入区禁用',
      sourceType: 'code+decision',
      objectType: 'region',
      objectName: '底部文字输入区',
      module: 'AI 小乐',
      pageName: 'AI 小乐侧边面板组件',
      route: 'component:AIChatPanel',
      anchorId: 'ai-chat-panel.input.disabled',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '跳转到可打开 AI 小乐的作业管理页', to: '/homework' },
        { type: 'openPanel', label: '打开 AI 小乐侧边面板', panel: 'AIChatPanel' },
        { type: 'scrollTo', label: '定位到底部文字输入区', anchorId: 'ai-chat-panel.input.disabled' },
        { type: 'highlight', label: '高亮底部文字输入区', anchorId: 'ai-chat-panel.input.disabled' },
      ],
      display: {
        title: '底部输入区禁用展示',
        description:
          '底部保留文字输入框和发送按钮，但二者均为禁用状态。输入框 placeholder 为“请使用快捷功能按钮操作”。',
        fields: ['文字输入框', '发送按钮', 'placeholder：请使用快捷功能按钮操作'],
        states: ['输入框禁用态', '发送按钮禁用态'],
      },
      operation: {
        title: '禁止自由文本输入',
        description:
          '用户不能通过底部输入框输入自由文本，也不能点击发送按钮提交消息；当前版本仅支持通过快捷功能按钮操作。',
        permission: '沿用当前页面的 AI 小乐使用权限。',
        dataFlow: '当前版本不接收自由文本内容，用户任务只能从快捷功能按钮进入。',
        exceptions: '用户点击禁用输入区或发送按钮时，不应提交任何内容，也不应产生新的对话消息。',
      },
      acceptance: [
        '底部文字输入框应处于禁用状态。',
        '底部发送按钮应处于禁用状态。',
        '禁用输入区不应触发消息发送。',
        'PRD 应说明当前版本仅支持快捷按钮操作。',
      ],
      source: {
        decisionFile: 'docs/prd-workflow/decisions/ai-chat-panel.decision.md',
        decisionObject: '区域：底部文字输入区',
        relatedFiles,
      },
    },
  ],
  excludedDecisions: [
    {
      objectName: '历史对话 / 新对话',
      reason: '已确认为已上线功能，本次迭代不做更改，不展开为本次需求卡片。',
      sourceDecision: '历史对话和新对话属于已上线功能，本次迭代不做更改。',
    },
    {
      objectName: '非本次能力快捷入口',
      reason: '已确认为已上线能力，本期迭代不用管，不作为本次页面逻辑审核的改造范围。',
      sourceDecision: '其他快捷功能均已上线，本期迭代不用管。',
    },
    {
      objectName: '上传文件消息卡片',
      reason: '已确认 AI 小乐面板不涉及上传文件消息卡片，该逻辑属于后续页面。',
      sourceDecision: 'AI 小乐面板不涉及上传文件消息卡片，那是后面的页面。',
    },
  ],
};
