import type { ActivationStep, RequirementRegistry } from './schema';

const relatedFiles = [
  'src/components/UploadQuestionDialog.tsx',
  'src/components/ImportDocumentDialog.tsx',
  'src/app/homework/page.tsx',
];

const pageName = '上传资料步骤页';
const route = '/homework → 识别作业资料 → 步骤 1「上传资料」';
const moduleName = '识别作业资料';
const decisionFile = '产品文档/prd-workflow/decisions/upload-files-step.decision.md';

function activateUploadFilesStep(anchorId: string): ActivationStep[] {
  return [
    { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'UploadQuestionDialog' },
    { type: 'setStep', label: '切换到上传资料步骤', step: 'upload_files' },
    { type: 'scrollTo', label: '定位页面对象', anchorId },
    { type: 'highlight', label: '高亮页面对象', anchorId },
  ];
}

export const uploadFilesStepRegistry: RequirementRegistry = {
  registryId: 'upload-files-step',
  pageName,
  route,
  module: moduleName,
  description:
    '记录步骤 1「上传资料」的完整页面逻辑，包括资料管理、空态上传、文件列表、删除、追加、识别范围、24 页校验和下一步。',
  sourceDecisionFile: decisionFile,
  relatedFiles,
  requirements: [
    {
      id: 'UPLOAD_FILES_STEP-001',
      title: '上传资料步骤条',
      sourceType: 'code+decision',
      changeType: 'new',
      changeDate: '6.2',
      objectType: 'step',
      objectName: '上传资料步骤条',
      module: moduleName,
      pageName,
      route,
      anchorId: 'upload-files-step.step-bar',
      anchorStatus: 'implemented',
      activate: activateUploadFilesStep('upload-files-step.step-bar'),
      display: {
        title: '上传资料步骤条展示',
        description:
          '弹窗顶部展示识别流程步骤条。当前处于步骤 1「上传资料」时，该步骤使用绿色高亮和脉冲圆点，辅助文案为「管理本次识别的资料文件」。后续步骤按未到达状态展示。',
        fields: ['1. 上传资料', '管理本次识别的资料文件', '后续步骤'],
        states: ['当前步骤', '未到达步骤'],
      },
      operation: {
        title: '步骤条仅展示进度',
        description:
          '步骤条只用于展示当前流程进度，不允许用户点击切换步骤。用户需要从后续步骤返回时，只能使用「修改资料」入口。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '步骤条不修改本次任务数据。',
        exceptions: '步骤条中的已完成步骤也不可点击返回。',
      },
      acceptance: [
        '步骤 1 应展示为当前高亮状态。',
        '步骤条只展示进度，不允许点击切换步骤。',
        '从后续步骤返回步骤 1 时，只能使用「修改资料」入口。',
      ],
      source: {
        decisionFile,
        decisionObject: '交互：返回「上传资料」的入口',
        relatedFiles,
      },
    },
    {
      id: 'UPLOAD_FILES_STEP-002',
      title: '已上传资料汇总与文件列表',
      sourceType: 'code',
      changeType: 'new',
      changeDate: '6.2',
      objectType: 'region',
      objectName: '已上传资料列表',
      module: moduleName,
      pageName,
      route,
      anchorId: 'upload-files-step.file-list',
      anchorStatus: 'implemented',
      activate: activateUploadFilesStep('upload-files-step.file-list'),
      display: {
        title: '已上传资料展示',
        description:
          '已有资料时，页面展示「已上传资料」标题、文件总数和当前识别总页数。每份资料显示文件名称、文件大小、当前识别页数、文件总页数和删除入口；资料处理失败时，失败状态应在对应文件行内提示，不单独拆成新的页面注释。',
        fields: ['已上传资料', '已上传 X 份文件，共 Y 页', '文件名称', '文件大小', '识别X页 / 共Y页', '删除按钮', '处理失败提示'],
        states: ['已有资料状态', '文件名称过长时省略显示', '文件处理失败状态'],
      },
      operation: {
        title: '资料列表用于统一管理',
        description:
          '用户可以通过文件行中的识别页数入口调整范围，也可以通过删除入口移除资料。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '列表展示本次识别任务中已经提交的文件、当前识别范围和页数统计。',
        exceptions: '如果暂未取得文件总页数，只展示当前已知的识别页数；如果资料处理失败，用户需要删除失败文件并重新上传有效资料。',
      },
      acceptance: [
        '已有资料时应显示文件数量和当前识别总页数。',
        '每份资料应显示文件名称和文件大小。',
        '取得文件页数后，应显示「识别X页 / 共Y页」。',
        '处理失败的资料应在文件行内给出明确失败提示。',
      ],
      source: {
        decisionFile,
        decisionObject: '页面目标：已有资料状态',
        relatedFiles,
      },
    },
    {
      id: 'UPLOAD_FILES_STEP-003',
      title: '文件删除与删除最后一份资料',
      sourceType: 'code+decision',
      changeType: 'new',
      changeDate: '6.2',
      objectType: 'button',
      objectName: '文件删除按钮',
      module: moduleName,
      pageName,
      route,
      anchorId: 'upload-files-step.file-delete',
      anchorStatus: 'implemented',
      activate: activateUploadFilesStep('upload-files-step.file-delete'),
      display: {
        title: '文件删除入口',
        description:
          '每份资料右侧展示删除按钮。删除确认弹窗打开时，弹窗说明将移除当前文件且操作不可撤销，并展示「取消」和「确认删除」按钮。',
        fields: ['删除按钮', '确认删除该文件？', '取消', '确认删除'],
        states: ['文件列表状态', '删除确认弹窗打开状态'],
      },
      operation: {
        title: '删除资料并重新处理',
        description:
          '1、用户确认删除后，系统从本次任务中移除对应资料。\n2、删除属于资料修改，系统按照最新文件列表重新处理全部资料。\n3、删除最后一份资料后，页面保留在步骤 1 的无资料状态，保留当前学段学科，用户重新上传后可以继续当前任务。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '删除后更新本次任务的资料列表、识别范围和页数统计，并触发全部资料重新处理。',
        exceptions: '删除最后一份资料后，「下一步」不可用，直到用户重新上传有效资料。',
      },
      acceptance: [
        '点击删除按钮后应展示删除确认弹窗。',
        '确认删除后，对应资料应从列表移除。',
        '删除任意资料后，应按照最新列表重新处理全部资料。',
        '删除最后一份资料后，应展示无资料状态并禁用「下一步」。',
      ],
      source: {
        decisionFile,
        decisionObject: '状态：删除最后一份资料 / 逻辑：修改资料后的重算范围',
        relatedFiles,
      },
    },
    {
      id: 'UPLOAD_FILES_STEP-004',
      title: '无资料状态与直接上传',
      sourceType: 'code+decision',
      changeType: 'new',
      changeDate: '6.2',
      objectType: 'region',
      objectName: '无资料状态上传区域',
      module: moduleName,
      pageName,
      route,
      anchorId: 'upload-files-step.empty-upload',
      anchorStatus: 'implemented',
      activate: activateUploadFilesStep('upload-files-step.empty-upload'),
      display: {
        title: '无资料状态展示',
        description:
          '无资料时，页面显示上传图标、主提示「请上传本次需要识别的资料文件」、格式和页数说明、虚线上传区域以及「上传资料」按钮。虚线区域提示「点击上传，或拖拽文件至此」。',
        fields: ['请上传本次需要识别的资料文件', '支持格式与 24 页说明', '点击上传，或拖拽文件至此', '上传资料'],
        states: ['无资料状态', '拖拽悬停状态'],
      },
      operation: {
        title: '直接点击或拖拽上传',
        description:
          '用户可以点击上传区域、点击「上传资料」按钮或将文件拖拽到上传区域，直接向当前任务添加资料。新增资料复用既有的格式校验、重复文件拦截和文件页数检测规则。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '有效资料进入当前任务文件列表，随后按照最新文件列表重新处理。',
        exceptions:
          '不支持格式、重复文件和文件页数检测失败时，沿用识别作业资料弹窗已确认的拦截和提示规则。',
      },
      acceptance: [
        '无资料时应展示完整上传引导。',
        '点击上传区域和「上传资料」按钮均可选择文件。',
        '拖拽文件到上传区域可以直接添加资料。',
        '无效资料应按既有规则拦截。',
      ],
      source: {
        decisionFile,
        decisionObject: '操作区域：无资料状态上传方式',
        relatedFiles,
      },
    },
    {
      id: 'UPLOAD_FILES_STEP-005',
      title: '继续上传与资料来源',
      sourceType: 'code+decision',
      changeType: 'new',
      changeDate: '6.2',
      objectType: 'button',
      objectName: '继续上传按钮',
      module: moduleName,
      pageName,
      route,
      anchorId: 'upload-files-step.continue-upload',
      anchorStatus: 'implemented',
      activate: activateUploadFilesStep('upload-files-step.continue-upload'),
      display: {
        title: '继续上传按钮',
        description:
          '已有资料时，底部操作栏左侧展示「继续上传」按钮。继续上传资料时，资料选择弹窗继续展示学段学科字段，并回显当前任务已选择的学段学科。达到 24 页上限时，按钮展示为禁用状态。',
        fields: ['继续上传', '学段学科'],
        states: ['可用状态', '达到 24 页上限时的禁用状态', '当前学科回显', '重新选择学科'],
      },
      operation: {
        title: '追加本地文件或资源库资料',
        description:
          '1、用户点击「继续上传」后，可以追加本地文件，也可以从「我的资源库」选择资料。\n2、同一识别任务允许混合使用本地文件和资源库资料。\n3、追加资料属于资料修改，系统按照最新文件列表重新处理全部资料。\n4、用户继续上传时仍可重新选择学段学科，不额外提示；新选择的学段学科对本次任务内全部已上传资料和新追加资料统一生效。',
        permission: '学段学科选项沿用当前教师账号在乐课网任教的学段学科数据；入口权限沿用作业管理页中 AI 小乐识别资料入口。',
        dataFlow: '新选择的资料追加到当前任务资料列表，并参与总页数统计和全部资料重新处理；学段学科作为当前任务统一学科，用于全部资料的后续识别请求和加入试卷。',
        exceptions: '当前任务已达到 24 页上限时，按钮不可用。',
      },
      acceptance: [
        '未达到 24 页上限时，可以点击「继续上传」。',
        '继续上传时可以选择本地文件或资源库资料。',
        '同一任务可以混合使用两种资料来源。',
        '追加资料后应按照最新资料列表重新处理全部资料。',
        '继续上传时应展示并回显当前任务学段学科。',
        '新选择的学段学科应对当前任务内全部资料统一生效。',
      ],
      source: {
        decisionFile,
        decisionObject: '按钮：「继续上传」允许选择的资料来源',
        relatedFiles,
      },
    },
    {
      id: 'UPLOAD_FILES_STEP-006',
      title: '24 页上限与超限处理',
      sourceType: 'code+decision',
      changeType: 'new',
      changeDate: '6.2',
      objectType: 'state',
      objectName: '24 页上限状态',
      module: moduleName,
      pageName,
      route,
      anchorId: 'upload-files-step.page-limit',
      anchorStatus: 'implemented',
      activate: activateUploadFilesStep('upload-files-step.page-limit'),
      display: {
        title: '超限警告与按钮禁用状态',
        description:
          '当前选择页数超过 24 页时，页面展示琥珀色警告和「选择识别范围」入口。「下一步」展示为禁用状态。当前任务已达到 24 页时，「继续上传」也展示为禁用状态。',
        fields: ['超限警告', '选择识别范围', '继续上传', '下一步'],
        states: ['24 页以内', '已达到 24 页', '超过 24 页'],
      },
      operation: {
        title: '按 24 页上限拦截操作',
        description:
          '1、整个识别任务合计最多支持识别 24 页。\n2、当前选择页数超过 24 页时，用户需要删除资料或调整识别范围后才能进入下一步。\n3、当前任务已达到 24 页时，不允许继续追加资料。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '页面根据当前任务全部资料的识别范围汇总页数，并同步更新警告和按钮状态。',
        exceptions: '达到 24 页时，「继续上传」提示「当前已达 24 页上限，请删除资料或调整识别范围后再继续上传」。',
      },
      acceptance: [
        '当前选择页数超过 24 页时，应展示超限警告。',
        '当前选择页数超过 24 页时，「下一步」应不可用。',
        '当前任务达到 24 页时，「继续上传」应不可用并提供已确认提示。',
      ],
      source: {
        decisionFile,
        decisionObject: '按钮：达到 24 页上限时继续上传',
        relatedFiles,
      },
    },
    {
      id: 'UPLOAD_FILES_STEP-007',
      title: '多文件识别范围调整',
      sourceType: 'code+decision',
      changeType: 'new',
      changeDate: '6.2',
      objectType: 'dialog',
      objectName: '多文件识别范围弹窗',
      module: moduleName,
      pageName,
      route,
      anchorId: 'upload-files-step.range-dialog',
      anchorStatus: 'implemented',
      activate: activateUploadFilesStep('upload-files-step.range-dialog'),
      display: {
        title: '多文件识别范围弹窗',
        description:
          '弹窗展示本次任务中的全部资料及各自的起始页、结束页、当前识别页数和文件总页数。当前需要调整的文件使用高亮状态展示。',
        fields: ['文件名称', '起始页', '结束页', '识别X页 / 共Y页', '取消', '确定'],
        states: ['普通文件行', '当前定位文件高亮状态', '范围草稿状态'],
      },
      operation: {
        title: '统一调整多文件范围',
        description:
          '1、文件行识别页数入口和超限警告中的「选择识别范围」入口，统一打开多文件范围弹窗。\n2、用户可以在同一弹窗中调整每份资料的连续页码范围。\n3、从某一文件行进入时，系统自动定位并高亮该文件。\n4、确认调整后，系统按照最新文件列表和识别范围重新处理全部资料。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '确认后更新本次任务内每份资料的识别范围、识别总页数和重新处理范围。',
        exceptions: '识别范围只支持单个连续页码范围；某份资料不参与识别时，用户需要删除该资料。',
      },
      acceptance: [
        '所有识别范围入口应打开同一套多文件范围弹窗。',
        '弹窗应展示全部资料的范围信息。',
        '从文件行进入时，应自动定位并高亮对应文件。',
        '确认调整后，应按照最新文件列表和识别范围重新处理全部资料。',
      ],
      source: {
        decisionFile,
        decisionObject: '弹窗：识别范围调整方式',
        relatedFiles,
      },
    },
    {
      id: 'UPLOAD_FILES_STEP-011',
      title: '下一步按钮',
      sourceType: 'code+decision',
      changeType: 'new',
      changeDate: '6.2',
      objectType: 'button',
      objectName: '下一步按钮',
      module: moduleName,
      pageName,
      route,
      anchorId: 'upload-files-step.next',
      anchorStatus: 'implemented',
      activate: activateUploadFilesStep('upload-files-step.next'),
      display: {
        title: '下一步按钮状态',
        description:
          '已有有效资料且满足校验时，底部操作栏右侧展示绿色「下一步」按钮。无资料、页数超限、资料重新处理期间或存在处理失败文件时，按钮展示为禁用状态。',
        fields: ['下一步'],
        states: ['可用状态', '无资料禁用', '页数超限禁用', '重新处理期间禁用', '存在失败文件禁用'],
      },
      operation: {
        title: '进入选择识别方式步骤',
        description:
          '用户点击可用的「下一步」后，进入步骤 2「选择识别方式」。资料修改后重新处理尚未完成时，不允许进入下一步。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '将当前任务资料、识别范围和统一学段学科交给后续识别方式选择步骤。',
        exceptions: '任一前置校验未通过时，不允许进入下一步。',
      },
      acceptance: [
        '满足全部前置条件时，「下一步」应可用。',
        '无资料、超限、重新处理期间或存在失败文件时，「下一步」应不可用。',
        '点击可用按钮后，应进入步骤 2。',
      ],
      source: {
        decisionFile,
        decisionObject: '状态：删除最后一份资料 / 状态：资料重新处理期间的页面操作 / 异常：资料处理失败',
        relatedFiles,
      },
    },
  ],
  excludedDecisions: [
    {
      objectName: '步骤 2、步骤 3 和步骤 4',
      reason: '不属于本轮上传资料步骤页范围，由对应页面单独审核和沉淀。',
      sourceDecision: '暂不处理',
    },
    {
      objectName: '关闭识别任务',
      reason: '当前上传资料步骤页前端已移除关闭按钮，不再作为本页右侧 PRD 注释展示。',
      sourceDecision: '按钮：「关闭」',
    },
    {
      objectName: '加入试卷按钮状态',
      reason: '加入试卷入口归属核对识别结果步骤，已由核对识别结果页需求覆盖，不再在上传资料步骤页重复展示。',
      sourceDecision: '按钮：「加入试卷」状态',
    },
  ],
};
