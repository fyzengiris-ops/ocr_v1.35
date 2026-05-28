'use client';

import { useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';

import type { RequirementItem, RequirementRegistry } from '@/requirements';
import { cn } from '@/lib/utils';
import {
  createRequirementDisplayNumberMap,
  filterUsefulItems,
  getRequirementDisplayGroups,
  isUsefulRequirementText,
  splitTextIntoReadableItems,
} from './requirement-utils';

interface RequirementPanelProps {
  registries: RequirementRegistry[];
  selectedRequirementId: string | null;
  onSelectRequirement: (requirement: RequirementItem) => void;
  onClose: () => void;
}

function sourceTypeLabel(sourceType: RequirementItem['sourceType']) {
  if (sourceType === 'code') return '代码事实';
  if (sourceType === 'decision') return '决策补充';
  return '代码+决策';
}

function ReadableText({ value }: { value: string }) {
  const items = splitTextIntoReadableItems(value);

  if (items.length > 1) {
    return (
      <ul className="mt-1.5 list-disc space-y-1.5 pl-4 leading-5 text-gray-700">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    );
  }

  return <p className="mt-1.5 leading-5 text-gray-700">{items[0] ?? value}</p>;
}

function InlineList({ label, items }: { label: string; items?: string[] }) {
  const usefulItems = filterUsefulItems(items);

  if (usefulItems.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {usefulItems.map((item) => (
          <span key={item} className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-3">
      <h4 className="text-xs font-semibold text-gray-900">{title}</h4>
      <div className="mt-2 text-xs">{children}</div>
    </section>
  );
}

function RequirementDetail({
  requirement,
  displayNumber,
}: {
  requirement: RequirementItem | null;
  displayNumber: number | null;
}) {
  if (!requirement) {
    return (
      <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
        请选择右侧列表中的需求，查看对应页面展示、操作规则和定位效果。
      </div>
    );
  }

  const operationItems = [
    { title: requirement.operation.title, value: requirement.operation.description },
    { title: '使用范围', value: requirement.operation.permission },
    { title: '后续流程', value: requirement.operation.dataFlow },
    { title: '异常边界', value: requirement.operation.exceptions },
  ].filter((item) => isUsefulRequirementText(item.value));

  return (
    <div className="space-y-3">
      <div>
        {displayNumber !== null && (
          <div className="text-[11px] font-semibold text-emerald-700">需求 {displayNumber}</div>
        )}
        <h3 className="mt-1 text-sm font-semibold text-gray-900">{requirement.title}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
            {sourceTypeLabel(requirement.sourceType)}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{requirement.module}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{requirement.objectName}</span>
        </div>
      </div>

      <DetailBlock title="显示说明">
        <div className="font-medium text-gray-800">{requirement.display.title}</div>
        <ReadableText value={requirement.display.description} />
        <InlineList label="涉及字段" items={requirement.display.fields} />
        <InlineList label="涉及状态" items={requirement.display.states} />
      </DetailBlock>

      <DetailBlock title="操作说明">
        <div className="space-y-3">
          {operationItems.map((item) => (
            <div key={item.title}>
              <div className="font-medium text-gray-800">{item.title}</div>
              <ReadableText value={item.value} />
            </div>
          ))}
        </div>
      </DetailBlock>
    </div>
  );
}

export function RequirementPanel({
  registries,
  selectedRequirementId,
  onSelectRequirement,
  onClose,
}: RequirementPanelProps) {
  const displayNumbersByRequirementId = useMemo(
    () => createRequirementDisplayNumberMap(registries),
    [registries],
  );

  return (
    <aside className="flex h-full max-h-screen min-h-0 flex-col overflow-hidden bg-white text-gray-800">
      <div className="shrink-0 flex items-start justify-between gap-3 border-b border-gray-200 p-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">PRD 需求说明</div>
          <div className="mt-0.5 text-[11px] text-gray-500">点击需求卡片可定位并高亮原型对象</div>
        </div>
        <button
          type="button"
          aria-label="关闭 PRD 面板"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <div className="space-y-4">
          <section>
            <h3 className="text-xs font-semibold text-gray-900">需求列表</h3>
            <div className="mt-2 space-y-3">
              {registries.map((registry) => {
                const requirementGroups = getRequirementDisplayGroups(registry);

                return (
                  <div key={registry.registryId}>
                    <div className="mb-2 rounded-md border-l-4 border-emerald-500 bg-emerald-50 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold text-gray-900">{registry.pageName}</div>
                        <div className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          {registry.requirements.length} 条
                        </div>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-emerald-700">{registry.module}</div>
                    </div>

                    <div className="space-y-3">
                      {requirementGroups.map((group) => (
                        <div key={group.id} className="space-y-1.5">
                          {group.title && (
                            <div className="rounded bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">
                              {group.title}
                            </div>
                          )}
                          {group.requirements.map((requirement, requirementIndex) => {
                            const selected = selectedRequirementId === requirement.id;
                            const displayNumber = displayNumbersByRequirementId.get(requirement.id) ?? requirementIndex + 1;

                            return (
                              <div
                                key={requirement.id}
                                className={cn(
                                  'rounded-md',
                                  selected && 'border border-emerald-200 bg-emerald-50/50 p-1.5',
                                )}
                              >
                                <button
                                  type="button"
                                  className={cn(
                                    'w-full rounded-md border p-2 text-left transition-colors',
                                    selected
                                      ? 'border-emerald-300 bg-white'
                                      : 'border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40',
                                  )}
                                  onClick={() => onSelectRequirement(requirement)}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-semibold text-emerald-700">
                                        {displayNumber}
                                      </div>
                                      <div className="mt-0.5 line-clamp-2 text-xs font-medium text-gray-800">
                                        {requirement.title}
                                      </div>
                                    </div>
                                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                                      {sourceTypeLabel(requirement.sourceType)}
                                    </span>
                                  </div>
                                </button>

                                {selected && (
                                  <div className="mt-2">
                                    <div className="mb-2 text-xs font-semibold text-emerald-800">当前需求详情</div>
                                    <RequirementDetail requirement={requirement} displayNumber={displayNumber} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </aside>
  );
}
