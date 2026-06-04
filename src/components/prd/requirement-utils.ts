import type { RequirementItem, RequirementRegistry } from '@/requirements';

interface RequirementDisplayGroupConfig {
  id: string;
  title: string;
  requirementIds: string[];
}

export interface RequirementDisplayGroup {
  id: string;
  title?: string;
  requirements: RequirementItem[];
}

const emptyFallbacks = new Set([
  '无额外权限限制',
  '无额外数据流转',
  '无异常场景',
  '本对象无操作入口',
  '本对象仅展示',
]);

const requirementDisplayGroupConfigs: Record<string, RequirementDisplayGroupConfig[]> = {
  'upload-files-step': [
    {
      id: 'page-markers',
      title: '步骤 1 页面角标',
      requirementIds: [
        'UPLOAD_FILES_STEP-001',
        'UPLOAD_FILES_STEP-002',
        'UPLOAD_FILES_STEP-003',
        'UPLOAD_FILES_STEP-004',
        'UPLOAD_FILES_STEP-005',
        'UPLOAD_FILES_STEP-006',
        'UPLOAD_FILES_STEP-007',
        'UPLOAD_FILES_STEP-011',
        'UPLOAD_FILES_STEP-013',
        'UPLOAD_FILES_STEP-014',
      ],
    },
    {
      id: 'reserved-rules',
      title: '步骤 1 暂未放置角标的规则',
      requirementIds: [
        'UPLOAD_FILES_STEP-008',
        'UPLOAD_FILES_STEP-009',
        'UPLOAD_FILES_STEP-010',
        'UPLOAD_FILES_STEP-012',
      ],
    },
  ],
  'question-answer-review-step': [
    {
      id: 'single-mode',
      title: '仅识别题目模式及通用核查',
      requirementIds: [
        'REVIEW_STEP-002',
        'REVIEW_STEP-013',
        'REVIEW_STEP-014',
        'REVIEW_STEP-006',
        'REVIEW_STEP-007',
        'REVIEW_STEP-012',
        'REVIEW_STEP-008',
        'REVIEW_STEP-009',
      ],
    },
    {
      id: 'question-answer-mode',
      title: '题目+答案模式',
      requirementIds: [
        'REVIEW_STEP-011',
        'REVIEW_STEP-001',
        'REVIEW_STEP-003',
        'REVIEW_STEP-015',
        'REVIEW_STEP-016',
        'REVIEW_STEP-005',
        'REVIEW_STEP-004',
        'REVIEW_STEP-010',
      ],
    },
  ],
};

export function isUsefulRequirementText(content?: string) {
  const normalized = content?.trim();

  return Boolean(normalized && !emptyFallbacks.has(normalized));
}

export function filterUsefulItems(items?: string[]) {
  return (items ?? []).map((item) => item.trim()).filter((item) => isUsefulRequirementText(item));
}

export function splitTextIntoReadableItems(value: string) {
  return value
    .split(/\r?\n+/)
    .flatMap((line) => line.match(/[^。；;]+[。；;]?/g) ?? [line])
    .map((item) => item.trim())
    .filter(Boolean);
}

function createItem(category: string, content?: string) {
  const normalized = content?.trim();

  if (!isUsefulRequirementText(normalized)) {
    return null;
  }

  return {
    category,
    content: normalized,
  };
}

export function getRequirementShortId(id: string) {
  const suffix = id.split('-').at(-1);
  return suffix || id;
}

export function createRequirementMap(requirements: RequirementItem[]) {
  return new Map(requirements.map((requirement) => [requirement.id, requirement]));
}

export function getRequirementDisplayGroups(registry: RequirementRegistry): RequirementDisplayGroup[] {
  const groupConfigs = requirementDisplayGroupConfigs[registry.registryId];

  if (!groupConfigs) {
    return [
      {
        id: `${registry.registryId}:default`,
        requirements: registry.requirements,
      },
    ];
  }

  const requirementsById = createRequirementMap(registry.requirements);
  const usedRequirementIds = new Set<string>();
  const groups = groupConfigs
    .map((groupConfig) => {
      const requirements = groupConfig.requirementIds
        .map((requirementId) => requirementsById.get(requirementId))
        .filter((requirement): requirement is RequirementItem => Boolean(requirement));

      requirements.forEach((requirement) => usedRequirementIds.add(requirement.id));

      return {
        id: `${registry.registryId}:${groupConfig.id}`,
        title: groupConfig.title,
        requirements,
      };
    })
    .filter((group) => group.requirements.length > 0);

  const uncategorizedRequirements = registry.requirements.filter(
    (requirement) => !usedRequirementIds.has(requirement.id),
  );

  if (uncategorizedRequirements.length > 0) {
    groups.push({
      id: `${registry.registryId}:uncategorized`,
      title: '其他需求',
      requirements: uncategorizedRequirements,
    });
  }

  return groups;
}

export function getOrderedRequirementsForDisplay(registry: RequirementRegistry) {
  return getRequirementDisplayGroups(registry).flatMap((group) => group.requirements);
}

export function createRequirementDisplayNumberMap(registries: RequirementRegistry[]) {
  return new Map(
    registries.flatMap((registry) =>
      getOrderedRequirementsForDisplay(registry).map((requirement, index) => [requirement.id, index + 1] as const),
    ),
  );
}

export function getDisplaySections(requirement: RequirementItem) {
  return [createItem('页面展示', requirement.display.description)].filter(
    (item): item is { category: string; content: string } => Boolean(item),
  );
}

export function getOperationSections(requirement: RequirementItem) {
  return [
    createItem('操作规则', requirement.operation.description),
    createItem('使用范围', requirement.operation.permission),
    createItem('后续流程', requirement.operation.dataFlow),
    createItem('异常边界', requirement.operation.exceptions),
  ].filter((item): item is { category: string; content: string } => Boolean(item));
}
