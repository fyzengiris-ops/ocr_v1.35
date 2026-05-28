'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { RequirementItem } from '@/requirements';
import { cn } from '@/lib/utils';
import { RequirementFloatingCard } from './RequirementFloatingCard';
import { useRequirementReader } from './RequirementReaderShell';
import { getRequirementShortId } from './requirement-utils';

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

interface RequirementMarkerProps {
  requirement: RequirementItem;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  displayNumber?: number;
  className?: string;
}

const CARD_GAP = 10;
const VIEWPORT_MARGIN = 12;
const DEFAULT_CARD_WIDTH = 360;
const DEFAULT_CARD_HEIGHT = 320;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCardPlacement(anchorRect: DOMRect): FloatingCardPlacement {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewportMaxWidth = Math.max(220, viewportWidth - VIEWPORT_MARGIN * 2);
  const viewportMaxHeight = Math.max(200, viewportHeight - VIEWPORT_MARGIN * 2);
  const width = Math.min(DEFAULT_CARD_WIDTH, viewportMaxWidth);
  const height = Math.min(DEFAULT_CARD_HEIGHT, viewportMaxHeight);
  const sideTop = clamp(
    anchorRect.top + anchorRect.height / 2 - height / 2,
    VIEWPORT_MARGIN,
    viewportHeight - height - VIEWPORT_MARGIN,
  );
  const createPlacement = (left: number, top: number): FloatingCardPlacement => {
    const normalizedLeft = clamp(
      left,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
    );
    const normalizedTop = clamp(
      top,
      VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN),
    );
    const maxWidth = Math.max(220, viewportWidth - normalizedLeft - VIEWPORT_MARGIN);
    const maxHeight = Math.max(200, viewportHeight - normalizedTop - VIEWPORT_MARGIN);

    return {
      left: normalizedLeft,
      top: normalizedTop,
      width,
      height,
      minWidth: Math.min(280, maxWidth),
      minHeight: Math.min(220, maxHeight),
      maxWidth,
      maxHeight,
    };
  };

  if (anchorRect.left >= width + CARD_GAP + VIEWPORT_MARGIN) {
    return createPlacement(anchorRect.left - width - CARD_GAP, sideTop);
  }

  if (viewportWidth - anchorRect.right >= width + CARD_GAP + VIEWPORT_MARGIN) {
    return createPlacement(anchorRect.right + CARD_GAP, sideTop);
  }

  const verticalLeft = anchorRect.left;

  if (viewportHeight - anchorRect.bottom >= height + CARD_GAP + VIEWPORT_MARGIN) {
    return createPlacement(verticalLeft, anchorRect.bottom + CARD_GAP);
  }

  if (anchorRect.top >= height + CARD_GAP + VIEWPORT_MARGIN) {
    return createPlacement(verticalLeft, anchorRect.top - height - CARD_GAP);
  }

  return createPlacement(VIEWPORT_MARGIN, VIEWPORT_MARGIN);
}

export function RequirementMarker({
  requirement,
  isOpen,
  onToggle,
  onClose,
  displayNumber,
  className,
}: RequirementMarkerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<FloatingCardPlacement | null>(null);
  const lastAutoOpenedRevisionRef = useRef<number | null>(null);
  const requirementReader = useRequirementReader();
  const selectedByReader = requirementReader?.selectedRequirementId === requirement.id;
  const selectionRevision = requirementReader?.selectionRevision ?? 0;
  const displayLabel = displayNumber ? `需求 ${displayNumber}` : requirement.id;

  useEffect(() => {
    if (!selectedByReader) {
      return;
    }

    if (isOpen || lastAutoOpenedRevisionRef.current === selectionRevision) {
      return;
    }

    if (!buttonRef.current) {
      return;
    }

    setPlacement(getCardPlacement(buttonRef.current.getBoundingClientRect()));
    lastAutoOpenedRevisionRef.current = selectionRevision;
    onToggle();
  }, [isOpen, onToggle, selectedByReader, selectionRevision]);

  return (
    <div className={cn('absolute z-30', className)}>
      <button
        ref={buttonRef}
        type="button"
        title={`${displayLabel} ${requirement.title}`}
        aria-label={`查看${displayLabel}业务逻辑`}
        className={cn(
          'flex h-5 min-w-7 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold shadow-sm transition-colors',
          isOpen || selectedByReader
            ? 'border-emerald-500 bg-emerald-600 text-white'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100',
        )}
        onClick={(event) => {
          event.stopPropagation();
          if (!isOpen && buttonRef.current) {
            setPlacement(getCardPlacement(buttonRef.current.getBoundingClientRect()));
          }
          requirementReader?.setSelectedRequirement(requirement.id, requirement.anchorId);
          onToggle();
        }}
      >
        {displayNumber ?? getRequirementShortId(requirement.id)}
      </button>
      {isOpen && placement && typeof document !== 'undefined' &&
        createPortal(
          <RequirementFloatingCard
            requirement={requirement}
            placement={placement}
            displayNumber={displayNumber}
            onClose={onClose}
          />,
          document.body,
        )}
    </div>
  );
}
