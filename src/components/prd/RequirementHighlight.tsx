'use client';

import { useEffect } from 'react';

interface RequirementHighlightProps {
  anchorId: string | null;
}

const HIGHLIGHT_ATTR = 'data-prd-highlight';

function findAnchor(anchorId: string) {
  return document.querySelector<HTMLElement>(`[data-req-anchor="${anchorId}"]`);
}

function clearHighlights() {
  document.querySelectorAll<HTMLElement>(`[${HIGHLIGHT_ATTR}="true"]`).forEach((element) => {
    element.removeAttribute(HIGHLIGHT_ATTR);
  });
}

export function RequirementHighlight({ anchorId }: RequirementHighlightProps) {
  useEffect(() => {
    clearHighlights();

    if (!anchorId) {
      return;
    }

    const anchor = findAnchor(anchorId);
    anchor?.setAttribute(HIGHLIGHT_ATTR, 'true');

    return clearHighlights;
  }, [anchorId]);

  return (
    <style>{`
      [${HIGHLIGHT_ATTR}="true"] {
        outline: 2px solid #10b981;
        outline-offset: 3px;
        box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.12);
        transition: outline-color 160ms ease, box-shadow 160ms ease;
      }
    `}</style>
  );
}
