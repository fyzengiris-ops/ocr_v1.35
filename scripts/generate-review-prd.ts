import fs from 'node:fs';
import path from 'node:path';
import { questionAnswerReviewStepRegistry as registry } from '../src/requirements/question-answer-review-step.registry';
import { getRequirementDisplayGroups } from '../src/components/prd/requirement-utils';
import type { RequirementItem } from '../src/requirements/schema';

const root = process.cwd();
const pagePrdPath = path.join(root, '产品文档/prd/05-review-recognition-results.prd.md');
const masterPrdPath = path.join(root, '产品文档/prd/06-homework-recognition-flow.prd.md');
const emptyFallbacks = new Set(['无额外权限限制', '无额外数据流转', '无异常场景', '本对象无操作入口', '本对象仅展示']);

const useful = (value?: string) => Boolean(value?.trim() && !emptyFallbacks.has(value.trim()));
const sourceTypeLabel: Record<RequirementItem['sourceType'], string> = {
  code: '代码事实',
  decision: '确认决策',
  'code+decision': '代码事实 + 确认决策',
};

const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const groups = getRequirementDisplayGroups(registry);
const visibleRequirements = groups.flatMap((group) => group.requirements);
const visibleNumber = new Map(visibleRequirements.map((requirement, index) => [requirement.id, index + 1]));
const sectionTitle = (heading: string, title: string) => heading === '**' ? `**${title}**` : `${heading} ${title}`;

function renderPromptSection(requirement: RequirementItem, sectionHeading: string, promptHeading: string) {
  if (!requirement.aiPrompts?.length) return '';

  return `\n\n${sectionTitle(sectionHeading, 'AI 提示词与回填')}\n\n${requirement.aiPrompts.map((item) => `${sectionTitle(promptHeading, item.title)}\n\n- 触发条件：${item.trigger}\n- 回填结果：${item.result}\n\n\`\`\`text\n${item.prompt.trim()}\n\`\`\``).join('\n\n')}`;
}

function renderRequirement(requirement: RequirementItem, titleHeading: string, sectionHeading: string) {
  const number = visibleNumber.get(requirement.id);
  const date = requirement.changeDate ? `【${requirement.changeDate}】` : '';
  const promptHeading = titleHeading.length < 6 ? `${titleHeading}#` : '**';
  const parts = [
    `${titleHeading} ${number}. ${requirement.title}（\`${requirement.id}\`）`,
    '',
    `来源：${sourceTypeLabel[requirement.sourceType]}${date ? `；变更日期：${date}` : ''}`,
    '',
    sectionTitle(sectionHeading, '显示说明'),
    '',
    useful(requirement.display.description) ? requirement.display.description.trim() : '无额外展示规则。',
  ];

  if (requirement.display.states?.length) {
    parts.push('', sectionTitle(sectionHeading, '状态反馈'), '', requirement.display.states.map((item, index) => `${index + 1}. ${item}`).join('\n'));
  }
  if (useful(requirement.operation.description)) {
    parts.push('', sectionTitle(sectionHeading, '操作说明'), '', requirement.operation.description.trim());
  }
  if (useful(requirement.operation.permission)) {
    parts.push('', sectionTitle(sectionHeading, '使用范围'), '', requirement.operation.permission.trim());
  }
  if (useful(requirement.operation.dataFlow)) {
    parts.push('', sectionTitle(sectionHeading, '后续流程'), '', requirement.operation.dataFlow.trim());
  }
  if (useful(requirement.operation.exceptions)) {
    parts.push('', sectionTitle(sectionHeading, '异常边界'), '', requirement.operation.exceptions.trim());
  }

  parts.push(renderPromptSection(requirement, sectionHeading, promptHeading), '', sectionTitle(sectionHeading, '验收标准'), '', requirement.acceptance.map((item, index) => `${index + 1}. ${item}`).join('\n'));
  return parts.join('\n');
}

