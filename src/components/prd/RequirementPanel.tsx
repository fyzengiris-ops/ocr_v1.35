'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

import type { RequirementItem, RequirementRegistry } from '@/requirements';
import { cn } from '@/lib/utils';
import {
  createRequirementDisplayNumberMap,
  createRequirementMap,
  getDisplaySections,
  getOperationSections,
  getRequirementDisplayGroups,
  splitTextIntoReadableItems,
} from './requirement-utils';

interface RequirementPanelProps {
  registries: RequirementRegistry[];
  displayNumberRegistries?: RequirementRegistry[];
  allRegistries?: RequirementRegistry[];
  selectedRequirementId: string | null;
  onSelectRequirement: (requirement: RequirementItem) => void;
  onClose: () => void;
}

function sourceTypeLabel(sourceType: RequirementItem['sourceType']) {
  if (sourceType === 'code') return '代码事实';
  if (sourceType === 'decision') return '决策补充';
  return '代码+决策';
}

const changeDateMarkerPattern = /(【\d{1,2}\.\d{1,2}】)/g;
const exactChangeDateMarkerPattern = /^【\d{1,2}\.\d{1,2}】$/;

function renderChangeDateMarkers(value: string) {
  return value.split(changeDateMarkerPattern).map((part, index) => {
    if (!exactChangeDateMarkerPattern.test(part)) {
      return part;
    }

    return (
      <span key={`${part}-${index}`} className="font-semibold text-orange-600">
        {part}
      </span>
    );
  });
}

function ReadableText({ value }: { value: string | string[] }) {
  const items = Array.isArray(value)
    ? value.map((item) => item.trim()).filter(Boolean)
    : splitTextIntoReadableItems(value);

  if (items.length > 1) {
    return (
      <ul className="mt-1.5 list-disc space-y-1.5 pl-4 leading-5 text-gray-700">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderChangeDateMarkers(item)}</li>
        ))}
      </ul>
    );
  }

  return <p className="mt-1.5 leading-5 text-gray-700">{renderChangeDateMarkers(items[0] ?? '')}</p>;
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

  const displaySections = getDisplaySections(requirement);
  const operationSections = getOperationSections(requirement);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-start gap-2">
          {displayNumber !== null && (
            <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white">
              {displayNumber}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">{requirement.title}</h3>
            <div className="mt-1 text-[11px] text-gray-500">{requirement.id}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
            {sourceTypeLabel(requirement.sourceType)}
          </span>
          {requirement.changeDate && (
            <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-600">
              {requirement.changeDate}
            </span>
          )}
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{requirement.module}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{requirement.objectName}</span>
        </div>
      </div>

      <DetailBlock title="显示说明">
        <div className="space-y-3">
          {displaySections.map((item) => (
            <div key={item.category}>
              <div className="font-medium text-gray-800">{item.category}</div>
              <ReadableText value={item.content} />
            </div>
          ))}
        </div>
      </DetailBlock>

      {operationSections.length > 0 && (
        <DetailBlock title="操作说明">
          <div className="space-y-3">
            {operationSections.map((item) => (
              <div key={item.category}>
                <div className="font-medium text-gray-800">{item.category}</div>
                <ReadableText value={item.content} />
              </div>
            ))}
          </div>
        </DetailBlock>
      )}
      {requirement.aiPrompts?.length ? (
        <DetailBlock title="AI 提示词">
          <div className="space-y-3">
            {requirement.aiPrompts.map((item) => (
              <div key={item.title}>
                <div className="font-medium text-gray-800">{item.title}</div>
                <div className="mt-1 text-gray-500">{item.trigger}</div>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-[11px] leading-4">{item.prompt}</pre>
                <div className="mt-1 text-gray-600">回填：{item.result}</div>
              </div>
            ))}
          </div>
        </DetailBlock>
      ) : null}
    </div>
  );
}

export function RequirementPanel({
  registries,
  displayNumberRegistries,
  allRegistries,
  selectedRequirementId,
  onSelectRequirement,
  onClose,
}: RequirementPanelProps) {
  const [expandedRequirementId, setExpandedRequirementId] = useState<string | null>(null);
  const displayNumbersByRequirementId = useMemo(
    () => createRequirementDisplayNumberMap(displayNumberRegistries ?? registries),
    [displayNumberRegistries, registries],
  );
  const allRequirementsById = useMemo(
    () => createRequirementMap((allRegistries ?? registries).flatMap(r => r.requirements)),
    [allRegistries, registries],
  );

  return (
    <aside className="flex h-full max-h-screen min-h-0 flex-col overflow-hidden bg-white text-gray-800">
      <div className="shrink-0 flex items-start justify-between gap-3 border-b border-gray-200 p-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">PRD 需求说明</div>
          <div className="mt-0.5 text-[11px] text-gray-500">单击定位高亮，双击查看需求详情</div>
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
                const requirementGroups = getRequirementDisplayGroups(registry, allRequirementsById);

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
                                  onDoubleClick={() => setExpandedRequirementId(
                                    expandedRequirementId === requirement.id ? null : requirement.id
                                  )}
                                >
                                  <div className="flex items-start gap-2">
                                    <span
                                      className={cn(
                                        'mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
                                        selected ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700',
                                      )}
                                    >
                                      {displayNumber}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="line-clamp-2 text-xs font-medium text-gray-800">
                                        {requirement.title}
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                                          {sourceTypeLabel(requirement.sourceType)}
                                        </span>
                                        <span className="truncate text-[10px] text-gray-400">
                                          {requirement.id}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </button>

                                {expandedRequirementId === requirement.id && (
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
