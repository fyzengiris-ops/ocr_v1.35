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
      id: 'IMPORT_DOCUMENT_DIALOG-008',
      title: '我的资源库列表与搜索',
      sourceType: 'code',
      objectType: 'region',
      objectName: '我的资源库',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.library.list',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到我的资源库', tab: 'library' },
        { type: 'scrollTo', label: '定位到我的资源库列表', anchorId: 'import-document-dialog.library.list' },
        { type: 'highlight', label: '高亮我的资源库列表', anchorId: 'import-document-dialog.library.list' },
      ],
      display: {
        title: '资源库列表展示',
        description:
          '我的资源库 Tab 展示资源库标题、搜索框和资源列表。资源项展示单选状态、文档图标、资源名称、日期和页数；搜索无结果时展示“暂无匹配的资源”。',
        fields: ['我的资源库', '请输入文档名称', '资源名称', '日期', '页数', '暂无匹配的资源'],
        states: ['资源未选态', '资源选中态', '搜索有结果态', '搜索无结果态'],
      },
      operation: {
        title: '资源搜索与选择',
        description:
          '用户可以输入文档名称筛选资源，并从资源列表中单选一份资料。资源库既有的资源选择、回显、数据源、搜索和显示样式按线上已实现逻辑处理。',
        permission: '沿用我的资源库既有权限和作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '用户选择的资源作为本次识别资料来源；点击确定后，仅提交当前选中的资源。',
        exceptions: '未选择资源时，确定按钮不可提交，并提示“请选择资料”。',
      },
      acceptance: [
        '我的资源库 Tab 应展示搜索框和资源列表。',
        '搜索无匹配结果时应展示“暂无匹配的资源”。',
        '用户应能从资源列表中单选一份资料。',
        '未选择资源时不允许提交，并提示“请选择资料”。',
      ],
      source: {
        decisionFile,
        decisionObject: '代码事实：我的资源库列表与搜索',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-009',
      title: '资源库 24 页以内资料全量识别',
      sourceType: 'code+decision',
      objectType: 'data',
      objectName: '24 页以内资源',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.library.within-limit',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到我的资源库', tab: 'library' },
        { type: 'scrollTo', label: '定位到 24 页以内资源', anchorId: 'import-document-dialog.library.within-limit' },
        { type: 'highlight', label: '高亮 24 页以内资源', anchorId: 'import-document-dialog.library.within-limit' },
      ],
      display: {
        title: '24 页以内资源展示',
        description:
          '页数不超过 24 页的资源在资源行展示“共X页”，不展示范围选择入口。',
        fields: ['共X页'],
        states: ['24 页以内资源态', '资源选中态'],
      },
      operation: {
        title: '24 页以内资源提交范围',
        description:
          '24 页以内资源默认全量识别，不提供范围选择；用户选择资源并选择学段学科后即可提交。',
        permission: '沿用我的资源库既有权限和作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '该资源的全部页数作为识别范围传递给后续上传录题流程。',
        exceptions: '如果未选择学段学科或未选择资源，仍不可提交。',
      },
      acceptance: [
        '24 页以内资源应展示“共X页”。',
        '24 页以内资源不应展示识别范围入口。',
        '24 页以内资源提交时应默认全量识别。',
      ],
      source: {
        decisionFile,
        decisionObject: '我的资源库：24 页以内资料范围',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-010',
      title: '资源库超 24 页资料范围提示',
      sourceType: 'code+decision',
      objectType: 'state',
      objectName: '超 24 页资源提示',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.library.over-limit-warning',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到我的资源库', tab: 'library' },
        { type: 'scrollTo', label: '定位到资源库超页提示', anchorId: 'import-document-dialog.library.over-limit-warning' },
        { type: 'highlight', label: '高亮资源库超页提示', anchorId: 'import-document-dialog.library.over-limit-warning' },
      ],
      display: {
        title: '超 24 页资源提示展示',
        description:
          '选中超过 24 页的资源后，资源行展示“识别X页 / 共Y页”，下方展示高亮提示和“选择识别范围”入口。',
        fields: ['识别X页 / 共Y页', '该资料共X页，最多支持识别24页，请选择需要识别的页码范围后，再继续操作', '选择识别范围'],
        states: ['超 24 页资源选中态', '范围未调整态', '范围已调整态', '超限禁用态'],
      },
      operation: {
        title: '超 24 页资源默认范围',
        description:
          '选中超过 24 页的资源后，默认设置识别范围为第 1 页到最后一页，并正常显示下方高亮提示文案，提醒用户该资料超过 24 页，需要删除部分内容或手动选择识别范围后再继续。',
        permission: '沿用我的资源库既有权限和作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '用户最终确认的资源页码范围会随资源一起传递给后续上传录题流程。',
        exceptions: '当前选择范围超过 24 页时，确定按钮不可提交，并提示当前选择页数超出限制。',
      },
      acceptance: [
        '选中超过 24 页资源后应展示高亮提示。',
        '超 24 页资源默认范围应为第 1 页到最后一页。',
        '超 24 页资源应提供选择识别范围入口。',
        '当前资源选择范围超过 24 页时，确定按钮应不可提交。',
      ],
      source: {
        decisionFile,
        decisionObject: '我的资源库：超 24 页资料首次选中规则',
        relatedFiles,
      },
    },
    {
      id: 'IMPORT_DOCUMENT_DIALOG-011',
      title: '资源库识别范围选择',
      sourceType: 'code+decision',
      objectType: 'dialog',
      objectName: '资源库识别范围弹窗',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.library.range-dialog',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到我的资源库', tab: 'library' },
        { type: 'openDialog', label: '打开资源库识别范围弹窗', dialog: 'LibraryRangeDialog' },
        { type: 'highlight', label: '高亮资源库识别范围弹窗', anchorId: 'import-document-dialog.library.range-dialog' },
      ],
      display: {
        title: '资源库范围弹窗展示',
        description:
          '资源库识别范围弹窗展示所选资源名称、起始页、结束页、当前识别页数、总页数，底部展示当前已选择总页数/可选择页数和确定、取消按钮。当前已选择总页数超过 24 页时，在可选择页数后显示“（超出限制）”。',
        fields: ['资源名称', '起始页', '结束页', '识别X页 / 共Y页', '当前已选择总页数：X / 24（超出限制）', '取消', '确定'],
        states: ['范围打开态', '范围调整态', '超限禁用态'],
      },
      operation: {
        title: '资源库范围调整与取消',
        description:
          '用户只能选择单个连续页码范围。点击确定后保存本次范围；点击取消或右上角关闭时，丢弃本次修改，恢复打开弹窗前的范围，不额外提示。',
        permission: '沿用我的资源库既有权限和作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '确认后的范围作为资源库资料的识别范围传递给后续上传录题流程。',
        exceptions:
          '当前仅支持选择连续页码范围。范围超过 24 页时，范围弹窗确定按钮不可用。',
      },
      acceptance: [
        '资源库范围弹窗应展示资源名称和页码范围选择。',
        '资源库范围选择只支持连续页码。',
        '点击取消或关闭应丢弃本次修改。',
        '范围超过 24 页时，范围弹窗确定按钮应禁用。',
      ],
      source: {
        decisionFile,
        decisionObject: '我的资源库：范围弹窗取消/关闭处理 / 识别范围：页码选择方式',
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
      id: 'IMPORT_DOCUMENT_DIALOG-013',
      title: '资源库切换资源范围重置',
      sourceType: 'code+decision',
      objectType: 'data',
      objectName: '资源范围草稿',
      module: moduleName,
      pageName,
      route,
      anchorId: 'import-document-dialog.library.range-draft',
      anchorStatus: 'implemented',
      activate: [
        { type: 'navigate', label: '进入作业管理页', to: '/homework' },
        { type: 'openDialog', label: '打开识别作业资料弹窗', dialog: 'ImportDocumentDialog' },
        { type: 'setTab', label: '切换到我的资源库', tab: 'library' },
        { type: 'scrollTo', label: '定位到资源库列表', anchorId: 'import-document-dialog.library.list' },
        { type: 'highlight', label: '高亮资源库列表', anchorId: 'import-document-dialog.library.list' },
      ],
      display: {
        title: '资源切换后的范围展示',
        description:
          '用户切换资源后，页面展示新选中资源的页数和范围状态；不展示前一个资源的范围草稿。',
        fields: ['资源选中状态', '识别X页 / 共Y页', '共X页'],
        states: ['资源切换态', '范围重置态'],
      },
      operation: {
        title: '资源范围草稿重置',
        description:
          '切换资源后不保留原资源范围草稿；再次选回时按默认范围重新计算。',
        permission: '沿用我的资源库既有权限和作业管理页中 AI 小乐识别资料入口的使用权限。',
        dataFlow: '只有当前选中资源的范围会随确定操作传递给后续上传录题流程。',
        exceptions: '切换资源时不弹出额外确认；用户如需恢复原范围，需要重新选择。',
      },
      acceptance: [
        '切换资源后，应以新资源重新计算默认范围。',
        '再次选回原资源时，不应恢复旧范围草稿。',
        '提交时只应提交当前选中资源及其当前范围。',
      ],
      source: {
        decisionFile,
        decisionObject: '我的资源库：切换资源时范围草稿',
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