function renderGroupIndex(heading: string) {
  return groups
  .map((group) => {
    const rows = group.requirements
      .map((requirement) => `| ${visibleNumber.get(requirement.id)} | \`${requirement.id}\` | ${escapeCell(requirement.title)} |`)
      .join('\n');
    return `${heading} ${group.title}\n\n| 页面角标 | 需求编号 | 标题 |\n|---:|---|---|\n${rows}`;
  })
  .join('\n\n');
}

function renderBusinessDetails(groupHeading: string, requirementHeading: string, sectionHeading: string) {
  return groups
    .map((group) => `${groupHeading} ${group.title}\n\n${group.requirements.map((requirement) => renderRequirement(requirement, requirementHeading, sectionHeading)).join('\n\n')}`)
    .join('\n\n');
}

const pageGroupIndex = renderGroupIndex('###');
const masterGroupIndex = renderGroupIndex('#####');
const masterIndexGroupIndex = renderGroupIndex('####');
const pageBusinessDetails = renderBusinessDetails('###', '####', '#####');
const masterBusinessDetails = renderBusinessDetails('#####', '######', '**');

const acceptanceDetails = visibleRequirements
  .map((requirement) => `### ${visibleNumber.get(requirement.id)}. \`${requirement.id}\`\n\n${requirement.acceptance.map((item, index) => `${index + 1}. ${item}`).join('\n')}`)
  .join('\n\n');

const decisionFiles = [...new Set([registry.sourceDecisionFile, ...registry.requirements.map((requirement) => requirement.source.decisionFile)])];
const relatedFiles = [...new Set([...(registry.relatedFiles ?? []), ...registry.requirements.flatMap((requirement) => requirement.source.relatedFiles)])];
const excluded = registry.excludedDecisions.length
  ? registry.excludedDecisions.map((item) => `- ${item.objectName}：${item.reason}（来源：${item.sourceDecision}）`).join('\n')
  : '- 无额外排除项。';

const pagePrd = `# 步骤4「核对识别结果」PRD

## 1. 页面范围

### 1.1 当前页面

- 页面名称：${registry.pageName}
- 所属模块：${registry.module}
- 页面路由/组件：${registry.route}
- 需求面板范围：当前页面可见的 ${visibleRequirements.length} 个数字角标需求面板。
- 相关代码文件：
${relatedFiles.map((file) => `  - \`${file}\``).join('\n')}

### 1.2 上级页面/上游入口

- 上级页面：步骤3「选择识别内容」。
- 入口位置：用户在左侧资料中完成框选后，点击「开始识别」或「更新识别结果」。
- 进入方式：识别完成后进入步骤4，对右侧题卡进行核对。
- 传入数据：资料文件、左侧选框、题号、识别出的题干、题型、图片裁剪结果，以及题目+答案模式下的答案和解析匹配结果。
- 依赖状态：已完成识别；重识别场景使用当前选中的待更新选框。

### 1.3 下级页面/下游流程

