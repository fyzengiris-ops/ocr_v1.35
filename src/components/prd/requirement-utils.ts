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

export interface RequirementReadableSection {
  category: string;
  content: string | string[];
}

const emptyFallbacks = new Set([
  '无额外权限限制',
  '无额外数据流转',
  '无异常场景',
  '本对象无操作入口',
  '本对象仅展示',
]);

const lowInformationStates = new Set(['正常显示', '正常态']);

const requirementDisplayGroupConfigs: Record<string, RequirementDisplayGroupConfig[]> = {
  'upload-question-dialog-select-mode': [
    {
      id: 'page-markers',
      title: '选择识别方式',
      requirementIds: [
        'SELECT_MODE-007',
        'SELECT_MODE-002',
        'SELECT_MODE-003',
        'SELECT_MODE-008',
        'SELECT_MODE-005',
        'SELECT_MODE-004',
      ],
    },
  ],
  'upload-files-step': [
    {
      id: 'page-markers',
      title: '上传资料',
      requirementIds: [
        'UPLOAD_FILES_STEP-001',
        'UPLOAD_FILES_STEP-005',
        'UPLOAD_FILES_STEP-016',
        'UPLOAD_FILES_STEP-004',
        'UPLOAD_FILES_STEP-002',
        'UPLOAD_FILES_STEP-014',
        'UPLOAD_FILES_STEP-012',
        'UPLOAD_FILES_STEP-003',
        'UPLOAD_FILES_STEP-006',
        'UPLOAD_FILES_STEP-007',
        'UPLOAD_FILES_STEP-008',
        'UPLOAD_FILES_STEP-011',
      ],
    },
  ],
  'box-recognition-step': [
    {
      id: 'page-markers',
      title: '选择识别内容',
      requirementIds: [
        'BOX_STEP-010',
        'BOX_STEP-001',
        'BOX_STEP-002',
        'BOX_STEP-003',
        'BOX_STEP-007',
        'BOX_STEP-014',
        'BOX_STEP-013',
        'BOX_STEP-005',
        'BOX_STEP-004',
        'BOX_STEP-008',
        'BOX_STEP-011',
        'BOX_STEP-012',
      ],
    },
  ],
  'question-answer-review-step': [
    {
      id: 'single-mode',
      title: '仅识别题目模式及通用核查',
      requirementIds: [
        'REVIEW_STEP-006',
        'REVIEW_STEP-002',
        'REVIEW_STEP-013',
        'REVIEW_STEP-014',
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
        'REVIEW_STEP-001',
        'REVIEW_STEP-003',
        'REVIEW_STEP-015',
        'REVIEW_STEP-016',
        'REVIEW_STEP-017',
        'REVIEW_STEP-005',
        'REVIEW_STEP-018',
        'REVIEW_STEP-004',
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

function createSection(category: string, content?: string | string[]): RequirementReadableSection | null {
  if (Array.isArray(content)) {
    const items = filterUsefulItems(content);

    if (items.length === 0) {
      return null;
    }

    return {
      category,
      content: items,
    };
  }

  const normalized = content?.trim() ?? '';

  if (!isUsefulRequirementText(normalized)) {
    return null;
  }

  return {
    category,
    content: normalized,
  };
}

function filterUsefulStates(items?: string[]) {
  return filterUsefulItems(items).filter((item) => !lowInformationStates.has(item));
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
  const requirements = getRequirementDisplayGroups(registry).flatMap((group) => group.requirements);
  if (registry.displayOrder && registry.displayOrder.length > 0) {
    const orderMap = new Map(registry.displayOrder.map((id, i) => [id, i]));
    return [...requirements].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }
  return requirements;
}

export function createRequirementDisplayNumberMap(registries: RequirementRegistry[]) {
  const map = new Map<string, number>();
  for (const registry of registries) {
    const requirements = getOrderedRequirementsForDisplay(registry);
    requirements.forEach((requirement, index) => {
      map.set(requirement.id, index + 1);
    });
  }
  return map;
}

export function getDisplaySections(requirement: RequirementItem) {
  return [
    createSection('页面展示', requirement.display.description),
    createSection('状态反馈', filterUsefulStates(requirement.display.states)),
  ].filter(
    (item): item is RequirementReadableSection => Boolean(item),
  );
}

export function getOperationSections(requirement: RequirementItem) {
  return [
    createSection('操作规则', requirement.operation.description),
    createSection('使用范围', requirement.operation.permission),
    createSection('后续流程', requirement.operation.dataFlow),
    createSection('异常边界', requirement.operation.exceptions),
  ].filter((item): item is RequirementReadableSection => Boolean(item));
}
