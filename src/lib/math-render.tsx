'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import katex from 'katex';

// KaTeX 配置
const KATEX_CONFIG: katex.KatexOptions = {
  throwOnError: false,
  displayMode: false,
  strict: false,
  trust: true,
};

const KATEX_DISPLAY_CONFIG: katex.KatexOptions = {
  ...KATEX_CONFIG,
  displayMode: true,
};

export const INLINE_BLANK_TOKEN = '[[BLANK]]';
const BLANK_MARKER_PATTERN = /(\[\[BLANK\]\]|_{2,}|[（(]\s*[）)]|[\[【]\s*[\]】])/g;

/**
 * 解析文本中的 LaTeX 公式，返回分段数组
 */
function parseLatexParts(text: string): Array<{ type: 'text' | 'inline' | 'display'; content: string }> {
  if (!text) return [];
  
  const result: Array<{ type: 'text' | 'inline' | 'display'; content: string }> = [];
  const pattern = /\$\$(.+?)\$\$|\$(.+?)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      result.push({ type: 'display', content: match[1] });
    } else {
      result.push({ type: 'inline', content: match[2] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return result;
}

function renderTextWithStyledBlanks(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(BLANK_MARKER_PATTERN.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[0] === INLINE_BLANK_TOKEN) {
      nodes.push(
        <span
          key={`${keyPrefix}-inline-blank-${index}`}
          className="mx-1 inline-block h-4 w-20 align-baseline border-b-2 border-emerald-500"
          aria-label="填空位"
        />
      );
      lastIndex = match.index + match[0].length;
      index += 1;
      continue;
    }
    nodes.push(
      <span key={`${keyPrefix}-blank-${index}`} className="font-semibold text-emerald-600 decoration-emerald-500">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

interface MathTextProps {
  text: string;
  className?: string;
}

/** 只读的数学公式渲染 */
export function MathText({ text, className = '' }: MathTextProps) {
  const parts = React.useMemo(() => parseLatexParts(text), [text]);
  if (!text) return null;

  return (
    <span className={`math-text ${className}`}>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          const lines = part.content.split('\n');
          return (
            <React.Fragment key={index}>
              {lines.map((line, lineIdx) => (
                <React.Fragment key={lineIdx}>
                  {renderTextWithStyledBlanks(line, `${index}-${lineIdx}`)}
                  {lineIdx < lines.length - 1 && <br />}
                </React.Fragment>
              ))}
            </React.Fragment>
          );
        }
        const isDisplay = part.type === 'display';
        const config = isDisplay ? KATEX_DISPLAY_CONFIG : KATEX_CONFIG;
        try {
          const html = katex.renderToString(part.content, config);
          return (
            <span
              key={index}
              className={`${isDisplay ? 'math-display-block' : 'math-inline'}`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch {
          return (
            <code key={index} className="text-xs bg-gray-100 px-1 rounded font-mono">
              {isDisplay ? `$$${part.content}$$` : `$${part.content}$`}
            </code>
          );
        }
      })}
    </span>
  );
}

interface MathEditableProps {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  placeholder?: string;
  /** textarea 的额外类名 */
  className?: string;
  /** 最小高度 */
  minHeight?: string;
  /** 最大高度 */
  maxHeight?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否在编辑态也把内部填空位标记显示为绿色空线 */
  inlineBlankEditing?: boolean;
}

function getEditableNodeTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
  if (node instanceof HTMLElement && node.dataset.inlineBlank === 'true') return INLINE_BLANK_TOKEN.length;
  if (node.nodeName === 'BR') return 1;
  return Array.from(node.childNodes).reduce((total, child) => total + getEditableNodeTextLength(child), 0);
}

function getOffsetWithinEditable(root: HTMLElement, target: Node, offset: number): number {
  let total = 0;
  let found = false;

  const walk = (node: Node): void => {
    if (found) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += Math.min(offset, node.textContent?.length || 0);
      } else {
        const children = Array.from(node.childNodes).slice(0, offset);
        total += children.reduce((sum, child) => sum + getEditableNodeTextLength(child), 0);
      }
      found = true;
      return;
    }
    if (node instanceof HTMLElement && node.dataset.inlineBlank === 'true') {
      total += INLINE_BLANK_TOKEN.length;
      return;
    }
    if (node.nodeName === 'BR') {
      total += 1;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += node.textContent?.length || 0;
      return;
    }
    node.childNodes.forEach(walk);
  };

  walk(root);
  return total;
}

function readInlineBlankEditableText(root: HTMLElement): string {
  const readNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node instanceof HTMLElement && node.dataset.inlineBlank === 'true') return INLINE_BLANK_TOKEN;
    if (node.nodeName === 'BR') return '\n';
    return Array.from(node.childNodes).map(readNode).join('');
  };
  return Array.from(root.childNodes).map(readNode).join('');
}

