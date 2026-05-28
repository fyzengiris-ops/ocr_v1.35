import type { ActivationStep, RequirementRegistry } from './schema';

const relatedFiles = [
  'src/components/UploadQuestionDialog.tsx',
  'src/app/homework/page.tsx',
];

const pageName = '资料场景方式选择';
const route = '/homework → 识别作业资料 → 资料场景方式选择步骤';
const moduleName = '识别作业资料';
const decisionFile = 'docs/prd-workflow/decisions/select-mode-page.decision.md';

function activateSelectModeAnchor(anchorId: string): ActivationStep[] {
  return [
    { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'UploadQuestionDialog' },
    { type: 'setStep', label: '切换到资料场景方式选择步骤', step: 'select_mode' },
    { type: 'scrollTo', label: '定位页面对象', anchorId },
    { type: 'highlight', label: '高亮页面对象', anchorId },
  ];
}

function activateFileRoleDialog(anchorId: string): ActivationStep[] {
  return [
    { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'UploadQuestionDialog' },
    { type: 'setStep', label: '切换到资料场景方式选择步骤', step: 'select_mode' },
    { type: 'openDialog', label: '打开指定文件用途弹窗', dialog: 'SelectModeFileRoleDialog' },
    { type: 'scrollTo', label: '定位文件用途弹窗', anchorId },
    { type: 'highlight', label: '高亮文件用途弹窗', anchorId },
  ];
}

function activateBackButton(anchorId: string): ActivationStep[] {
  return [
    { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'UploadQuestionDialog' },
    { type: 'setStep', label: '切换到框选识别步骤', step: 'recognize_questions' },
    { type: 'scrollTo', label: '定位返回模式选择按钮', anchorId },
    { type: 'highlight', label: '高亮返回模式选择按钮', anchorId },
  ];
}

