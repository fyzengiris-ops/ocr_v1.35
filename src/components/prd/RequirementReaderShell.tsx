'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { BookOpen, GripVertical } from 'lucide-react';

import type { ActivationStep, RequirementItem, RequirementRegistry } from '@/requirements';
import { RequirementHighlight } from './RequirementHighlight';
import { RequirementPanel } from './RequirementPanel';

type ActivationHandler = () => void | Promise<void>;

interface RequirementReaderContextValue {
  selectedRequirementId: string | null;
  highlightedAnchorId: string | null;
  selectionRevision: number;
  setSelectedRequirement: (requirementId: string | null, anchorId?: string | null) => void;
  setActiveRequirementIds: (requirementIds: string[] | null) => void;
  registerActivationHandler: (key: string, handler: ActivationHandler) => () => void;
}

interface RequirementReaderShellProps {
  registries: RequirementRegistry[];
  children: ReactNode;
}

interface DragState {
  startX: number;
  startWidth: number;
}

const RequirementReaderContext = createContext<RequirementReaderContextValue | null>(null);

const DEFAULT_PANEL_WIDTH = 380;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_RATIO = 0.5;
const PROTOTYPE_FLOATING_GAP = 24;

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getActivationHandlerKey(step: ActivationStep) {
  if (step.type === 'openPanel') return `openPanel:${step.panel}`;
  if (step.type === 'openDialog') return `openDialog:${step.dialog}`;
  if (step.type === 'setTab') return `setTab:${step.tab}`;
  if (step.type === 'setStep') return `setStep:${step.step}`;
  return null;
}

function findAnchor(anchorId: string) {
  return document.querySelector<HTMLElement>(`[data-req-anchor="${anchorId}"]`);
}

async function waitForAnchor(anchorId: string) {
  for (let index = 0; index < 40; index += 1) {
    const anchor = findAnchor(anchorId);

    if (anchor) {
      return anchor;
    }

    await delay(50);
  }

  return null;
}

export function createActivationHandlerKey(
  type: 'openPanel' | 'openDialog' | 'setTab' | 'setStep',
  id: string,
) {
  return `${type}:${id}`;
}

export function useRequirementReader() {
  return useContext(RequirementReaderContext);
}

