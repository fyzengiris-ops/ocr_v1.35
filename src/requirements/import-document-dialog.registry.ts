import type { RequirementRegistry } from './schema';

const relatedFiles = [
  'src/components/ImportDocumentDialog.tsx',
  'src/app/homework/page.tsx',
  'src/components/UploadQuestionDialog.tsx',
  'src/lib/pdf-processor.ts',
];

const pageName = '识别作业资料弹窗';
const route = '/homework';
const moduleName = '识别作业资料';
const decisionFile = 'docs/prd-workflow/decisions/import-document-dialog.decision.md';

export const importDocumentDialogRegistry: RequirementRegistry = {
  registryId: 'import-document-dialog',
  pageName,
  route,
  module: moduleName,
  description:
    '记录识别作业资料弹窗的完整页面逻辑，覆盖本地上传、我的资源库选择、学段学科、页数校验、识别范围、确认取消和提交到后续上传录题流程的边界。',
  sourceDecisionFile: decisionFile,
  relatedFiles,
  requirements: [
    {
      id: 'IMPORT_DOCUMENT_DIALOG-001',
      title: '识别作业资料弹窗结构与关闭',
      sourceType: 'code+decision',
      objectType: 'dialog',
      objectName: '识别作业资料弹窗',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.container',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openPanel', label: '打开 AI 小乐侧边面板', panel: 'AIChatPanel' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'scrollTo', label: '定位到识别作业资料弹窗', anchorId: 'import-document-dialog.container' },
        { type: 'highlight', label: '高亮识别作业资料弹窗', anchorId: 'import-document-dialog.container' },
      ],
      display: {
        title: '弹窗基础展示',
        description:
          '弹窗标题为“识别作业资料”，顶部提供关闭入口，中间按 Tab 展示“本地上传”和“我的资源库”，底部展示“取消”和“确定”按钮。',
        fields: ['识别作业资料标题', '关闭按钮', '本地上传 Tab', '我的资源库 Tab', '取消按钮', '确定按钮'],
        states: ['弹窗打开态', '弹窗关闭态', 'Tab 切换态'],
      },
      operation: {
        title: '关闭与取消规则',
        description:
          '用户点击右上角关闭或底部取消时，立即关闭弹窗并丢弃本次弹窗内所有未提交内容，不做二次确认，也不保留草稿。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '关闭或取消不会向后续上传录题流程提交文件、资源、学科或识别范围。',
        exceptions: '关闭或取消后再次打开弹窗，应重新开始选择本次资料；已提交到后续流程的数据不受本弹窗关闭影响。',
      },
      acceptance: [
        '弹窗打开时应展示“识别作业资料”标题。',
        '弹窗应提供本地上传和我的资源库两个 Tab。',
        '点击关闭或取消后应关闭弹窗，并丢弃未提交内容。',
      ],
      source: {
        decisionFile,
        decisionObject: '取消/关闭：未提交内容处理',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-002',
      title: '本地上传入口与支持格式',
      sourceType: 'code+decision',
      objectType: 'region',
      objectName: '本地上传区域',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.local.upload-zone',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到本地上传', tab: 'local' },
        { type: 'scrollTo', label: '定位到本地上传区域', anchorId: 'import-document-dialog.local.upload-zone' },
        { type: 'highlight', label: '高亮本地上传区域', anchorId: 'import-document-dialog.local.upload-zone' },
      ],
      display: {
        title: '本地上传入口展示',
        description:
          '本地上传 Tab 展示虚线上传区域，文案为“文件拖拽到此处上传, 或点击添加”，并说明支持 PNG/JPG/JPEG、PDF、DOC/DOCX 格式，一次最多支持识别 24 页内容。',
        fields: ['上传区域', '文件拖拽到此处上传, 或点击添加', '支持格式说明'],
        states: ['默认态', '拖拽悬停态'],
      },
      operation: {
        title: '本地文件选择与拖拽上传',
        description:
          '用户可以点击上传区域选择文件，也可以将文件拖拽到上传区域。业务逻辑和实际开发均需支持图片、PDF、DOC、DOCX 文件上传。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '用户选择或拖入的本地文件进入本弹窗上传列表，后续随统一学段学科和页码范围传递给上传录题流程。',
        exceptions:
          '拖拽或选择不支持格式时，不支持的文件不加入上传列表，并提示“仅支持 PNG/JPG/JPEG、PDF、DOC/DOCX 格式，请重新上传”。',
      },
      acceptance: [
        '用户应能通过点击上传区域选择本地文件。',
        '用户应能通过拖拽方式添加本地文件。',
        '不支持格式不应进入上传列表，并应展示已确认的格式提示文案。',
      ],
      source: {
        decisionFile,
        decisionObject: '上传区域：本地上传支持格式 / 不支持格式处理',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-003',
      title: '本地文件列表与删除操作',
      sourceType: 'code+decision',
      objectType: 'region',
      objectName: '已上传文件列表',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.local.file-list',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到本地上传', tab: 'local' },
        { type: 'scrollTo', label: '定位到已上传文件列表', anchorId: 'import-document-dialog.local.file-list' },
        { type: 'highlight', label: '高亮已上传文件列表', anchorId: 'import-document-dialog.local.file-list' },
      ],
      display: {
        title: '已上传文件展示',
        description:
          '用户上传文件后，列表展示“已上传文件（X个）”、文件名称、文件大小、页数检测状态和当前识别页数。文件超过 1 个时展示“清空全部”，每个文件行展示删除入口。',
        fields: ['已上传文件（X个）', '文件名称', '文件大小', '检测中', '识别X页 / 共Y页', '清空全部', '删除按钮'],
        states: ['无文件态', '检测中态', '已检测态', '多文件态'],
      },
      operation: {
        title: '文件删除与重复拦截',
        description:
          '用户可删除单个文件；文件超过 1 个时可清空全部。重复文件不加入上传列表，并提示“该文件已添加，请勿重复上传”。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '删除或清空会从本次待提交资料中移除对应文件，并重新影响总页数统计和确定按钮状态。',
        exceptions: '删除文件后如果本地上传列表为空，用户必须重新上传资料后才能提交。',
      },
      acceptance: [
        '上传文件后应展示文件列表和文件数量。',
        '单个文件应支持删除。',
        '多文件场景应支持清空全部。',
        '重复文件不应加入列表，并应展示重复文件提示。',
      ],
      source: {
        decisionFile,
        decisionObject: '上传列表：重复文件处理',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-004',
      title: '文件页数检测与失败处理',
      sourceType: 'code+decision',
      objectType: 'state',
      objectName: '文件页数检测状态',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.local.page-detection',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到本地上传', tab: 'local' },
        { type: 'scrollTo', label: '定位到文件页数检测状态', anchorId: 'import-document-dialog.local.page-detection' },
        { type: 'highlight', label: '高亮文件页数检测状态', anchorId: 'import-document-dialog.local.page-detection' },
      ],
      display: {
        title: '页数检测状态展示',
        description:
          '文件加入列表后先展示“检测中...”；检测完成后展示该文件的总页数和当前识别页数。',
        fields: ['检测中...', '识别X页 / 共Y页'],
        states: ['检测中态', '检测完成态', '检测失败态'],
      },
      operation: {
        title: '页数检测规则',
        description:
          '系统需要识别每个文件的当前页数；DOC/DOCX 只要求能识别到当前文件页数。文件页数检测完成前，不允许提交。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '检测到的页数用于计算本次任务总页数，并决定是否需要用户调整识别范围。',
        exceptions:
          '文件页数检测失败时，检测失败文件自动移出列表，并提示“文件页数检测失败，已自动移除，请重新上传”。',
      },
      acceptance: [
        '文件页数检测中应展示检测中状态。',
        '页数检测完成后应展示文件总页数。',
        '页数检测失败文件应自动移出列表，并展示失败提示。',
        '存在检测中文件时，确定按钮不可提交。',
      ],
      source: {
        decisionFile,
        decisionObject: '上传区域：DOC/DOCX 页数识别 / 页数检测失败处理',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-005',
      title: '本地上传 24 页上限校验',
      sourceType: 'code+decision',
      objectType: 'state',
      objectName: '本地上传页数超限提示',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.local.page-limit-warning',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到本地上传', tab: 'local' },
        { type: 'scrollTo', label: '定位到页数超限提示', anchorId: 'import-document-dialog.local.page-limit-warning' },
        { type: 'highlight', label: '高亮页数超限提示', anchorId: 'import-document-dialog.local.page-limit-warning' },
      ],
      display: {
        title: '页数超限提示展示',
        description:
          '本地上传文件的当前选择页数合计超过 24 页时，页面展示高亮提示和“选择识别范围”入口。',
        fields: ['检测到文件共X页，当前最多支持识别24页，请删除部分文件或手动选择识别范围后，再继续操作。', '选择识别范围'],
        states: ['未超限态', '超限提示态', '确定按钮禁用态'],
      },
      operation: {
        title: '总页数上限处理',
        description:
          '整个识别任务合计最多支持识别 24 页。多文件总页数或当前选择页数超限时，用户需要删除部分文件或手动选择识别范围后才能继续。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '页数上限按本次任务当前提交范围合计计算，影响是否能把资料提交给后续上传录题流程。',
        exceptions:
          '超过 24 页时，确定按钮不可提交，并展示“检测到文件共X页，当前最多支持识别24页，请删除部分文件或手动选择识别范围后，再继续操作。”',
      },
      acceptance: [
        '本地上传当前选择页数超过 24 页时，应展示已确认的超限文案。',
        '超限状态下应提供选择识别范围入口。',
        '超限状态下确定按钮不可提交。',
      ],
      source: {
        decisionFile,
        decisionObject: '本地上传：任务页数上限',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-006',
      title: '本地上传识别范围选择',
      sourceType: 'code+decision',
      objectType: 'dialog',
      objectName: '本地上传识别范围弹窗',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.local.range-dialog',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到本地上传', tab: 'local' },
        { type: 'openDialog', label: '打开本地上传识别范围弹窗', dialog: 'LocalRangeDialog' },
        { type: 'highlight', label: '高亮本地上传识别范围弹窗', anchorId: 'import-document-dialog.local.range-dialog' },
      ],
      display: {
        title: '本地识别范围弹窗展示',
        description:
          '识别范围弹窗展示每份文件的文件名、起始页、结束页、当前识别页数和总页数，底部展示当前已选择总页数/可选择页数和确定、取消按钮。当前已选择总页数超过 24 页时，在可选择页数后显示“（超出限制）”。通过某份文件的识别页数入口打开时，该文件显示在列表第一位并高亮。',
        fields: ['文件名', '起始页', '结束页', '识别X页 / 共Y页', '当前已选择总页数：X / 24（超出限制）', '取消', '确定'],
        states: ['默认全量范围态', '范围调整态', '超限禁用态'],
      },
      operation: {
        title: '本地识别范围调整',
        description:
          '每个文件默认起始页为第一页，结束页为最后一页。上传列表中文件行的“识别X页 / 共Y页”信息可点击打开识别范围弹窗；弹窗打开时回显所有文件当前已保存的起始页和结束页；如果用户从某份文件的识别页数入口打开弹窗，该文件排在第一位并高亮显示。用户只能选择单个连续页码范围；不支持在范围弹窗内将某份文件排除为 0 页。如某份文件不需要识别，用户必须回到上传列表删除该文件。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '用户确认后的页码范围会作为本次本地文件提交范围，随文件一起传递给后续上传录题流程。',
        exceptions:
          '当前仅支持选择连续页码范围。当前已选择总页数超过 24 页时，范围弹窗确定按钮不可用。',
      },
      acceptance: [
        '范围弹窗应按文件展示起始页和结束页选择。',
        '首次进入范围选择时，每个文件应默认从第一页到最后一页。',
        '点击某份文件的“识别X页 / 共Y页”后，应打开范围弹窗并回显每份文件当前已保存的范围。',
        '从某份文件入口打开范围弹窗时，被点击文件应排在第一位并高亮显示。',
        '范围选择只支持连续页码。',
        '范围选择合计超过 24 页时，范围弹窗确定按钮应禁用。',
      ],
      source: {
        decisionFile,
        decisionObject: '本地上传：识别范围默认值 / 文件不参与识别处理 / 识别范围：页码选择方式',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-007',
      title: '学段学科必填选择',
      sourceType: 'code+decision',
      objectType: 'field',
      objectName: '学段学科',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.subject',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'scrollTo', label: '定位到学段学科字段', anchorId: 'import-document-dialog.subject' },
        { type: 'highlight', label: '高亮学段学科字段', anchorId: 'import-document-dialog.subject' },
      ],
      display: {
        title: '学段学科字段展示',
        description:
          '本地上传和我的资源库 Tab 都展示必填字段“学段学科*”，未选择时显示“请选择学科”，下拉选项展示当前老师账号在乐课网任教的学段学科数据。',
        fields: ['学段学科*', '请选择学科', '当前老师账号任教的学段学科'],
        states: ['未选择态', '已选择态', '下拉展开态'],
      },
      operation: {
        title: '学段学科适用规则',
        description:
          '用户必须选择学段学科后才能提交。弹窗选择的学段学科适用于本次识别任务内所有文件或资源，多文件无需分别指定学科。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '学段学科会随本次资料提交给后续上传录题流程，用于后续识别和题型约束；后续点击加入试卷后，应给试卷带上对应的学科信息。',
        exceptions: '未选择学段学科时，确定按钮不可提交，并提示“请选择学科”。',
      },
      acceptance: [
        '弹窗应展示学段学科必填字段。',
        '用户应能从学段学科下拉中选择学科。',
        '未选择学科时不允许提交，并提示“请选择学科”。',
        '选择的学科应适用于本次任务内所有文件或资源。',
        '后续点击加入试卷后，试卷应带上本次选择的学科信息。',
      ],
      source: {
        decisionFile,
        decisionObject: '学段学科：适用范围',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-012',
      title: '资源库页数异常处理',
      sourceType: 'decision',
      objectType: 'state',
      objectName: '资源页数异常',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.library.page-error',
      anchorStatus: 'planned',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到我的资源库', tab: 'library' },
        { type: 'scrollTo', label: '定位到页数异常资源', anchorId: 'import-document-dialog.library.page-error' },
        { type: 'highlight', label: '高亮页数异常资源', anchorId: 'import-document-dialog.library.page-error' },
      ],
      display: {
        title: '页数异常资源展示',
        description:
          '当资源页数异常或缺失时，资源行需要展示错误提示“该资料页数异常，请重新选择。”',
        fields: ['该资料页数异常，请重新选择'],
        states: ['页数异常态', '不可提交态'],
      },
      operation: {
        title: '页数异常资源不可提交',
        description:
          '页数异常或缺失的资源不可提交，用户需要重新选择其他资料。',
        permission: '沿用我的资源库既有权限和作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '页数异常资源不会进入后续上传录题流程。',
        exceptions: '资源页数异常或缺失时，确定按钮不可提交，并提示“该资料页数异常，请重新选择。”',
      },
      acceptance: [
        '资源页数异常或缺失时，应展示“该资料页数异常，请重新选择。”',
        '资源页数异常或缺失时，确定按钮应不可提交。',
        '页数异常资源不应进入后续上传录题流程。',
      ],
      source: {
        decisionFile,
        decisionObject: '我的资源库：资料页数异常或缺失',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-014',
      title: 'Tab 切换草稿与提交来源',
      sourceType: 'code+decision',
      objectType: 'tab',
      objectName: '本地上传 / 我的资源库 Tab',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.tabs',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'scrollTo', label: '定位到 Tab 区域', anchorId: 'import-document-dialog.tabs' },
        { type: 'highlight', label: '高亮 Tab 区域', anchorId: 'import-document-dialog.tabs' },
      ],
      display: {
        title: 'Tab 切换展示',
        description:
          '弹窗展示“本地上传”和“我的资源库”两个 Tab，当前 Tab 以选中样式展示；切换后显示对应内容区。',
        fields: ['本地上传', '我的资源库'],
        states: ['本地上传选中态', '我的资源库选中态'],
      },
      operation: {
        title: 'Tab 草稿保留与当前提交',
        description:
          '切换本地上传和我的资源库时，两个 Tab 的草稿选择都保留；点击确定时只提交当前 Tab 的内容。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '本地上传和我的资源库是互斥提交来源；确定时根据当前 Tab 将对应文件或资源提交给后续流程。',
        exceptions: '切换 Tab 不清空另一个 Tab 草稿；但未处于当前 Tab 的草稿不会随确定提交。',
      },
      acceptance: [
        '切换 Tab 后，应保留另一个 Tab 的草稿选择。',
        '点击确定时，只应提交当前 Tab 的资料来源。',
        '当前 Tab 不满足提交条件时，确定按钮应不可提交。',
      ],
      source: {
        decisionFile,
        decisionObject: 'Tab 切换：本地上传与我的资源库草稿',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-015',
      title: '底部确定按钮与字段级校验',
      sourceType: 'code+decision',
      objectType: 'button',
      objectName: '确定按钮',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.footer.confirm',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'scrollTo', label: '定位到底部确定按钮', anchorId: 'import-document-dialog.footer.confirm' },
        { type: 'highlight', label: '高亮底部确定按钮', anchorId: 'import-document-dialog.footer.confirm' },
      ],
      display: {
        title: '确定按钮状态展示',
        description:
          '底部展示“取消”和“确定”按钮；当必填项或页数校验未满足时，确定按钮为禁用态，并在对应字段或区域展示简短提示。',
        fields: ['取消', '确定', '请选择学科', '请上传资料', '文件页数检测中，请稍后', '请选择资料'],
        states: ['可提交态', '禁用态', '错误提示态'],
      },
      operation: {
        title: '提交前校验',
        description:
          '用户点击确定前，必须满足当前 Tab 的提交条件：已选择学段学科；本地上传需已有文件、无检测中文件且当前选择页数不超过 24 页；我的资源库需已选择资源且资源页数和范围有效。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '通过校验后，系统将当前 Tab 对应的资料来源、学段学科和页码范围提交给后续上传录题流程。',
        exceptions:
          '未选学科提示“请选择学科”；未上传文件提示“请上传资料”；文件检测中提示“文件页数检测中，请稍后”；资源未选提示“请选择资料”；页数超限时使用已确认的 24 页超限文案。',
      },
      acceptance: [
        '未选择学科时，确定按钮不可提交并提示“请选择学科”。',
        '本地上传无文件时，应提示“请上传资料”。',
        '文件检测中时，应提示“文件页数检测中，请稍后”。',
        '我的资源库未选资源时，应提示“请选择资料”。',
        '所有校验通过后，确定按钮应可提交。',
      ],
      source: {
        decisionFile,
        decisionObject: '确定按钮：字段级提示',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-016',
      title: '提交到后续上传录题流程',
      sourceType: 'code+decision',
      objectType: 'data',
      objectName: '资料提交交接',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.submit-handoff',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'scrollTo', label: '定位到底部确定按钮', anchorId: 'import-document-dialog.footer.confirm' },
        { type: 'highlight', label: '高亮提交交接逻辑', anchorId: 'import-document-dialog.submit-handoff' },
      ],
      display: {
        title: '提交后页面变化',
        description:
          '用户点击确定并通过校验后，识别作业资料弹窗关闭，后续进入上传录题流程继续处理资料。',
        fields: ['确定按钮', '上传录题流程'],
        states: ['提交前态', '提交成功进入后续流程态'],
      },
      operation: {
        title: '提交数据交接规则',
        description:
          '点击确定后，本弹窗将当前 Tab 对应的文件或资源、统一学段学科、已确认的页码范围传递给后续上传录题流程。后续选择场景、文件用途、题目识别等页面逻辑不属于本弹窗范围。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '本地上传提交本地文件列表及每个文件的页码范围；我的资源库提交当前选中资源及其页码范围；统一学段学科随本次任务一起传递。',
        exceptions: '如果当前 Tab 未通过校验，不应进入后续上传录题流程。',
      },
      acceptance: [
        '本地上传提交时，应传递文件列表、学段学科和每个文件的页码范围。',
        '我的资源库提交时，应传递当前选中资源、学段学科和资源页码范围。',
        '提交成功后，应关闭识别作业资料弹窗并进入后续上传录题流程。',
        '后续选择场景、文件用途和题目识别逻辑不应写入本弹窗注册表。',
      ],
      source: {
        decisionFile,
        decisionObject: '提交交接：文件与范围传递',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-017',
      title: '补充资料场景资源库 Tab 隐藏',
      sourceType: 'code+decision',
      objectType: 'tab',
      objectName: '本地上传 / 我的资源库 Tab',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.tabs',
      anchorStatus: 'implemented',
      changeType: 'new',
      changeDate: '6.2',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到本地上传', tab: 'local' },
        { type: 'scrollTo', label: '定位到 Tab 区域', anchorId: 'import-document-dialog.tabs' },
        { type: 'highlight', label: '高亮 Tab 区域', anchorId: 'import-document-dialog.tabs' },
      ],
      display: {
        title: '补充资料场景下 Tab 展示变化',
        description:
          '在步骤页点击"补充资料"打开本弹窗时，"我的资源库"Tab 不展示，仅保留"本地上传"Tab 及其上传操作区。在 AI 面板首次上传或步骤页"继续上传"入口打开本弹窗时，两个 Tab 均正常展示。',
        fields: ['本地上传 Tab', '我的资源库 Tab'],
        states: ['补充资料态（资源库 Tab 隐藏）', '正常态（两个 Tab 均展示）'],
      },
      operation: {
        title: '补充资料入口区分规则',
        description:
          '1、用户从「补充资料」入口进入时，只能从本地追加文件。\n2、用户首次上传资料或从「继续上传」入口进入时，仍可选择本地文件或资源库资料。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '进入弹窗的入口场景决定用户可以选择的资料来源，不改变已选本地文件的提交规则。',
        exceptions: '隐藏资源库 Tab 时，弹窗底部提交校验、页数上限校验逻辑不受影响。',
      },
      acceptance: [
        '步骤页"补充资料"入口打开弹窗时，不展示"我的资源库"Tab。',
        'AI 面板首次上传或步骤页"继续上传"入口打开弹窗时，两个 Tab 正常展示。',
        '隐藏资源库 Tab 后，本地上传各校验和确定按钮逻辑不受影响。',
      ],
      source: {
        decisionFile,
        decisionObject: '补充资料入口：隐藏资源库 Tab / 补充资料：只保留本地上传操作区',
        relatedFiles: [...relatedFiles, 'src/app/homework/page.tsx'],
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-018',
      title: '补充/继续上传已有资料页数提示',
      sourceType: 'code+decision',
      objectType: 'region',
      objectName: '已有资料页数提示条',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.local.existing-page-hint',
      anchorStatus: 'implemented',
      changeType: 'new',
      changeDate: '6.2',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到本地上传', tab: 'local' },
        { type: 'scrollTo', label: '定位到已有资料页数提示', anchorId: 'import-document-dialog.local.existing-page-hint' },
        { type: 'highlight', label: '高亮已有资料页数提示', anchorId: 'import-document-dialog.local.existing-page-hint' },
      ],
      display: {
        title: '已有资料页数提示展示',
        description:
          '当前任务已有资料时，本地上传区域上方展示蓝色信息条，提示已有识别页数和最多还可补充的页数。用户已选择新文件时，信息条展示已有页数、新选页数和剩余可补页数。合计页数超过 24 页时，信息条变为红色警告样式。文案按「补充资料」和「继续上传」两种场景区分措辞。',
        fields: ['原有资料已识别 X 页', '已选择 X 页', '新补充识别 X 页', '新选择 X 页', '最多还可补充 X 页', '最多还可选择 X 页', '超出上限 X 页', '共限 24 页'],
        states: ['无已有资料态（提示不显示）', '未选新文件态（蓝色）', '已选新文件未超限态（蓝色）', '超限警告态（红色）'],
      },
      operation: {
        title: '补充/继续上传的页数上限联动',
        description:
          '系统汇总当前任务已有页数和本次新选择页数。合计页数超过 24 页时，用户需要删除文件或调整识别范围后才能提交。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '当前任务已有页数和本次新选择页数共同参与 24 页上限校验，并用于更新剩余可补页数。',
        exceptions: '已有资料页数为 0 时，信息条不展示。超限时确定按钮不可提交，需用户删除文件或调整识别范围。',
      },
      acceptance: [
        '补充资料时，应在上传区域上方展示已有资料页数提示条。',
        '未选新文件时，提示条应展示已有页数和最多可补页数。',
        '已选新文件时，提示条应展示原有页数 + 新选页数 + 剩余可补页数。',
        '超限时，提示条应变为红色并展示超出页数。',
        '已有资料页数为 0 时，提示条不应展示。',
      ],
      source: {
        decisionFile,
        decisionObject: '补充资料：已有页数提示与校验 / 继续上传：已有页数提示 / 提示文案分场景',
        relatedFiles: [...relatedFiles, 'src/app/homework/page.tsx'],
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-019',
      title: '页数检测中底部状态与提交拦截',
      sourceType: 'code+decision',
      objectType: 'state',
      objectName: '页数检测中状态',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.footer.detection-status',
      anchorStatus: 'implemented',
      changeType: 'new',
      changeDate: '6.2',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到本地上传', tab: 'local' },
        { type: 'scrollTo', label: '定位到底部页数检测状态', anchorId: 'import-document-dialog.footer.detection-status' },
        { type: 'highlight', label: '高亮底部页数检测状态', anchorId: 'import-document-dialog.footer.detection-status' },
      ],
      display: {
        title: '检测中状态底部展示',
        description:
          '文件页数检测期间，弹窗底部左侧展示蓝色加载提示"正在检测文件页数..."，同时确定按钮为禁用态。检测完成后，蓝色提示消失，确定按钮恢复校验状态。',
        fields: ['正在检测文件页数...', '确定按钮'],
        states: ['检测中态（蓝色提示 + 按钮禁用）', '检测完成态（提示消失 + 按钮恢复）'],
      },
      operation: {
        title: '检测期间提交拦截规则',
        description:
          '上传文件后，系统需要检测每个文件的页数。检测期间用户不可提交——确定按钮始终置灰。检测完成后，系统按照页数上限规则重新判断是否可提交。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '页数检测结果用于更新文件页数、24 页上限校验和确定按钮状态。',
        exceptions: '检测失败的页数不会进入本次任务；检测失败文件自动移出列表。',
      },
      acceptance: [
        '文件页数检测期间，底部应展示"正在检测文件页数..."提示。',
        '文件页数检测期间，确定按钮应始终禁用。',
        '文件页数检测完成后，蓝色提示应消失。',
        '文件页数检测完成后，确定按钮应按页数上限规则判断可用状态。',
      ],
      source: {
        decisionFile,
        decisionObject: '页数检测期间提交控制',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-020',
      title: '文件列表展示完整页数',
      sourceType: 'code',
      objectType: 'data',
      objectName: '文件原始总页数',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.submit-handoff',
      anchorStatus: 'implemented',
      changeType: 'new',
      changeDate: '6.2',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'scrollTo', label: '定位到底部确定按钮', anchorId: 'import-document-dialog.footer.confirm' },
        { type: 'highlight', label: '高亮确定按钮', anchorId: 'import-document-dialog.footer.confirm' },
      ],
      display: {
        title: '文件完整页数展示',
        description:
          '资料进入当前任务后，文件列表每行展示「识别 X 页 / 共 Y 页」，让用户同时了解当前识别范围和文件完整页数。',
        fields: ['识别 X 页/共 Y 页'],
        states: ['文件页数已取得', '识别范围已调整'],
      },
      operation: {
        title: '保留完整页数用于后续管理',
        description:
          '用户调整识别范围后，系统仍保留每份文件的完整页数，用于后续查看、范围调整和 24 页上限判断。',
        permission: '沿用作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '每份文件的完整页数随资料进入当前识别任务，并用于文件列表和识别范围调整。',
        exceptions: '文件页数检测失败时，该文件不进入本次任务；每份文件的完整页数不受识别范围调整影响。',
      },
      acceptance: [
        '弹窗提交时，应传递每个文件的原始总页数。',
        '当前识别任务应保留每个文件的原始总页数。',
        '后续资料管理页应能展示文件的真实总页数。',
        '用户调整识别范围不影响文件原始总页数数据。',
      ],
      source: {
        decisionFile,
        decisionObject: '代码事实：文件原始总页数传递链路',
        relatedFiles: [...relatedFiles, 'src/app/homework/page.tsx', 'src/components/UploadQuestionDialog.tsx'],
      },
    },
  ],
  excludedDecisions: [
    {
      objectName: '我的资源库既有能力',
      reason: '已确认为线上既有能力，本次不展开资源选择、资源回显、资源数据源、搜索和显示样式的改造规则。',
      sourceDecision:
        '我的资源库模块的资源选择、资源回显、资源数据源、搜索、显示样式等既有能力按线上已实现逻辑处理，不纳入本次确认范围。',
    },
    {
      objectName: '后续选择场景和识别流程',
      reason: '已确认后续选择场景、文件用途分配、题目识别、答案匹配等页面不纳入本次识别作业资料弹窗范围。',
      sourceDecision:
        '点击确定后，本弹窗只交接文件或资源、学段学科、页码范围；后续选择场景、文件用途、题目识别等页面逻辑不纳入本决策记录审核范围。',
    },
  ],
};
