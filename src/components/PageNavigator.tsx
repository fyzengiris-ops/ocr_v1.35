/**
 * 多页导航组件
 * 用于在多页 PDF/图片中切换页面
 */

'use client';

import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PageNavigatorProps {
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  /** 每页的题目数量（可选，用于显示标记） */
  questionCounts?: Map<number, number>;
  /** 是否紧凑模式 */
  compact?: boolean;
}

export function PageNavigator({
  totalPages,
  currentPage,
  onPageChange,
  questionCounts,
  compact = false,
}: PageNavigatorProps) {
  if (totalPages <= 1) return null;

  const handlePrev = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  // 生成页码按钮
  const getPageButtons = () => {
    const buttons: (number | 'ellipsis')[] = [];

    if (totalPages <= 7) {
      // 7页以内全部显示
      for (let i = 1; i <= totalPages; i++) {
        buttons.push(i);
      }
    } else {
      // 超过7页，显示省略号
      buttons.push(1);

      if (currentPage > 3) {
        buttons.push('ellipsis');
      }

      // 当前页附近的页码
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        buttons.push(i);
      }

      if (currentPage < totalPages - 2) {
        buttons.push('ellipsis');
      }

      buttons.push(totalPages);
    }

    return buttons;
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1 bg-white rounded-lg shadow px-2 py-1">
        <button
          onClick={handlePrev}
          disabled={currentPage <= 1}
          className={cn(
            'p-1 rounded',
            currentPage > 1 ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'
          )}
        >
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
        <span className="text-xs text-gray-600 min-w-[60px] text-center">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={handleNext}
          disabled={currentPage >= totalPages}
          className={cn(
            'p-1 rounded',
            currentPage < totalPages ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'
          )}
        >
          <ChevronRight className="w-4 h-4 text-gray-600" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* 上一页按钮 */}
      <button
        onClick={handlePrev}
        disabled={currentPage <= 1}
        className={cn(
          'flex items-center gap-1 px-3 py-1.5 rounded text-sm',
          currentPage > 1
            ? 'bg-white text-gray-700 hover:bg-gray-50 border'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed border'
        )}
      >
        <ChevronLeft className="w-4 h-4" />
        <span>上一页</span>
      </button>

      {/* 页码按钮 */}
      <div className="flex items-center gap-1">
        {getPageButtons().map((page, index) => {
          if (page === 'ellipsis') {
            return (
              <span key={`ellipsis-${index}`} className="px-2 text-gray-400">
                ...
              </span>
            );
          }

          const questionCount = questionCounts?.get(page) || 0;

          return (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={cn(
                'relative min-w-[32px] h-8 px-2 rounded text-sm font-medium transition-colors',
                page === currentPage
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border'
              )}
            >
              <span>{page}</span>
              {questionCount > 0 && (
                <span
                  className={cn(
                    'absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] flex items-center justify-center',
                    page === currentPage
                      ? 'bg-white text-emerald-600'
                      : 'bg-emerald-100 text-emerald-600'
                  )}
                >
                  {questionCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 下一页按钮 */}
      <button
        onClick={handleNext}
        disabled={currentPage >= totalPages}
        className={cn(
          'flex items-center gap-1 px-3 py-1.5 rounded text-sm',
          currentPage < totalPages
            ? 'bg-white text-gray-700 hover:bg-gray-50 border'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed border'
        )}
      >
        <span>下一页</span>
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* 页面信息 */}
      <div className="flex items-center gap-1 text-xs text-gray-500 ml-2">
        <FileText className="w-3.5 h-3.5" />
        <span>共 {totalPages} 页</span>
      </div>
    </div>
  );
}

/**
 * 页面缩略图导航
 */
export interface PageThumbnailNavigatorProps {
  pages: Array<{
    pageNumber: number;
    imageData: string;
    width: number;
    height: number;
  }>;
  currentPage: number;
  onPageChange: (page: number) => void;
  /** 每页的题目框（用于在缩略图上显示标记） */
  pageBoxes?: Map<number, Array<{ x: number; y: number; width: number; height: number }>>;
}

export function PageThumbnailNavigator({
  pages,
  currentPage,
  onPageChange,
  pageBoxes,
}: PageThumbnailNavigatorProps) {
  if (pages.length <= 1) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {pages.map((page) => {
        const boxes = pageBoxes?.get(page.pageNumber) || [];
        const isActive = page.pageNumber === currentPage;

        return (
          <button
            key={page.pageNumber}
            onClick={() => onPageChange(page.pageNumber)}
            className={cn(
              'relative flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all',
              isActive
                ? 'border-emerald-500 shadow-lg'
                : 'border-gray-200 hover:border-gray-300'
            )}
          >
            {/* 缩略图 */}
            <img
              src={page.imageData}
              alt={`第 ${page.pageNumber} 页`}
              className="w-20 h-auto"
            />

            {/* 题目框标记 */}
            {boxes.map((box, index) => {
              const scale = 20 / page.width; // 缩略图宽度
              return (
                <div
                  key={index}
                  className="absolute border border-emerald-500 bg-emerald-500/20"
                  style={{
                    left: box.x * scale,
                    top: box.y * scale,
                    width: box.width * scale,
                    height: box.height * scale,
                  }}
                />
              );
            })}

            {/* 页码标签 */}
            <div
              className={cn(
                'absolute bottom-0 left-0 right-0 text-center text-xs py-0.5',
                isActive ? 'bg-emerald-500 text-white' : 'bg-black/50 text-white'
              )}
            >
              {page.pageNumber}
            </div>
          </button>
        );
      })}
    </div>
  );
}