export function RequirementReaderShell({ registries, children }: RequirementReaderShellProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<string | null>(null);
  const [activeRequirementIds, setActiveRequirementIdsState] = useState<string[] | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const activationHandlersRef = useRef(new Map<string, ActivationHandler>());
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);

    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);

    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  const maxPanelWidth = viewportWidth
    ? Math.max(MIN_PANEL_WIDTH, Math.floor(viewportWidth * MAX_PANEL_RATIO))
    : DEFAULT_PANEL_WIDTH;

  const normalizedPanelWidth = Math.min(Math.max(panelWidth, MIN_PANEL_WIDTH), maxPanelWidth);

  const setSelectedRequirement = useCallback((requirementId: string | null, anchorId?: string | null) => {
    setSelectedRequirementId(requirementId);
    setSelectionRevision((current) => current + 1);

    if (anchorId !== undefined) {
      setHighlightedAnchorId(anchorId);
    }
  }, []);

  const setActiveRequirementIds = useCallback((requirementIds: string[] | null) => {
    setActiveRequirementIdsState(requirementIds);
  }, []);

  const registerActivationHandler = useCallback((key: string, handler: ActivationHandler) => {
    activationHandlersRef.current.set(key, handler);

    return () => {
      if (activationHandlersRef.current.get(key) === handler) {
        activationHandlersRef.current.delete(key);
      }
    };
  }, []);

  const scrollToAnchor = useCallback(async (anchorId: string) => {
    const anchor = await waitForAnchor(anchorId);

    if (!anchor) {
      return;
    }

    anchor.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, []);

  const waitForActivationHandler = useCallback(async (key: string) => {
    for (let index = 0; index < 40; index += 1) {
      const handler = activationHandlersRef.current.get(key);

      if (handler) {
        return handler;
      }

      await delay(50);
    }

    return null;
  }, []);

  const runActivationStep = useCallback(
    async (step: ActivationStep) => {
      if (step.type === 'navigate') {
        if (window.location.pathname !== step.to) {
          window.location.href = step.to;
        }
        return;
      }

      if (step.type === 'scrollTo') {
        await scrollToAnchor(step.anchorId);
        return;
      }

      if (step.type === 'highlight') {
        setHighlightedAnchorId(step.anchorId);
        await scrollToAnchor(step.anchorId);
        return;
      }

      const key = getActivationHandlerKey(step);
      const handler = key ? await waitForActivationHandler(key) : undefined;

      if (handler) {
        await handler();
        await delay(80);
      }
    },
    [scrollToAnchor, waitForActivationHandler],
  );

  const activateRequirement = useCallback(
    async (requirement: RequirementItem) => {
      setPanelOpen(true);
      setSelectedRequirementId(requirement.id);
      setHighlightedAnchorId(requirement.anchorId);
      setSelectionRevision((current) => current + 1);

      for (const step of requirement.activate) {
        await runActivationStep(step);
      }
    },
    [runActivationStep],
  );

  const handleDragStart = (event: PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      startX: event.clientX,
      startWidth: normalizedPanelWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState) {
      return;
    }

    const nextWidth = dragState.startWidth - (event.clientX - dragState.startX);
    setPanelWidth(Math.min(Math.max(nextWidth, MIN_PANEL_WIDTH), maxPanelWidth));
  };

  const handleDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const contextValue = useMemo<RequirementReaderContextValue>(
    () => ({
      selectedRequirementId,
      highlightedAnchorId,
      selectionRevision,
      setSelectedRequirement,
      setActiveRequirementIds,
      registerActivationHandler,
    }),
    [
      highlightedAnchorId,
      registerActivationHandler,
      selectedRequirementId,
      selectionRevision,
      setActiveRequirementIds,
      setSelectedRequirement,
    ],
  );

  const panelRegistries = useMemo(() => {
    if (!activeRequirementIds || activeRequirementIds.length === 0) {
      return registries;
    }

    const activeRequirementIdSet = new Set(activeRequirementIds);

    return registries
      .map((registry) => ({
        ...registry,
        requirements: registry.requirements.filter((requirement) => activeRequirementIdSet.has(requirement.id)),
      }))
      .filter((registry) => registry.requirements.length > 0);
  }, [activeRequirementIds, registries]);

  return (
    <RequirementReaderContext.Provider value={contextValue}>
      <div
        className="grid h-screen min-h-0 overflow-hidden bg-gray-100"
        style={{
          gridTemplateColumns: panelOpen ? `minmax(0, 1fr) ${normalizedPanelWidth}px` : 'minmax(0, 1fr)',
        }}
      >
        <div
          className="relative h-full min-h-0 min-w-0 overflow-auto"
          style={
            {
              '--prd-panel-width': panelOpen ? `${normalizedPanelWidth}px` : '0px',
              '--prd-floating-right': panelOpen
                ? `${normalizedPanelWidth + PROTOTYPE_FLOATING_GAP}px`
                : `${PROTOTYPE_FLOATING_GAP}px`,
              '--prd-side-panel-right': panelOpen ? `${normalizedPanelWidth}px` : '0px',
            } as CSSProperties
          }
        >
          {children}
          {!panelOpen && (
            <button
              type="button"
              aria-label="打开 PRD 需求说明"
              className="fixed top-24 z-[70] flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700 shadow-lg hover:bg-emerald-50"
              style={{ right: 'var(--prd-floating-right)' }}
              onClick={() => setPanelOpen(true)}
            >
              <BookOpen className="h-4 w-4" />
            </button>
          )}
          <RequirementHighlight anchorId={highlightedAnchorId} />
        </div>

        {panelOpen && (
          <div className="relative h-full min-h-0 min-w-0 overflow-hidden border-l border-gray-200 bg-white shadow-xl">
            <div
              role="separator"
              aria-label="拖拽调整 PRD 面板宽度"
              className="absolute -left-2 top-0 z-10 flex h-full w-4 cursor-col-resize items-center justify-center text-gray-300 hover:text-emerald-500"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              <GripVertical className="h-4 w-4" />
            </div>
            <RequirementPanel
              registries={panelRegistries}
              displayNumberRegistries={registries}
              selectedRequirementId={selectedRequirementId}
              onSelectRequirement={activateRequirement}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        )}
      </div>
    </RequirementReaderContext.Provider>
  );
}
