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
                  {line}
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
  placeholder?: string;
  /** textarea 的额外类名 */
  className?: string;
  /** 最小高度 */
  minHeight?: string;
  /** 最大高度 */
  maxHeight?: string;
  /** 是否禁用 */
  disabled?: boolean;
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
  placeholder = '',
  className = '',
  minHeight = '80px',
  maxHeight = '300px',
  disabled = false,
}: MathEditableProps) {
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 进入编辑模式时自动聚焦并全选
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  // 点击渲染区域进入编辑
  const handleViewClick = useCallback(() => {
    if (!disabled) setIsEditing(true);
  }, [disabled]);

  // 编辑完成，退出编辑模式
  const handleBlur = useCallback(() => {
    setIsEditing(false);
  }, []);

  // 按 Escape 退出编辑
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
    }
  }, []);

  const hasContent = value.trim().length > 0;
  const hasFormula = value.includes('$');

  if (isEditing || !hasContent) {
    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
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