export const uploadQuestionDialogSelectModeRegistry: RequirementRegistry = {
  registryId: 'upload-question-dialog-select-mode',
  pageName,
  route,
  module: moduleName,
  description:
    '记录资料场景方式选择页面的完整页面逻辑，覆盖模式选择卡片、已上传文件列表、文件角色分配弹窗、返回确认等交互边界。',
  sourceDecisionFile: decisionFile,
  relatedFiles,
  requirements: [
    {
      id: 'SELECT_MODE-001',
      title: '页面标题与引导文案',
      sourceType: 'code+decision',
      objectType: 'copy',
      objectName: '请选择识别方式 / 建议根据您的资料内容，选择合适的处理流程',
      module: moduleName,
      pageName,
      route,
      anchorId: 'select-mode-title',
      anchorStatus: 'implemented',
      activate: activateSelectModeAnchor('select-mode-title'),
      display: {
        title: '页面标题',
        description: '页面居中显示标题「请选择识别方式」，标题下方显示引导文案「建议根据您的资料内容，选择合适的处理流程」。',
        fields: ['请选择识别方式', '建议根据您的资料内容，选择合适的处理流程'],
        states: ['正常显示'],
      },
      operation: {
        title: '无操作',
        description: '标题和引导文案为纯展示文本，不可交互。',
        permission: '无额外权限限制',
        dataFlow: '无额外数据流转',
        exceptions: '无异常场景',
      },
      acceptance: ['标题文案正确显示为「请选择识别方式」', '引导文案正确显示'],
      source: {
        decisionFile,
        decisionObject: '页面标题与引导文案',
        relatedFiles,
      },
    },
    {
      id: 'SELECT_MODE-002',
      title: '仅识别题目模式卡片',
      sourceType: 'code+decision',
      objectType: 'button',
      objectName: '仅识别题目模式选择按钮',
      module: moduleName,
      pageName,
      route,
      anchorId: 'select-mode-single-btn',
      anchorStatus: 'implemented',
      activate: activateSelectModeAnchor('select-mode-single-btn'),
      display: {
        title: '仅识别题目卡片',
        description: '左列显示「仅识别题目」卡片，包含蓝色文件图标、标题「仅识别题目」、副文案「适合只包含题目，不包含答案的资料内容」和一张示例图。',
        fields: ['仅识别题目', '适合只包含题目，不包含答案的资料内容', '示例图'],
        states: ['正常态', 'hover 边框变绿、阴影增强'],
      },
      operation: {
        title: '点击进入一步识别流程',
        description: '1、点击「仅识别题目」卡片后，进入一步识别流程，直接进入框选与识别页面。\n2、如果上传了多个文件，所有文件均视为题目文件处理。',
        permission: '无额外权限限制',
        dataFlow: '将用户选择的「仅识别题目」模式传递给后续识别流程',
        exceptions: '无异常场景',
      },
      acceptance: ['点击卡片后进入框选识别页面', '识别模式为仅识别题目', '多文件时不弹出角色分配弹窗'],
      source: {
        decisionFile,
        decisionObject: '仅识别题目模式选择',
        relatedFiles,
      },
    },
    {
      id: 'SELECT_MODE-003',
      title: '识别题目和答案模式卡片',
      sourceType: 'code+decision',
      objectType: 'button',
      objectName: '识别题目和答案模式选择按钮',
      module: moduleName,
      pageName,
      route,
      anchorId: 'select-mode-stepwise-btn',
      anchorStatus: 'implemented',
      activate: activateSelectModeAnchor('select-mode-stepwise-btn'),
      display: {
        title: '识别题目和答案卡片',
        description: '右列显示「识别题目和答案」卡片，包含紫色图层图标、标题「识别题目和答案」、副文案「适合包含即题目，也包含答案或解析的资料内容」和两张示例图。',
        fields: ['识别题目和答案', '适合包含即题目，也包含答案或解析的资料内容', '示例图（两张）'],
        states: ['正常态', 'hover 边框变绿、阴影增强'],
      },
      operation: {
        title: '点击进入分步识别流程',
        description: '1、点击「识别题目和答案」卡片后，进入分步识别流程。\n2、如果上传了多个文件（≥2个），弹出「指定文件用途」弹窗，让用户为每份文件分配角色（题目文件/答案文件）。\n3、如果只有 1 个文件，不弹窗，直接进入框选识别页面，默认该文件同时包含题目和答案。',
        permission: '无额外权限限制',
        dataFlow: '将用户选择的「识别题目和答案」模式和文件角色分配结果传递给后续识别流程',
        exceptions: '关闭角色分配弹窗时，已选的识别模式取消，用户需重新选择模式',
      },
      acceptance: [
        '点击卡片后进入分步识别流程',
        '多文件时弹出角色分配弹窗',
        '单文件时直接进入框选识别页面',
        '关闭弹窗后识别模式取消，可重新选择',
      ],
      source: {
        decisionFile,
        decisionObject: '识别题目和答案模式选择',
        relatedFiles,
      },
    },
    {
      id: 'SELECT_MODE-004',
      title: '已上传文件列表',
      sourceType: 'code+decision',
      objectType: 'region',
      objectName: '已上传文件列表区域',
      module: moduleName,
      pageName,
      route,
      anchorId: 'select-mode-file-list',
      anchorStatus: 'implemented',
      activate: activateSelectModeAnchor('select-mode-file-list'),
      display: {
        title: '已上传文件列表',
        description: '模式卡片下方显示「已上传的文件：」标题和文件列表。每行显示文件图标、文件名和识别页数（如「识别12页」）。页数信息来自上传弹窗中用户选择的识别范围。如果未获取到页数信息，则不显示页数。',
        fields: ['文件名', '识别X页', '文件图标'],
        states: ['正常态', '无页数信息时不显示页数字段'],
      },
      operation: {
        title: '纯展示区域',
        description: '文件列表为纯展示区域，用户不可在此处操作文件。',
        permission: '无额外权限限制',
        dataFlow: '文件数据来自用户上传时确定的文件和识别范围',
        exceptions: '无异常场景',
      },
      acceptance: ['文件列表正确显示文件名', '有识别范围时显示识别页数', '无识别范围时不显示页数'],
      source: {
        decisionFile,
        decisionObject: '已上传文件列表缺少页数信息',
        relatedFiles,
      },
    },
    {
      id: 'SELECT_MODE-005',
      title: '文件角色分配弹窗',
      sourceType: 'code+decision',
      objectType: 'dialog',
      objectName: '指定文件用途弹窗',
      module: moduleName,
      pageName,
      route,
      anchorId: 'select-mode-file-role-dialog',
      anchorStatus: 'implemented',
      activate: activateFileRoleDialog('select-mode-file-role-dialog'),
      display: {
        title: '文件角色分配弹窗',
        description: '弹窗标题「指定文件用途」，说明文案「检测到您上传了 N 个文件，请分别指定用途」。每份文件一行，显示文件图标、文件名、题目文件按钮、答案文件按钮。底部有取消和确认按钮。',
        fields: ['文件名称', '题目文件按钮', '答案文件按钮', '取消按钮', '确认按钮'],
        states: [
          '题目文件按钮选中态：绿色背景白色文字',
          '答案文件按钮选中态：绿色背景白色文字',
          '未选中态：白色背景灰色文字',
          '确认按钮禁用态：有文件未分配角色时置灰',
          '确认按钮可用态：所有文件均已分配角色时绿色高亮',
        ],
      },
      operation: {
        title: '文件角色分配',
        description: '1、每份文件的角色选择独立，A 文件选题目不影响 B 文件也选题目。\n2、点击已选中的角色按钮可取消选择，恢复为未分配状态。\n3、所有文件都分配角色后，「确认，开始处理」按钮高亮可点击。\n4、点击「确认」后关闭弹窗，进入框选识别页面。\n5、点击「取消」或右上角 ✕ 关闭弹窗，同时取消已选的识别模式，用户可重新选择模式。',
        permission: '无额外权限限制',
        dataFlow: '角色分配结果传递给后续流程，用于决定文件显示顺序和处理方式',
        exceptions: '关闭弹窗前如果有文件未分配角色，直接关闭，不提示（用户可下次重新进入弹窗分配）',
      },
      acceptance: [
        '每份文件独立选择角色',
        '点击已选中按钮可取消',
        '所有文件分配后确认按钮可用',
        '取消和 ✕ 都可使识别模式取消，返回重新选择',
      ],
      source: {
        decisionFile,
        decisionObject: '文件角色分配弹窗',
        relatedFiles,
      },
    },
    {
      id: 'SELECT_MODE-006',
      title: '返回模式选择确认',
      sourceType: 'code+decision',
      objectType: 'button',
      objectName: '步骤条第一步返回按钮',
      module: moduleName,
      pageName,
      route,
      anchorId: 'select-mode-back-btn',
      anchorStatus: 'implemented',
      activate: activateBackButton('select-mode-back-btn'),
      display: {
        title: '步骤条返回按钮',
        description: '步骤条中第一步「资料场景方式选择」在后续步骤时为可点击按钮（带 ← 图标）。在模式选择步骤时则为当前选中态高亮。',
        fields: ['← 1. 资料场景方式选择'],
        states: [
          '当前步骤：绿色背景白色文字 + 脉冲圆点',
          '已完成步骤：绿色浅背景 + ✓ 图标',
          '可返回状态：灰色背景，hover 变深，可点击',
        ],
      },
      operation: {
        title: '返回模式选择',
        description: '1、在后续步骤中点击步骤条第一步，弹出确认弹窗：「返回模式选择将清空当前识别进度（包括框选和已识别的题目），是否继续？」。\n2、点击「确认返回」后：清空当前识别模式和文件角色分配、已框选的题目区域、已识别的题目和答案数据，返回模式选择页面。\n3、点击「取消」关闭弹窗，保持当前页面不变。',
        permission: '无额外权限限制',
        dataFlow: '确认后清空所有流程数据，用户需重新选择模式开始',
        exceptions: '如果当前没有识别进度，无需清空，直接返回',
      },
      acceptance: [
        '点击返回按钮弹出确认弹窗',
        '确认后清空所有数据返回模式选择页面',
        '取消后保持当前页面不变',
      ],
      source: {
        decisionFile,
        decisionObject: '恢复：从后续步骤返回 select_mode 后的状态',
        relatedFiles,
      },
    },
    {
      id: 'SELECT_MODE-007',
      title: '步骤条在模式选择页的显示',
      sourceType: 'code+decision',
      objectType: 'step',
      objectName: '步骤条（模式选择步骤）',
      module: moduleName,
      pageName,
      route,
      anchorId: 'select-mode-step-bar',
      anchorStatus: 'implemented',
      activate: activateSelectModeAnchor('select-mode-step-bar'),
      display: {
        title: '模式选择页步骤条',
        description: '模式选择页面顶部显示 4 步步骤条：1.资料场景方式选择 → 2.框选&识别 → 3.核查题目信息 → 4.加入试卷。第一步「资料场景方式选择」为当前激活态（绿色高亮 + 脉冲圆点），其余三步为灰色未到达态。',
        fields: ['1.资料场景方式选择', '2.框选&识别', '3.核查题目信息', '4.加入试卷'],
        states: [
          '第一步：绿色背景白色文字 + 白色脉冲圆点（当前步骤）',
          '第二至四步：灰色背景灰色文字（未到达步骤）',
        ],
      },
      operation: {
        title: '仅展示',
        description: '步骤条在模式选择步骤仅展示流程阶段，不可点击切换步骤。',
        permission: '无额外权限限制',
        dataFlow: '无额外数据流转',
        exceptions: '无异常场景',
      },
      acceptance: ['步骤条正确显示', '第一步为当前激活态', '其余步骤为不可点击的灰色态'],
      source: {
        decisionFile,
        decisionObject: '步骤条显示',
        relatedFiles,
      },
    },
  ],
  excludedDecisions: [
    {
      objectName: '示例图片 alt 文案',
      reason: '保持现状，alt 仅做兜底不影响主流程（决策 1B）',
      sourceDecision: '决策 1',
    },
    {
      objectName: '多文件提示文案',
      reason: '已删除「检测到多个文件，请分别指定文件用途」文案（决策 8）',
      sourceDecision: '决策 8',
    },
  ],
};
