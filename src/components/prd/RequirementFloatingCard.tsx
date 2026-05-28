'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { X } from 'lucide-react';

import type { RequirementItem } from '@/requirements';
import { getDisplaySections, getOperationSections, splitTextIntoReadableItems } from './requirement-utils';

interface FloatingCardPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

interface RequirementFloatingCardProps {
  requirement: RequirementItem;
  placement: FloatingCardPlacement;
  displayNumber?: number;
  onClose: () => void;
}

function SectionValue({ value }: { value: string | string[] }) {
  const items = Array.isArray(value)
    ? value.map((item) => item.trim()).filter(Boolean)
    : splitTextIntoReadableItems(value);

  if (items.length > 1) {
    return (
      <ul className="mt-1.5 list-disc space-y-1.5 pl-4 leading-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  return <p className="mt-1 leading-5">{items[0] ?? ''}</p>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function RequirementFloatingCard({
  requirement,
  placement,
  displayNumber,
  onClose,
}: RequirementFloatingCardProps) {
  const displaySections = getDisplaySections(requirement);
  const operationSections = getOperationSections(requirement);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerX: number;
    pointerY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [position, setPosition] = useState({ left: placement.left, top: placement.top });

  const handleDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if (!cardRef.current) {
      return;
    }

    const rect = cardRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState) {
      return;
    }

    const nextLeft = dragState.left + event.clientX - dragState.pointerX;
    const nextTop = dragState.top + event.clientY - dragState.pointerY;

    setPosition({
      left: clamp(nextLeft, 8, window.innerWidth - dragState.width - 8),
      top: clamp(nextTop, 8, window.innerHeight - dragState.height - 8),
    });
  };

  const handleDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`需求${displayNumber ?? requirement.id} ${requirement.title}`}
      className="fixed flex resize flex-col overflow-hidden rounded-lg border border-emerald-200 bg-white text-left text-xs text-gray-700 shadow-2xl"
      style={{
        left: position.left,
        top: position.top,
        width: placement.width,
        height: placement.height,
        minWidth: placement.minWidth,
        minHeight: placement.minHeight,
        maxWidth: placement.maxWidth,
        maxHeight: placement.maxHeight,
        zIndex: 2147483647,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="flex cursor-move touch-none select-none items-start justify-between gap-3 border-b border-gray-100 p-3 pb-2"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-emerald-700">
            {displayNumber ? `需求 ${displayNumber}` : requirement.id}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-900">{requirement.title}</div>
        </div>
        <button
          type="button"
          aria-label="关闭业务逻辑说明"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <section>
          <h4 className="text-xs font-semibold text-gray-900">显示说明</h4>
          <ol className="mt-2 space-y-2">
            {displaySections.map((section) => (
              <li key={section.category} className="flex gap-2">
                <span className="mt-0.5 text-[11px] font-semibold text-emerald-700">
                  {displaySections.indexOf(section) + 1}、
                </span>
                <div>
                  <div className="font-medium text-gray-800">{section.category}</div>
                  <SectionValue value={section.content} />
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h4 className="text-xs font-semibold text-gray-900">操作说明</h4>
          <ol className="mt-2 space-y-2">
            {operationSections.map((section) => (
              <li key={section.category} className="flex gap-2">
                <span className="mt-0.5 text-[11px] font-semibold text-emerald-700">
                  {operationSections.indexOf(section) + 1}、
                </span>
                <div>
                  <div className="font-medium text-gray-800">{section.category}</div>
                  <SectionValue value={section.content} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-emerald-300" />
    </div>
  );
}