function renderInlineBlankEditableContent(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(BLANK_MARKER_PATTERN.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  const pushText = (textPart: string, keyPrefix: string) => {
    const lines = textPart.split('\n');
    lines.forEach((line, lineIndex) => {
      if (line) nodes.push(<React.Fragment key={`text-${keyPrefix}-${lineIndex}`}>{line}</React.Fragment>);
      if (lineIndex < lines.length - 1) nodes.push(<br key={`br-${keyPrefix}-${lineIndex}`} />);
    });
  };

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushText(text.slice(lastIndex, match.index), `${index}-before`);
    }
    nodes.push(
      <span
        key={`blank-${index}`}
        data-inline-blank="true"
        contentEditable={false}
        className="mx-1 inline-block h-4 w-20 align-baseline border-b-2 border-emerald-500"
        aria-label="填空位"
      />
    );
    lastIndex = match.index + match[0].length;
    index += 1;
  }

  if (lastIndex < text.length) {
    pushText(text.slice(lastIndex), `${index}-after`);
  }

  return nodes;
}

function setCaretToEditableEnd(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 可编辑的数学公式组件
 * - 默认状态：显示渲染后的数学公式（所见即所得）
 * - 点击后：切换到 textarea 编辑模式
 * - 失焦/按 Escape：切回渲染视图
 */
export function MathEditable({
  value,
  onChange,
  onSelectionChange,
  placeholder = '',
  className = '',
  minHeight = '80px',
  maxHeight = '300px',
  disabled = false,
  inlineBlankEditing = false,
}: MathEditableProps) {
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 进入编辑模式时自动聚焦，光标放到末尾，避免后续插入操作误用全选范围替换整段内容。
  useEffect(() => {
    if (isEditing && inlineBlankEditing && editableRef.current) {
      const editable = editableRef.current;
      editable.focus();
      setCaretToEditableEnd(editable);
      const end = value.length;
      onSelectionChange?.({ start: end, end });
      return;
    }
    if (isEditing && textareaRef.current) {
      const textarea = textareaRef.current;
      const end = textarea.value.length;
      textarea.focus();
      textarea.setSelectionRange(end, end);
      onSelectionChange?.({ start: end, end });
    }
  }, [isEditing]);

  // 点击渲染区域进入编辑
  const handleViewClick = useCallback(() => {
    if (!disabled) setIsEditing(true);
  }, [disabled]);

  const handleSelectionChange = useCallback(() => {
    if (inlineBlankEditing && editableRef.current) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !onSelectionChange) return;
      const editable = editableRef.current;
      const range = selection.getRangeAt(0);
      if (!editable.contains(range.startContainer) || !editable.contains(range.endContainer)) return;
      onSelectionChange({
        start: getOffsetWithinEditable(editable, range.startContainer, range.startOffset),
        end: getOffsetWithinEditable(editable, range.endContainer, range.endOffset),
      });
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea || !onSelectionChange) return;
    onSelectionChange({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
  }, [onSelectionChange]);

  // 编辑完成，退出编辑模式
  const handleBlur = useCallback(() => {
    handleSelectionChange();
    setIsEditing(false);
  }, [handleSelectionChange]);

  // 按 Escape 退出编辑
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
    }
  }, []);

  const hasContent = value.trim().length > 0;
  const hasFormula = value.includes('$');

  if (isEditing || !hasContent) {
    if (inlineBlankEditing) {
      return (
        <div
          ref={editableRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={(e) => {
            onChange(readInlineBlankEditableText(e.currentTarget));
            requestAnimationFrame(handleSelectionChange);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onKeyUp={handleSelectionChange}
          onMouseUp={handleSelectionChange}
          onSelect={handleSelectionChange}
          data-placeholder={placeholder}
          role="textbox"
          aria-label={placeholder}
          className={`w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 overflow-auto ${!hasContent ? 'before:content-[attr(data-placeholder)] before:text-gray-400' : ''} ${className}`}
          style={{ minHeight, maxHeight, whiteSpace: 'pre-wrap' }}
        >
          {hasContent ? renderInlineBlankEditableContent(value) : null}
        </div>
      );
    }
    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onSelectionChange?.({
            start: e.target.selectionStart,
            end: e.target.selectionEnd,
          });
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onKeyUp={handleSelectionChange}
        onMouseUp={handleSelectionChange}
        onSelect={handleSelectionChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none ${className}`}
        style={{ minHeight, maxHeight }}
      />
    );
  }

  // 渲染视图：点击进入编辑
  return (
    <div
      ref={containerRef}
      onClick={handleViewClick}
      role="textbox"
      tabIndex={disabled ? -1 : 0}
      aria-label={placeholder}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          setIsEditing(true);
        }
      }}
      className={`w-full cursor-text rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 hover:border-gray-300 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400 transition-colors overflow-auto ${className}`}
      style={{ minHeight, maxHeight }}
    >
      {hasContent ? (
        <MathText text={value} />
      ) : (
        <span className="text-gray-400">{placeholder}</span>
      )}
    </div>
  );
}