- 下级页面/下游流程：\`/paper-edit\` 试卷编辑页。
- 触发方式：点击「加入试卷」，存在答案或解析缺口时先完成确认。
- 传出数据：当前核对后的题干、题型、选项、子题、空位、答案、解析、题目图片和学段学科。
- 后续状态：进入试卷编辑继续组卷；仅识别题目模式不传递标准答案、解析和空位答案。
- 返回逻辑：试卷编辑页可返回 \`/homework\`，恢复录题入口。

### 1.4 范围边界摘要

- 本文档覆盖：步骤4中页面可见数字角标对应的核对、编辑、题型规则、识别回填、提示词和加入试卷规则。
- 本文档不覆盖：步骤1至步骤3的文件上传、模式选择和框选细节，以及试卷编辑页内的后续组卷交互。

## 2. 功能概述

${registry.description} 本文档以当前页面数字角标需求面板为准，按「仅识别题目及通用核查」「仅识别题目：按题型核对」「题目+答案模式」「题目+答案：按题型核对」组织规则，确保页面、悬浮需求面板和文档表达一致。

## 3. 页面数字角标索引

${pageGroupIndex}

## 4. 业务逻辑说明

${pageBusinessDetails}

## 5. 范围边界

### 5.1 本文档覆盖

- 步骤4当前可见数字角标中的显示、操作、状态、数据交接、异常提示和验收规则。
- 图片模式与编辑模式下的题型差异，以及题目+答案模式下的答案、解析核对和回填规则。
- AI 识别与回填提示词的触发条件和回填目标。

### 5.2 本文档不覆盖

${excluded}
- 已从当前页面数字角标和右侧 PRD 面板隐藏的历史兼容需求，不作为本次页面核对入口。

## 6. 验收标准

${acceptanceDetails}

## 7. 来源追溯

- 需求注册表：\`src/requirements/question-answer-review-step.registry.ts\`
- 来源决策文件：
${decisionFiles.map((file) => `  - \`${file}\``).join('\n')}
- 当前仓库对应决策文档：\`产品文档/prd-workflow/decisions/question-answer-review-step.decision.md\`
- 相关代码文件：
${relatedFiles.map((file) => `  - \`${file}\``).join('\n')}
- 来源类型说明：\`code\` 表示代码事实，\`decision\` 表示确认决策，\`code+decision\` 表示代码事实 + 确认决策。
`;

const masterStep4 = `#### 步骤 4：核对识别结果（P5）

**页面职责：**

- 依据左侧资料选框和识别结果展示、排序、编辑右侧题卡。
- 在图片模式和编辑模式下核对题干、题型、选项、子题、空位、答案和解析。
- 支持图片裁剪、人工关联、AI 回填、题型切换保护、题目删除和加入试卷。
- 覆盖仅识别题目、题目+答案，以及单选/多选、判断、填空、解答、完型填空、阅读理解等题型规则。

**页面数字角标需求索引：**

${masterGroupIndex}

**完整规则：**

下列规则与 \`05-review-recognition-results.prd.md\` 同源，按当前页面可见数字角标顺序同步。

${masterBusinessDetails}

---

`;

const masterStep4Index = `### 步骤 4 核对识别结果

${masterIndexGroupIndex}
`;

let master = fs.readFileSync(masterPrdPath, 'utf8');
const pageIndexPattern = /\| P5 \| 步骤 4 核对识别结果 \| M2 \| 步骤 3 \| `\/paper-edit` \| [^\n]* \|/;
if (!pageIndexPattern.test(master)) throw new Error('未找到总 PRD 的 P5 页面索引行。');
master = master.replace(pageIndexPattern, `| P5 | 步骤 4 核对识别结果 | M2 | 步骤 3 | \`/paper-edit\` | \`REVIEW_STEP-001\`~\`033\`（当前可见角标 1~${visibleRequirements.length}） |`);

const detailStart = master.indexOf('#### 步骤 4：核对识别结果（P5）');
const detailEnd = master.indexOf('\n### 模块三：试卷编辑页交接（M3）', detailStart);
if (detailStart < 0 || detailEnd < 0) throw new Error('未找到总 PRD 的步骤4详情区间。');
master = `${master.slice(0, detailStart)}${masterStep4}${master.slice(detailEnd + 1)}`;

const indexStart = master.indexOf('### 步骤 4 核对识别结果');
const indexEnd = master.indexOf('\n## 第六部分：来源追溯', indexStart);
if (indexStart < 0 || indexEnd < 0) throw new Error('未找到总 PRD 的步骤4编号索引区间。');
master = `${master.slice(0, indexStart)}${masterStep4Index}${master.slice(indexEnd)}`;

fs.writeFileSync(pagePrdPath, pagePrd, 'utf8');
fs.writeFileSync(masterPrdPath, master, 'utf8');

console.log(JSON.stringify({
  pagePrd: path.relative(root, pagePrdPath),
  masterPrd: path.relative(root, masterPrdPath),
  visibleRequirementCount: visibleRequirements.length,
  visibleRequirementIds: visibleRequirements.map((item) => item.id),
}, null, 2));
