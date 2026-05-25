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
      id: 'AI_CHAT_PANEL-001',
      title: 'AI 小乐侧边面板展示与关闭',
      sourceType: 'code',
      objectType: 'panel',
      objectName: 'AI 小乐侧边面板',
      module: 'AI 小乐',
      pageName: 'AI 小乐侧边面板组件',
      route: 'component:AIChatPanel',
      anchorId: 'ai-chat-panel.container',
      anchorStatus: 'planned',
      activate: [
        { type: 'navigate', label: '跳转到可打开 AI 小乐的作业管理页', to: '/homework' },
        { type: 'openPanel', label: '打开 AI 小乐侧边面板', panel: 'AIChatPanel' },
        { type: 'scrollTo', label: '定位到 AI 小乐侧边面板', anchorId: 'ai-chat-panel.container' },
        { type: 'highlight', label: '高亮 AI 小乐侧边面板', anchorId: 'ai-chat-panel.container' },
      ],
      display: {
        title: '侧边面板展示',
        description:
          'AI 小乐以固定在页面右侧的侧边面板形式展示，面板顶部显示标题“AI小乐”，右侧保留历史对话、新对话和关闭入口。',
        fields: ['AI小乐标题', '历史对话入口', '新对话入口', '关闭按钮'],
        states: ['面板打开态', '面板关闭态'],
      },
      operation: {
        title: '面板关闭操作',
        description:
          '用户点击右上角关闭按钮后，组件调用父级传入的 onClose 回调，由调用页面关闭 AI 小乐侧边面板。',
        permission: '沿用 AI 小乐入口所在页面权限，本组件不单独控制权限。',
        dataFlow: '关闭操作只触发 onClose 回调，不产生新的业务数据。',
        exceptions: '关闭按钮点击后不应保留侧边面板遮挡页面；历史对话和新对话属于已上线能力，本次不展开其业务规则。',
      },
      acceptance: [
        '打开 AI 小乐后，页面右侧应展示 AI 小乐侧边面板。',
        '面板顶部应展示“AI小乐”标题和关闭按钮。',
        '点击关闭按钮后，父页面应隐藏 AI 小乐侧边面板。',
      ],
      source: {
        decisionFile: 'docs/prd-workflow/decisions/ai-chat-panel.decision.md',
        decisionObject: 'AI 小乐侧边面板组件',
        relatedFiles,
      },
    },
    {
      id: 'AI_CHAT_PANEL-002',
      title: 'AI 小乐欢迎语保持现状',
      sourceType: 'code+decision',
      objectType: 'copy',
      objectName: 'AI 小乐欢迎语',
      module: 'AI 小乐',
      pageName: 'AI 小乐侧边面板组件',
      route: 'component:AIChatPanel',
      anchorId: 'ai-chat-panel.welcome-message',
      anchorStatus: 'planned',
      activate: [
        { type: 'navigate', label: '跳转到可打开 AI 小乐的作业管理页', to: '/homework' },
        { type: 'openPanel', label: '打开 AI 小乐侧边面板', panel: 'AIChatPanel' },
        { type: 'scrollTo', label: '定位到欢迎语消息', anchorId: 'ai-chat-panel.welcome-message' },
        { type: 'highlight', label: '高亮欢迎语消息', anchorId: 'ai-chat-panel.welcome-message' },
      ],
      display: {
        title: '欢迎语展示',
        description:
          '面板首次打开时展示 AI 小乐欢迎语：“Hi! 我是AI小乐! 我能够帮您出题、布置作业, 请把您的任务交给我吧!”。已确认本次保持现有欢迎语和禁用输入框不变，不额外说明。',
        fields: ['AI 小乐头像', '欢迎语消息气泡'],
        states: ['初始消息态'],
      },
      operation: {
        title: '欢迎语无直接操作',
        description:
          '欢迎语作为初始说明消息展示，不提供直接操作入口；用户后续通过快捷功能按钮发起任务。',
        permission: '沿用 AI 小乐入口所在页面权限，本组件不单独控制权限。',
        dataFlow: '欢迎语来自组件初始 messages 状态，不依赖接口或外部数据。',
        exceptions: '欢迎语不需要因底部输入框禁用而额外展示补充说明。',
      },
      acceptance: [
        '首次打开面板时应展示 AI 小乐欢迎语。',
        '欢迎语文案保持现有内容。',
        '欢迎语本身不应触发任何业务操作。',
      ],
      source: {
        decisionFile: 'docs/prd-workflow/decisions/ai-chat-panel.decision.md',
        decisionObject: '文案：AI 小乐欢迎语',
        relatedFiles,
      },
    },
    {
      id: 'AI_CHAT_PANEL-003',
      title: '快捷功能按钮组展示与点击后隐藏',
      sourceType: 'code+decision',
      objectType: 'button',
      objectName: '快捷功能按钮组',
      module: 'AI 小乐',
      pageName: 'AI 小乐侧边面板组件',
      route: 'component:AIChatPanel',
      anchorId: 'ai-chat-panel.quick-actions',
      anchorStatus: 'planned',
      activate: [
        { type: 'navigate', label: '跳转到可打开 AI 小乐的作业管理页', to: '/homework' },
        { type: 'openPanel', label: '打开 AI 小乐侧边面板', panel: 'AIChatPanel' },
        { type: 'scrollTo', label: '定位到快捷功能按钮组', anchorId: 'ai-chat-panel.quick-actions' },
        { type: 'highlight', label: '高亮快捷功能按钮组', anchorId: 'ai-chat-panel.quick-actions' },
      ],
      display: {
        title: '快捷功能按钮展示',
        description:
          '面板处于初始消息状态时展示快捷功能按钮组，包含“帮我布置试卷作业”“帮我识别作业资料”“帮我布置听力作业”。已确认保持当前逻辑，用户点击一次快捷按钮后隐藏按钮组。',
        fields: ['帮我布置试卷作业', '帮我识别作业资料', '帮我布置听力作业'],
        states: ['初始展示态', '点击后隐藏态'],
      },
      operation: {
        title: '快捷任务触发',
        description:
          '用户点击任一快捷功能按钮后，系统追加一条用户消息“帮我{任务名称}”，并在 500ms 后追加 AI 回复。点击后按钮组因消息数量变化而隐藏。',
        permission: '沿用 AI 小乐入口所在页面权限，本组件不单独控制权限。',
        dataFlow:
          '点击按钮会更新组件内部 activeAction 和 messages 状态；若点击“识别作业资料”，还会调用父级传入的 onActionClick(action)。',
        exceptions: '按钮点击后不提供本组件内的重新选择入口；该行为已确认保持现状。',
      },
      acceptance: [
        '初始状态下应展示三个快捷功能按钮。',
        '点击快捷功能按钮后应追加对应用户消息。',
        '点击任一快捷功能按钮后，快捷功能按钮组应隐藏。',
      ],
      source: {
        decisionFile: 'docs/prd-workflow/decisions/ai-chat-panel.decision.md',
        decisionObject: '按钮：快捷功能按钮组',
        relatedFiles,
      },
    },
    {
      id: 'AI_CHAT_PANEL-004',
      title: '识别作业资料快捷任务触发父级流程',
      sourceType: 'code',
      objectType: 'button',
      objectName: '帮我识别作业资料',
      module: 'AI 小乐',
      pageName: 'AI 小乐侧边面板组件',
      route: 'component:AIChatPanel',
      anchorId: 'ai-chat-panel.quick-actions.recognize-homework',
      anchorStatus: 'planned',
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
          '快捷功能按钮组中展示“帮我识别作业资料”按钮。点击后，面板追加 AI 回复“好的, 请上传识别资料。支持的文件格式: PNG/JPG/JPEG/GIF/WebP/BMP、DOC/DOCX、PDF。”',
        fields: ['帮我识别作业资料按钮', '上传资料提示消息'],
        states: ['初始展示态', '点击后回复态'],
      },
      operation: {
        title: '触发识别资料流程',
        description:
          '用户点击“帮我识别作业资料”后，组件调用 onActionClick("识别作业资料")，由父页面继续打开导入资料相关流程。',
        permission: '沿用 AI 小乐入口所在页面权限，本组件不单独控制权限。',
        dataFlow:
          '组件内部追加用户消息和 AI 回复；识别资料动作通过 onActionClick 回调交给父页面处理，组件本身不直接上传文件。',
        exceptions: '如果父页面未处理 onActionClick，该组件只会显示提示消息，不会自行打开导入资料弹窗。',
      },
      acceptance: [
        '点击“帮我识别作业资料”后，应追加对应用户消息。',
        '点击后应展示上传资料格式提示。',
        '点击后应调用父级 onActionClick，并传入“识别作业资料”。',
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
      anchorStatus: 'planned',
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
        permission: '沿用 AI 小乐入口所在页面权限，本组件不单独控制权限。',
        dataFlow: '禁用输入框不产生用户输入数据；禁用发送按钮不触发消息发送。',
        exceptions: '点击禁用输入框或禁用发送按钮时，不应触发任何提交、消息追加或父级回调。',
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
    {
      id: 'AI_CHAT_PANEL-006',
      title: '消息区按消息类型展示并自动滚动',
      sourceType: 'code',
      objectType: 'region',
      objectName: '消息区域',
      module: 'AI 小乐',
      pageName: 'AI 小乐侧边面板组件',
      route: 'component:AIChatPanel',
      anchorId: 'ai-chat-panel.messages',
      anchorStatus: 'planned',
      activate: [
        { type: 'navigate', label: '跳转到可打开 AI 小乐的作业管理页', to: '/homework' },
        { type: 'openPanel', label: '打开 AI 小乐侧边面板', panel: 'AIChatPanel' },
        { type: 'scrollTo', label: '定位到消息区域', anchorId: 'ai-chat-panel.messages' },
        { type: 'highlight', label: '高亮消息区域', anchorId: 'ai-chat-panel.messages' },
      ],
      display: {
        title: '消息区展示',
        description:
          '消息区根据消息类型区分展示 AI 消息和用户消息。AI 消息展示头像和灰色消息气泡，用户消息靠右展示绿色消息气泡。',
        fields: ['AI 消息气泡', '用户消息气泡', 'AI 小乐头像'],
        states: ['初始消息态', '追加消息态', '滚动到底部态'],
      },
      operation: {
        title: '消息追加与滚动',
        description:
          '组件内部 messages 状态变化后，消息区自动滚动到最新消息位置，便于用户看到刚追加的用户消息和 AI 回复。',
        permission: '沿用 AI 小乐入口所在页面权限，本组件不单独控制权限。',
        dataFlow: '消息内容来自组件内部 messages 状态；messages 更新后通过 messagesEndRef 滚动到末尾。',
        exceptions: '当消息区内容增多时，应保持可滚动；滚动行为不应影响父页面滚动。',
      },
      acceptance: [
        'AI 消息和用户消息应按类型使用不同布局展示。',
        '新增消息后，消息区应滚动到最新消息。',
        '消息区内容超出高度时应支持纵向滚动。',
      ],
      source: {
        decisionFile: 'docs/prd-workflow/decisions/ai-chat-panel.decision.md',
        decisionObject: '代码事实：消息区域',
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
