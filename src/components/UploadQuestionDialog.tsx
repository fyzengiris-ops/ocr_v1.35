/**
 * 上传录题弹窗组件
 * 支持多页 PDF/图片，AI 智能识别题目、答案、解析
 * 支持两种工作模式：一步识别（题目答案混合/纯题目）和分步识别（题目答案分开）
 */

'use client';

import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { pdfjs } from 'react-pdf';
import {
  X, Check, AlertCircle, HelpCircle, RefreshCw, Trash2,
  AlertTriangle, Loader2, ZoomIn, ZoomOut, Sparkles, ChevronLeft, ChevronRight, Plus, CloudUpload,
  MoveUp, MoveDown, ChevronUp, ChevronDown, FileText, Layers, ArrowRight, ArrowLeft,
  Scissors, RotateCcw, Globe, Link2 as Link2Icon, Keyboard, ImageOff, Files
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RequirementMarker } from '@/components/prd/RequirementMarker';
import { createActivationHandlerKey, useRequirementReader } from '@/components/prd/RequirementReaderShell';
import { createRequirementDisplayNumberMap, createRequirementMap } from '@/components/prd/requirement-utils';
import { uploadFilesStepRegistry } from '@/requirements/upload-files-step.registry';
import { uploadQuestionDialogSelectModeRegistry } from '@/requirements/upload-question-dialog-select-mode.registry';
import { boxRecognitionStepRegistry } from '@/requirements/box-recognition-step.registry';
import { questionAnswerReviewStepRegistry } from '@/requirements/question-answer-review-step.registry';
import { MathText, MathEditable } from '@/lib/math-render';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { PageNavigator } from '@/components/PageNavigator';
import { processUploadedFile, batchCropImages, cropImage, stitchImagesVertically } from '@/lib/pdf-processor';
import type { PageImage, QuestionBox, RecognizedBlock, RecognitionResult, MatchedQuestion, AnswerMarker } from '@/types/recognition';
import { generateMatchedQuestions, generateAnswerMarkers, extractAnswerFromAnalysis, getValidQuestionTypes } from '@/lib/ai-recognizer';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf-worker/pdf.worker.min.mjs';

const uploadQuestionDialogMarkerRegistries = [
  uploadFilesStepRegistry,
  uploadQuestionDialogSelectModeRegistry,
  boxRecognitionStepRegistry,
  questionAnswerReviewStepRegistry,
];

// ==================== 工作模式定义 ====================

/** 工作模式：仅题目 / 题目+答案（同文件）/ 题目+答案（不同文件） */
type WorkMode = 'questions-only' | 'same-file' | 'cross-file';
type ManualLinkField = 'answer' | 'analysis';
interface ManualLinkTarget {
  questionId: number;
  field: ManualLinkField;
}

/** 流程阶段 */
type FlowStep =
  | 'upload_files'          // 上传资料
  | 'select_mode'           // 选择识别方式
  | 'frame_and_review'      // 选择识别内容
  | 'review'                // 核对识别结果
  | 'manual_link';          // 旧版手动关联答案步骤，仅用于历史状态兼容

const uploadFilesRequirementIds = [
  'UPLOAD_FILES_STEP-001',
  'UPLOAD_FILES_STEP-002',
  'UPLOAD_FILES_STEP-003',
  'UPLOAD_FILES_STEP-004',
  'UPLOAD_FILES_STEP-005',
  'UPLOAD_FILES_STEP-006',
  'UPLOAD_FILES_STEP-007',
  'UPLOAD_FILES_STEP-011',
];

const selectModeRequirementIds = [
  'SELECT_MODE-007',
  'SELECT_MODE-002',
  'SELECT_MODE-003',
  'SELECT_MODE-008',
  'SELECT_MODE-005',
  'SELECT_MODE-004',
  'SELECT_MODE-006',
];

const boxStepRequirementIds = [
  'SELECT_MODE-007',
  'SELECT_MODE-006',
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
];

const reviewStepRequirementIds = [
  'SELECT_MODE-007',
  'SELECT_MODE-006',
  'BOX_STEP-002',
  'BOX_STEP-007',
  'BOX_STEP-010',
  'BOX_STEP-011',
  'REVIEW_STEP-006',
  'REVIEW_STEP-002',
  'REVIEW_STEP-013',
  'REVIEW_STEP-014',
  'REVIEW_STEP-007',
  'REVIEW_STEP-012',
  'REVIEW_STEP-008',
  'REVIEW_STEP-009',
  'REVIEW_STEP-001',
  'REVIEW_STEP-003',
  'REVIEW_STEP-015',
  'REVIEW_STEP-016',
  'REVIEW_STEP-017',
  'REVIEW_STEP-005',
  'REVIEW_STEP-018',
  'REVIEW_STEP-004',
];

function getActiveUploadDialogRequirementIds(flowStep: FlowStep) {
  if (flowStep === 'upload_files') return uploadFilesRequirementIds;
  if (flowStep === 'select_mode') return selectModeRequirementIds;
  if (flowStep === 'frame_and_review') return boxStepRequirementIds;
  return reviewStepRequirementIds;
}

type RecognitionModeVisualType = 'question-only' | 'same-file' | 'cross-file';
type RecognitionModeAccent = 'blue' | 'purple' | 'amber';

interface RecognitionModeCardProps {
  mode: WorkMode;
  icon: LucideIcon;
  title: string;
  badge?: string;
  scenario: string;
  visualType: RecognitionModeVisualType;
  steps: string[];
  accent: RecognitionModeAccent;
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: (mode: WorkMode) => void;
}

const recognitionModeAccentStyles = {
  blue: {
    icon: 'bg-blue-50 text-blue-600 group-hover:bg-blue-100',
    badge: 'bg-blue-50 text-blue-600 border-blue-100',
    selected: 'border-blue-400 bg-blue-50/40 shadow-md shadow-blue-100/70',
    hover: 'hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/60',
    flow: 'border-blue-100 bg-blue-50 text-blue-700',
    resultTag: 'bg-blue-50 text-blue-600',
  },
  purple: {
    icon: 'bg-purple-50 text-purple-600 group-hover:bg-purple-100',
    badge: 'bg-purple-50 text-purple-600 border-purple-100',
    selected: 'border-purple-400 bg-purple-50/40 shadow-md shadow-purple-100/70',
    hover: 'hover:border-purple-300 hover:shadow-md hover:shadow-purple-100/60',
    flow: 'border-purple-100 bg-purple-50 text-purple-700',
    resultTag: 'bg-purple-50 text-purple-600',
  },
  amber: {
    icon: 'bg-amber-50 text-amber-600 group-hover:bg-amber-100',
    badge: 'bg-amber-50 text-amber-600 border-amber-100',
    selected: 'border-amber-400 bg-amber-50/40 shadow-md shadow-amber-100/70',
    hover: 'hover:border-amber-300 hover:shadow-md hover:shadow-amber-100/60',
    flow: 'border-amber-100 bg-amber-50 text-amber-700',
    resultTag: 'bg-amber-50 text-amber-600',
  },
} as const;

function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn('h-1.5 rounded-full bg-slate-200', className)} />;
}

function SourceDocumentPreview({ type }: { type: RecognitionModeVisualType }) {
  const [sameFilePreviewIndex, setSameFilePreviewIndex] = useState(0);

  useEffect(() => {
    if (type !== 'same-file') return;

    const rotateTimer = window.setTimeout(() => {
      setSameFilePreviewIndex((currentIndex) => (currentIndex + 1) % 2);
    }, 2400);

    return () => window.clearTimeout(rotateTimer);
  }, [sameFilePreviewIndex, type]);

  if (type === 'cross-file') {
    return (
      <div className="relative h-full min-h-[172px] overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">资料页</span>
          <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />
        </div>
        <div className="grid h-[calc(100%-28px)] grid-cols-2 gap-2">
          <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-2.5 pb-2 pt-8 shadow-sm">
            <span className="absolute left-2 top-2 rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
              题目文件
            </span>
            <div className="absolute left-2 top-12 h-9 w-[84%] rounded-md border-2 border-emerald-500 bg-emerald-100/30">
              <span className="absolute -left-0.5 -top-5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                题目
              </span>
              <div className="mt-2 space-y-1.5 px-2">
                <SkeletonLine className="w-full bg-emerald-200/80" />
                <SkeletonLine className="w-4/5 bg-emerald-200/80" />
              </div>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-2.5 pb-2 pt-8 shadow-sm">
            <span className="absolute left-2 top-2 rounded border border-purple-100 bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-600">
              答案文件
            </span>
            <div className="mt-3 space-y-1.5">
              <SkeletonLine className="w-full bg-purple-200/80" />
              <SkeletonLine className="w-4/5 bg-purple-200/80" />
              <SkeletonLine className="w-3/5 bg-purple-200/80" />
              <SkeletonLine className="w-2/5 bg-purple-200/80" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[172px] overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">资料页</span>
        <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />
      </div>

      {type === 'question-only' ? (
        <div className="absolute left-3 top-14 h-14 w-[86%] rounded-md border-2 border-emerald-500 bg-emerald-100/30">
          <span className="absolute -left-0.5 -top-5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
            题目
          </span>
          <div className="mt-3 space-y-1.5 px-2">
            <SkeletonLine className="w-full bg-emerald-200/80" />
            <SkeletonLine className="w-4/5 bg-emerald-200/80" />
            <SkeletonLine className="w-2/3 bg-emerald-200/80" />
          </div>
        </div>
      ) : sameFilePreviewIndex === 0 ? (
        <div className="absolute left-3 top-14 h-12 w-[86%] rounded-md border-2 border-emerald-500 bg-emerald-100/30">
          <span className="absolute -left-0.5 -top-5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
            题目+答案/解析
          </span>
          <div className="mt-3 space-y-1.5 px-2">
            <SkeletonLine className="w-full bg-emerald-200/80" />
            <SkeletonLine className="w-3/4 bg-emerald-200/80" />
          </div>
        </div>
      ) : (
        <>
          <div className="absolute left-3 top-14 h-12 w-[86%] rounded-md border-2 border-emerald-500 bg-emerald-100/25">
            <span className="absolute -left-0.5 -top-5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
              题目
            </span>
            <div className="mt-3 space-y-1.5 px-2">
              <SkeletonLine className="w-full bg-emerald-200/80" />
              <SkeletonLine className="w-3/4 bg-emerald-200/80" />
            </div>
          </div>
          <div className="absolute left-3 top-[135px] h-12 w-[86%] rounded-md border-2 border-purple-500 bg-purple-100/30">
            <span className="absolute -left-0.5 -top-5 rounded bg-purple-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
              答案/解析
            </span>
            <div className="mt-3 space-y-1.5 px-2">
              <SkeletonLine className="w-full bg-purple-200/80" />
              <SkeletonLine className="w-3/4 bg-purple-200/80" />
            </div>
          </div>
        </>
      )}
      {type === 'same-file' && (
        <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5">
          {[0, 1].map((index) => (
            <button
              key={index}
              type="button"
              aria-label={index === 0 ? '查看题目答案紧跟示意' : '查看题目答案分区示意'}
              onClick={(event) => {
                event.stopPropagation();
                setSameFilePreviewIndex(index);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className={cn(
                'h-1.5 rounded-full transition-all',
                sameFilePreviewIndex === index ? 'w-4 bg-purple-500' : 'w-1.5 bg-slate-300 hover:bg-slate-400',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModeFlow({ steps, accent }: { steps: string[]; accent: RecognitionModeAccent }) {
  const styles = recognitionModeAccentStyles[accent];

  return (
    <div className="flex h-full min-w-[84px] flex-col items-center justify-center gap-2">
      {steps.map((step, index) => (
        <Fragment key={step}>
          <span className={cn('rounded-full border px-2 py-1 text-center text-[10px] font-medium leading-tight', styles.flow)}>
            {step}
          </span>
          {index < steps.length - 1 && <ArrowRight className="h-3.5 w-3.5 rotate-90 text-slate-300" />}
        </Fragment>
      ))}
    </div>
  );
}

function StartRecognitionActionPreview() {
  return (
    <>
      <div
        aria-hidden="true"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 cursor-default items-center justify-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-200"
      >
        <Sparkles className="h-4 w-4" />
      </div>
      <span
        aria-hidden="true"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute right-2 top-[calc(50%+24px)] z-20 cursor-default rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-medium leading-tight text-emerald-700 shadow-sm"
      >
        开始识别
      </span>
    </>
  );
}

function ResultSection({ label, compact, tone = 'question' }: { label: string; compact?: boolean; tone?: 'question' | 'answer' }) {
  const skeletonColor = tone === 'question' ? 'bg-emerald-200/80' : 'bg-purple-200/80';

  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[10px] font-medium text-slate-400">{label}</div>
      <div className="space-y-1.5">
        <SkeletonLine className={cn(compact ? 'w-10' : 'w-full', skeletonColor)} />
        {!compact && <SkeletonLine className={cn('w-4/5', skeletonColor)} />}
      </div>
    </div>
  );
}

function RecognitionResultPreview({ type, accent }: { type: RecognitionModeVisualType; accent: RecognitionModeAccent }) {
  const styles = recognitionModeAccentStyles[accent];

  if (type === 'question-only') {
    return (
      <div className="flex h-full min-h-[172px] flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">识别结果</span>
        </div>
        <ResultSection label="题干1" />
        <ResultSection label="题干2" />
        <ResultSection label="题干3" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[172px] flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">识别结果</span>
      </div>
      <ResultSection label="题干" />
      <ResultSection label="答案" compact tone="answer" />
      <ResultSection label="解析" tone="answer" />
    </div>
  );
}

function ModeVisual({ type, steps, accent }: { type: RecognitionModeVisualType; steps: string[]; accent: RecognitionModeAccent }) {
  if (type === 'question-only' || type === 'same-file' || type === 'cross-file') {
    return (
      <div className="grid min-h-[210px] flex-1 grid-cols-[minmax(0,1.38fr)_minmax(0,0.74fr)] items-stretch gap-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
        <div className="relative">
          <SourceDocumentPreview type={type} />
          <StartRecognitionActionPreview />
        </div>
        <RecognitionResultPreview type={type} accent={accent} />
      </div>
    );
  }

  return (
    <div className="grid min-h-[210px] flex-1 grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] items-stretch gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
      <SourceDocumentPreview type={type} />
      <ModeFlow steps={steps} accent={accent} />
      <RecognitionResultPreview type={type} accent={accent} />
    </div>
  );
}

function RecognitionModeCard({
  mode,
  icon: Icon,
  title,
  badge,
  scenario,
  visualType,
  steps,
  accent,
  selected,
  disabled,
  disabledReason,
  onSelect,
}: RecognitionModeCardProps) {
  const styles = recognitionModeAccentStyles[accent];

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={() => {
        if (!disabled) {
          onSelect(mode);
        }
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        event.preventDefault();
        onSelect(mode);
      }}
      className={cn(
        'group flex h-full min-h-[356px] w-full cursor-pointer flex-col rounded-xl border-2 bg-white p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2',
        selected ? styles.selected : cn('border-slate-200 shadow-sm', !disabled && styles.hover),
        disabled && 'cursor-not-allowed opacity-55 grayscale-[0.15]',
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors', styles.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{title}</span>
            {badge && <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', styles.badge)}>{badge}</span>}
            {selected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                <Check className="h-3 w-3" />
                已选
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{scenario}</p>
          {disabled && disabledReason && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-600">{disabledReason}</p>
          )}
        </div>
      </div>
      <ModeVisual type={visualType} steps={steps} accent={accent} />
    </div>
  );
}

/** 文件角色信息（用于跨文件场景） */
interface FileRoleInfo {
  fileName: string;
  role: 'question' | 'answer' | 'unassigned';
}

interface UploadQuestionDialogProps {
  onClose: () => void;
  onQuestionSelect: (questions: number[]) => void;
  onAddToPaper: (questions: Question[]) => void;
  uploadedFiles: File[];  // 支持多文件上传
  subjectInfo?: string; // 学段学科信息，如"初中数学"
  fileRanges?: { rangeStart: number; rangeEnd: number }[]; // 每个文件的页码范围
  onContinueUpload?: () => void; // 继续上传回调，打开文件选择弹窗
  onSupplementUpload?: () => void; // 补充资料回调，打开文件选择弹窗（隐藏资源库tab）
  onReupload?: () => void; // 重新上传回调，清空当前数据后打开文件选择弹窗
  onDeleteFile?: (index: number) => void; // 删除文件回调
  onUpdateFileRange?: (index: number, rangeStart: number, rangeEnd: number) => void; // 调整页码范围回调
  fileTotalPages?: number[]; // 每个文件的总页数
}

// 题型按学科动态计算（在组件内部通过 getValidQuestionTypes 获取）
// 复合题类型判断：支持子题的题型
const COMPOUND_TYPE_KEYWORDS = ['完形填空', '阅读理解', '任务型阅读', '问答题', '翻译题', '书面表达', '解答题', '证明题', '材料题', '综合题', '实验探究题'];
// 选择题类型判断：支持选项数设置的题型
const CHOICE_TYPE_KEYWORDS = ['单选题', '多选题', '判断题'];

function isCompoundType(type: string): boolean {
  return COMPOUND_TYPE_KEYWORDS.includes(type);
}
function isChoiceType(type: string): boolean {
  return CHOICE_TYPE_KEYWORDS.includes(type);
}

function resolveQuestionType(
  incomingType: string | undefined,
  content: string,
  validTypes: string[] = []
): string {
  const pick = (...candidates: string[]) => {
    for (const candidate of candidates) {
      if (validTypes.includes(candidate)) return candidate;
    }
    return '';
  };

  if (incomingType && validTypes.includes(incomingType)) return incomingType;

  const text = content || '';
  const inferred =
    (/多选|不止一项|至少两项|全部正确|都正确/.test(text) && pick('多选题')) ||
    (/(判断|正确|错误|对错|是否正确)/.test(text) && pick('判断题')) ||
    (/_{2,}|填空|空格|横线/.test(text) && pick('填空题', '选词填空', '短文填空')) ||
    (/(证明|证得|求证)/.test(text) && pick('证明题', '解答题')) ||
    (/(计算|求|解方程|化简|解不等式)/.test(text) && pick('解答题', '计算题')) ||
    (/(翻译|译成|译为)/.test(text) && pick('翻译题')) ||
    (/(作文|写作|书面表达|写一篇)/.test(text) && pick('书面表达')) ||
    (/(回答|简答|说明原因|为什么)/.test(text) && pick('问答题', '解答题')) ||
    (/(选择|下列|哪一项|哪项|哪个|正确的是|不正确的是)/.test(text) && pick('单选题')) ||
    '';

  if (inferred) return inferred;
  if (incomingType && incomingType !== 'single') return incomingType;
  return pick('单选题') || validTypes[0] || '单选题';
}

// 选项字母表
const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 子题序号符号（带圈数字）
const SUB_NUMBERS = '①②③④⑤⑥⑦⑧⑨⑩';

/**
 * 按子题序号剥离答案/解析文本
 * 支持的序号格式：
 *   1.A 2.B 3.C / (1)A (2)B (3)C / ①A ②B ③C
 *   1、A 2、B / 1.A 2.B / (1)A (2)B
 * 如果无法按序号拆分，返回 null（表示不做剥离）
 */
function splitAnswerBySubQuestions(text: string, subCount: number): string[] | null {
  if (!text || subCount <= 0) return null;

  // ①②③ 格式（特殊处理，因为符号本身就是序号，不与内容中的括号冲突）
  const circledMatch = text.match(/[①②③④⑤⑥⑦⑧⑨⑩]/g);
  if (circledMatch && circledMatch.length >= subCount) {
    const circledNums = '①②③④⑤⑥⑦⑧⑨⑩';
    const parts: string[] = [];
    for (let i = 0; i < subCount; i++) {
      const currentSymbol = circledNums[i];
      const nextSymbol = i + 1 < subCount ? circledNums[i + 1] : null;
      const startIdx = text.indexOf(currentSymbol);
      if (startIdx === -1) { parts.push(''); continue; }
      const contentStart = startIdx + 1;
      let endIdx: number;
      if (nextSymbol) {
        const nextIdx = text.indexOf(nextSymbol, contentStart);
        endIdx = nextIdx === -1 ? text.length : nextIdx;
      } else {
        endIdx = text.length;
      }
      parts.push(text.slice(contentStart, endIdx).trim());
    }
    return parts;
  }

  // 通用位置切割函数：先定位所有序号位置，找到连续递增序列，再按位置切割文本
  // 这样即使内容中包含括号也不会截断
  const splitByPositions = (
    regex: RegExp,
    srcText: string,
    count: number
  ): string[] | null => {
    const positions: Array<{ num: number; start: number; contentStart: number }> = [];
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(srcText)) !== null) {
      positions.push({
        num: parseInt(m[1], 10),
        start: m.index,
        contentStart: m.index + m[0].length,
      });
    }

    if (positions.length === 0) return null;

    // 从左到右寻找连续递增的序号序列
    // 策略：从每个位置开始尝试找连续序列
    for (let startIdx = 0; startIdx <= positions.length - count; startIdx++) {
      const selected = [positions[startIdx]];
      let searchPos = startIdx + 1;

      while (selected.length < count && searchPos < positions.length) {
        const expectedNum = selected[0].num + selected.length;
        if (positions[searchPos].num === expectedNum && positions[searchPos].start > selected[selected.length - 1].contentStart) {
          selected.push(positions[searchPos]);
        }
        searchPos++;
      }

      if (selected.length === count) {
        const parts: string[] = [];
        for (let i = 0; i < selected.length; i++) {
          const contentStart = selected[i].contentStart;
          const contentEnd = i + 1 < selected.length ? selected[i + 1].start : srcText.length;
          parts.push(srcText.slice(contentStart, contentEnd).trim());
        }
        return parts;
      }
    }

    return null;
  };

  // (1) (2) (3) 半角括号格式
  const parenResult = splitByPositions(/\(\s*(\d+)\s*\)/g, text, subCount);
  if (parenResult) return parenResult;

  // （1）（2）（3）全角括号格式（AI 中文输出常用）
  const fullwidthParenResult = splitByPositions(/（\s*(\d+)\s*）/g, text, subCount);
  if (fullwidthParenResult) return fullwidthParenResult;

  // 1. 2. 3. 格式（数字+点）
  const dotResult = splitByPositions(/(\d+)\s*[.．]\s*/g, text, subCount);
  if (dotResult) return dotResult;

  // 1、2、3、格式（数字+顿号）
  const dunResult = splitByPositions(/(\d+)\s*[、，,]\s*/g, text, subCount);
  if (dunResult) return dunResult;

  // 无法按序号拆分
  return null;
}

/**
 * 从子题内容中尝试分离答案和解析
 * 支持的格式：
 * - "答案：xxx 解析：yyy" → answer=xxx, analysis=yyy
 * - "答案:xxx" → answer=xxx, analysis=''
 * - "解析：yyy" → answer='', analysis=yyy
 * - 无明显标记时，尝试从 "所以/得/即/则/故" 等关键词前提取答案
 * - 无法分离时，全部放入 analysis
 */
function parseSubQuestionContent(content: string): { answer: string; analysis: string } {
  if (!content || !content.trim()) return { answer: '', analysis: '' };

  const trimmed = content.trim();

  // 模式1: "答案：xxx 解析：yyy" 或 "答案:xxx 解析:yyy"
  const answerAnalysisPattern = /答案\s*[：:]\s*([\s\S]+?)\s*解析\s*[：:]\s*([\s\S]+)$/;
  const match1 = trimmed.match(answerAnalysisPattern);
  if (match1) {
    return { answer: match1[1].trim(), analysis: match1[2].trim() };
  }

  // 模式2: "解析：yyy 答案：xxx" (答案在后面)
  const analysisAnswerPattern = /解析\s*[：:]\s*([\s\S]+?)\s*答案\s*[：:]\s*([\s\S]+)$/;
  const match2 = trimmed.match(analysisAnswerPattern);
  if (match2) {
    return { answer: match2[2].trim(), analysis: match2[1].trim() };
  }

  // 模式3: "答案：xxx" (无解析)
  const answerOnlyPattern = /答案\s*[：:]\s*([\s\S]+)$/;
  const match3 = trimmed.match(answerOnlyPattern);
  if (match3) {
    return { answer: match3[1].trim(), analysis: '' };
  }

  // 模式4: "解析：yyy" (无答案)
  const analysisOnlyPattern = /解析\s*[：:]\s*([\s\S]+)$/;
  const match4 = trimmed.match(analysisOnlyPattern);
  if (match4) {
    return { answer: '', analysis: match4[1].trim() };
  }

  // 模式5: 尝试从 "所以/得/即/则/故" 等关键词分离
  // 例如 "由f'(x)=...可得f(x)单调递增" → answer="单调递增", analysis="由f'(x)=...可得f(x)单调递增"
  const resultKeywords = /(?:所以|得|即|则|故)\s*([^，。；,;]+[^\s]*)\s*[。；.;]?$/;
  const match5 = trimmed.match(resultKeywords);
  if (match5) {
    // 只在有明确结论词时分离，且结论部分较短时才视为"答案"
    const possibleAnswer = match5[1].trim();
    if (possibleAnswer.length <= 30 && possibleAnswer.length < trimmed.length / 3) {
      return { answer: possibleAnswer, analysis: trimmed };
    }
  }

  // 无法分离时，全部作为解析
  return { answer: '', analysis: trimmed };
}

/**
 * 智能拆分答案/解析文本到子题（多策略兜底）
 * 当 splitAnswerBySubQuestions 按序号标记拆分失败时，依次尝试以下策略：
 *
 * 策略1：按「解：(1)」「(1)解」「第(1)问」等子题解答标记拆分
 * 策略2：按双换行或明显段落边界拆分
 * 策略3：按单换行拆分（每段对应一个子题）
 * 策略4：均分文本长度（最后手段）
 */
/**
 * 识别模式子题自动拆分（AI数据优先 + 文本兜底）
 * 用于识别结果回填时自动构建子题结构
 */
function recognizeSubQuestions(
  q: { content?: string; answer?: string; analysis?: string; subQuestions?: SubQuestion[] },
  validTypes: string[] = []
): SubQuestion[] {
  // 策略1：优先使用 AI 返回的子题结构
  if (q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
    return q.subQuestions.map((sq, i) => ({
      ...sq,
      id: sq.id || Date.now() + i,
      questionType: resolveQuestionType(sq.questionType, sq.content || '', validTypes),
      content: formatRecognizedContent(sq.content || ''),
    }));
  }

  // 策略2：前端文本兜底 — 按题干中的子题标记拆分
  const content = q.content || '';
  if (!content.trim()) return [];

  return splitSubQuestionsFromText(content, q.answer || '', q.analysis || '', validTypes);
}

function smartSplitForSubQuestions(text: string, subCount: number): string[] {
  if (!text || !text.trim() || subCount <= 0) return new Array(subCount).fill('');
  const trimmed = text.trim();

  // ===== 策略1：按子题解答标记拆分 =====
  // 匹配模式：「(1)解」「(1) 解」「①解」「第(1)问」「(1)的答案是」等
  const subAnswerMarkers = [
    /(?:^|\n)\s*\(?(\d+)\)?\s*[、.:．]?\s*解[：:]/g,           // (1)解： / (1)、解：
    /(?:^|\n)\s*解[：:]\s*[（(](\d+)[）)]/g,                     // 解：(1) / 解：（1）
    /(?:^|\n)\s*第\s*(\d+)\s*(?:问|小题|部分)\s*[：:]/g,          // 第1问：/ 第1小题：
    /(?:^|\n)\s*[（(](\d+)[）)]\s*的?(?:答案|答|结果|解)[是为]/g,  // (1)的答案是 / (1)的结果是
    /[①②③④⑤⑥⑦⑧⑨⑩]\s*解[：:]/g,                               // ①解：
  ];

  for (const regex of subAnswerMarkers) {
    const positions: Array<{ idx: number; num: number }> = [];
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(trimmed)) !== null) {
      positions.push({ idx: m.index, num: parseInt(m[1], 10) });
    }
    if (positions.length >= subCount) {
      // 按序号排序后取前 subCount 个
      positions.sort((a, b) => a.num - b.num);
      const selected = positions.slice(0, subCount);
      // 验证是否连续
      const isConsecutive = selected.every((p, i) => p.num === i + 1 || (i > 0 && p.num === selected[i - 1].num + 1));
      if (isConsecutive || selected.length >= subCount) {
        const parts: string[] = [];
        for (let i = 0; i < subCount; i++) {
          const start = selected[i].idx;
          const end = i + 1 < subCount ? selected[i + 1].idx : trimmed.length;
          parts.push(trimmed.slice(start, end).trim());
        }
        return parts;
      }
    }
  }

  // ===== 策略2：按双换行（段落边界）拆分 =====
  const doubleNewlineParts = trimmed.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (doubleNewlineParts.length >= subCount) {
    return distributePartsToSlots(doubleNewlineParts, subCount);
  }

  // ===== 策略3：按单换行拆分 =====
  const singleNewlineParts = trimmed.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (singleNewlineParts.length >= subCount) {
    return distributePartsToSlots(singleNewlineParts, subCount);
  }

  // ===== 策略4：按句号/分号拆分 =====
  const sentenceParts = trimmed.split(/(?<=[。；;])\s*/).map(s => s.trim()).filter(Boolean);
  if (sentenceParts.length >= subCount) {
    return distributePartsToSlots(sentenceParts, subCount);
  }

  // ===== 策略5：均分文本长度（最后手段） =====
  return splitByLength(trimmed, subCount);
}

/**
 * 将 N 个片段分配到 M 个槽位中
 * 尽量均匀分配，多的放前面
 */
function distributePartsToSlots(parts: string[], slotCount: number): string[] {
  const result = new Array(slotCount).fill('');
  if (parts.length === 0) return result;

  // 计算每个槽位至少分几个、多出几个
  const baseCount = Math.floor(parts.length / slotCount);
  const extra = parts.length % slotCount;

  let partIdx = 0;
  for (let slot = 0; slot < slotCount; slot++) {
    const count = baseCount + (slot < extra ? 1 : 0);
    const slotParts = parts.slice(partIdx, partIdx + count);
    result[slot] = slotParts.join('\n');
    partIdx += count;
  }
  return result;
}

/**
 * 按字符数将文本大致均分为 N 份
 * 在换行符、句号等自然断点处切分，避免截断中间
 */
function splitByLength(text: string, count: number): string[] {
  if (count <= 1) return [text];
  const chunkSize = Math.ceil(text.length / count);
  const result: string[] = [];
  let remaining = text;

  for (let i = 0; i < count - 1; i++) {
    if (remaining.length <= chunkSize) {
      result.push(remaining.trim());
      remaining = '';
      break;
    }
    // 在 chunkSize 附近找最佳断点（优先换行 > 句号 > 分号 > 任意位置）
    let cutPos = chunkSize;
    const searchRegion = remaining.slice(Math.max(0, chunkSize - 20), chunkSize + 20);

    const newlineIdx = searchRegion.indexOf('\n');
    if (newlineIdx !== -1) {
      cutPos = Math.max(0, chunkSize - 20) + newlineIdx + 1;
    } else {
      const periodIdx = searchRegion.search(/[。；;]/);
      if (periodIdx !== -1) {
        cutPos = Math.max(0, chunkSize - 20) + periodIdx + 1;
      }
    }

    result.push(remaining.slice(0, cutPos).trim());
    remaining = remaining.slice(cutPos);
  }
  if (remaining) result.push(remaining.trim());

  // 补齐到 count 个
  while (result.length < count) result.push('');
  return result.slice(0, count);
}

/**
 * 获取框在指定页面上的渲染样式
 * 对于跨页框，在起始页和结束页分别渲染不同的部分
 */
function getBoxRenderStyle(box: QuestionBox, pageNum: number): { left: number; top: number; width: number; height: number; isCrossPagePart: boolean } | null {
  if (box.pageNumber === pageNum) {
    // 起始页部分
    return {
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
      isCrossPagePart: !!box.endPageNumber,
    };
  } else if (box.endPageNumber === pageNum && box.endPageHeight) {
    // 跨页的第二部分
    return {
      left: box.x,
      top: box.endPageY || 0,
      width: box.width,
      height: box.endPageHeight,
      isCrossPagePart: true,
    };
  }
  return null;
}

/**
 * 按空位剥离填空题答案
 * 支持的格式：
 *   1.A 2.B 3.C / (1)A (2)B (3)C / ①A ②B ③C
 *   A;B;C / A,B,C / A、B、C
 *   空格分隔：A B C
 * 如果无法按空位拆分，返回 null
 */
function splitAnswerByBlanks(answer: string, blankCount: number): string[] | null {
  if (!answer || blankCount <= 1) return null;
  const trimmed = answer.trim();

  // 先尝试子题序号格式（复用 splitAnswerBySubQuestions）
  const subResult = splitAnswerBySubQuestions(trimmed, blankCount);
  if (subResult) return subResult;

  // 尝试分号分隔
  if (trimmed.includes(';') || trimmed.includes('；')) {
    const parts = trimmed.split(/[;；]/).map(s => s.trim()).filter(Boolean);
    if (parts.length === blankCount) return parts;
    if (parts.length >= blankCount) return parts.slice(0, blankCount);
  }

  // 尝试逗号/顿号分隔
  if (trimmed.includes('、') || (trimmed.includes(',') && !trimmed.includes('，'))) {
    const parts = trimmed.split(/[、,]/).map(s => s.trim()).filter(Boolean);
    if (parts.length === blankCount) return parts;
    if (parts.length >= blankCount) return parts.slice(0, blankCount);
  }

  // 尝试中文逗号分隔
  if (trimmed.includes('，')) {
    const parts = trimmed.split(/，/).map(s => s.trim()).filter(Boolean);
    if (parts.length === blankCount) return parts;
    if (parts.length >= blankCount) return parts.slice(0, blankCount);
  }

  // 无法拆分
  return null;
}

/**
 * 将答案/解析合并到题目中（支持复合题子题答案剥离）
 * 统一处理 unmatchedAnswers 回填和重复题号合并两种场景
 */
function mergeAnswerToQuestion(
  q: Question,
  rawAnswer: string | undefined,
  rawAnalysis: string | undefined
): Question {
  const ansStr = typeof rawAnswer === 'string' ? rawAnswer : String(rawAnswer || '');
  const anaStr = typeof rawAnalysis === 'string' ? rawAnalysis : String(rawAnalysis || '');

  // 辅助函数：智能合并解析——如果已有解析更长更完整，优先保留已有解析
  const mergeAnalysis = (existing: string | undefined, incoming: string): string => {
    const existingStr = existing || '';
    // 如果新的解析为空，保留旧的
    if (!incoming.trim()) return existingStr;
    // 如果旧的为空，使用新的
    if (!existingStr.trim()) return incoming;
    // 如果新的解析比旧的长，使用新的（更完整）
    if (incoming.length > existingStr.length) return incoming;
    // 否则保留旧的（可能更完整）
    return existingStr;
  };

  // 辅助函数：智能合并答案——如果已有答案更长更完整，优先保留已有答案
  const mergeAnswer = (existing: string | undefined, incoming: string): string => {
    const existingStr = existing || '';
    if (!incoming.trim()) return existingStr;
    if (!existingStr.trim()) return incoming;
    if (incoming.length > existingStr.length) return incoming;
    return existingStr;
  };

  // 有子题结构：按子题序号剥离答案/解析（不依赖题型判断，只要存在子题就拆分）
  if ((q.subQuestions || []).length > 0) {
    const subCount = q.subQuestions!.length;
    let answerParts = splitAnswerBySubQuestions(ansStr, subCount);
    let analysisParts = splitAnswerBySubQuestions(anaStr, subCount);

    // 当 answer 为空但 analysis 包含带子题序号的完整内容时，
    // 从 analysis 剥离的各部分中进一步尝试分离答案和解析
    const shouldParseSubContent = !answerParts && analysisParts && !ansStr;

    const updatedSubQuestions = q.subQuestions!.map((s, idx) => {
      let subAnswer = answerParts ? mergeAnswer(s.answer, answerParts[idx] || '') : s.answer;
      let subAnalysis = analysisParts ? mergeAnalysis(s.analysis, analysisParts[idx] || '') : s.analysis;

      // 如果 answer 为空但 analysis 按子题拆分成功，
      // 尝试从每个子题的 analysis 内容中进一步分离答案和解析
      if (shouldParseSubContent && subAnalysis) {
        const parsed = parseSubQuestionContent(subAnalysis);
        if (parsed.answer) {
          subAnswer = mergeAnswer(subAnswer, parsed.answer);
        }
        subAnalysis = mergeAnalysis(subAnalysis, parsed.analysis);
      }

      const updated = { ...s, answer: subAnswer, analysis: subAnalysis };
      // 子题是填空题且多空位时，尝试将子题答案剥离到各空位
      if (isFillBlankType(s.questionType) && (s.blankCount || 1) > 1 && subAnswer) {
        const blankParts = splitAnswerByBlanks(subAnswer, s.blankCount || 1);
        if (blankParts) {
          updated.blankAnswers = blankParts;
          updated.answer = ''; // 多空位时不保留子题单行答案
        }
      }
      return updated;
    });

    return {
      ...q,
      // 如果成功按子题剥离，父题不保留答案；否则智能合并
      answer: answerParts ? q.answer : mergeAnswer(q.answer, ansStr),
      analysis: analysisParts ? q.analysis : mergeAnalysis(q.analysis, anaStr),
      subQuestions: updatedSubQuestions,
      answerSource: 'direct' as const,
      status: 'matched' as const,
    };
  }

  // 非复合题或无子题：智能合并答案和解析
  const SUBJECTIVE_TYPES = ['书面表达', '问答题', '翻译题'];
  const isSubjective = SUBJECTIVE_TYPES.includes(q.questionType);

  let finalAnswer: string;
  if (isSubjective) {
    // 主观题（书面表达/问答题/翻译题）：方案B
    // 如果AI返回的answer有内容且长度>5字符，保留原样；否则显示"见下方解析"
    const hasValidAnswer = ansStr.trim().length > 5;
    finalAnswer = hasValidAnswer ? mergeAnswer(q.answer, ansStr) : '见下方解析';
  } else {
    finalAnswer = mergeAnswer(q.answer, ansStr);
  }

  const updatedFields: Partial<Question> = {
    answer: finalAnswer,
    analysis: mergeAnalysis(q.analysis, anaStr),
    answerSource: 'direct' as const,
    status: 'matched' as const,
  };
  if (isFillBlankType(q.questionType) && q.blankCount > 1 && ansStr) {
    const parts = splitAnswerByBlanks(ansStr, q.blankCount);
    if (parts) {
      updatedFields.blankAnswers = parts;
      updatedFields.answer = undefined; // 多空位时不保留父题答案字段
    }
  }
  return {
    ...q,
    ...updatedFields,
  };
}

type FlowStage = 'cutting' | 'recognizing' | 'matched';

// 子题类型（用于复合题：完形填空、阅读理解、任务型阅读等）
interface SubQuestion {
  id: number;
  questionType: string;
  content: string;
  answer: string;
  analysis: string;
  optionCount?: number;
  optionContents?: Record<string, string>;
  blankCount?: number;         // 填空题的填空数（默认1）
  blankAnswers?: string[];     // 各空位答案，如 ['A', 'B', 'C']
}

// ========== 子题自动拆分（识别模式）==========

/** 子题标记正则：匹配 (1) (2) / （1）（2） / ① ② ③ 等 */
const SUB_Q_MARKERS = /\((\d+)\)[\s、.。,，]|（(\d+)）[\s、.。,，]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g;

/**
 * 从文本中检测并拆分子题
 * @returns 拆分后的 SubQuestion 数组，无子题时返回 null
 */
function splitSubQuestionsFromText(
  content: string,
  answer: string = '',
  analysis: string = '',
  validTypes: string[] = []
): SubQuestion[] {
  if (!content) return [];

  // 收集所有子题标记及其位置
  const markers: { index: number; pos: number; num: string; fullMatch: string }[] = [];
  let match: RegExpExecArray | null;
  SUB_Q_MARKERS.lastIndex = 0; // 重置正则

  while ((match = SUB_Q_MARKERS.exec(content)) !== null) {
    const circledIndex = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.indexOf(match[0].trim()[0]);
    const num = match[1] || match[2] || (circledIndex >= 0 ? String(circledIndex + 1) : '');
    markers.push({
      index: markers.length,
      pos: match.index,
      num,
      fullMatch: match[0],
    });
  }

  // 至少需要2个子题标记才触发拆分
  if (markers.length < 2) return [];

  // 按标记拆分内容
  const subs: SubQuestion[] = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const startContentPos = m.pos + m.fullMatch.length;
    const endContentPos = i < markers.length - 1 ? markers[i + 1].pos : content.length;

    const subContent = content.slice(startContentPos, endContentPos).trim();

    // 尝试拆分答案和解析（多策略智能拆分，传入总标记数用于均分兜底）
    const [subAnswer, subAnalysis] = splitAnswerAnalysisByMarker(answer, analysis, m.num, i, markers.length);

    subs.push({
      id: Date.now() + i,
      questionType: resolveQuestionType(undefined, subContent, validTypes),
      content: subContent,
      answer: subAnswer,
      analysis: subAnalysis,
      optionCount: 4,
      optionContents: {},
      blankCount: 1,
      blankAnswers: [],
    });
  }

  // 主题干 = 第一个标记之前的内容
  return subs;
}

/**
 * 按子题编号拆分答案和解析文本（增强版）
 * 多策略依次尝试，尽可能将整段答案/解析按子题标记分发到各子题
 */
function splitAnswerAnalysisByMarker(
  answer: string,
  analysis: string,
  markerNum: string,
  markerIndex: number,
  totalMarkers: number = 0
): [string, string] {
  let subAnswer = '';
  let subAnalysis = '';

  // ===== 策略1：在答案/解析中直接检测子题标记位置，按位置切分 =====
  if (!subAnswer && answer) {
    subAnswer = splitTextBySubMarkers(answer, markerIndex, totalMarkers);
  }
  if (!subAnalysis && analysis) {
    subAnalysis = splitTextBySubMarkers(analysis, markerIndex, totalMarkers);
  }

  // ===== 策略2：按编号前缀匹配（如 "1." "1、" "(1)" 等）=====
  if (!subAnswer && answer) {
    subAnswer = splitTextByNumberPrefix(answer, markerNum, markerIndex);
  }
  if (!subAnalysis && analysis) {
    subAnalysis = splitTextByNumberPrefix(analysis, markerNum, markerIndex);
  }

  return [subAnswer, subAnalysis];
}

/**
 * 策略1：在文本中直接检测子题标记（与题干相同的标记体系），按位置切分
 * 匹配 (1)(2) / （1）（2）/ ①②③ / 1)、2) 等格式
 */
function splitTextBySubMarkers(text: string, targetIndex: number, totalCount: number): string {
  // 子题标记正则（覆盖常见中文试卷格式）
  const markerPatterns: RegExp[] = [
    // (1) / (2) / (10)
    new RegExp('\\((\\d{1,2})\\)[\\s\\u3001.\\u3002,\\uff0c\\uff1a\\uff1a\\)]*', 'g'),
    // （1）（2）（全角括号）
    new RegExp('\\uFF08(\\d{1,2})\\uFF09[\\s\\u3001.\\u3002,\\uff0c\\uff1a\\uff1a\\)]*', 'g'),
    // 带圈数字 ①②③
    new RegExp('[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳][\\s\\u3001.\\u3002,\\uff0c\\uff1a\\uff1a\\)]*', 'g'),
    // 1)、2)、3)
    new RegExp('(\\d{1,2})[\\)\\uFF09][\\s\\u3001.\\u3002,\\uff0c\\uff1a]?', 'g'),
    // 1.、2.、3.
    new RegExp('(\\d{1,2})[\\.．][\\s]?', 'g'),
    // 1、2、3、
    new RegExp('(\\d{1,2})[\\u3001]', 'g'),
  ];

  for (const regex of markerPatterns) {
    const positions: Array<{ idx: number; num: number }> = [];
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;

    while ((m = regex.exec(text)) !== null) {
      const circledIndex = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.indexOf(m[0].trim()[0]);
      const num = m[1] ? parseInt(m[1], 10) : circledIndex + 1;
      if (num > 0) {
        positions.push({ idx: m.index, num });
      }
    }

    // 至少找到 totalCount 个标记才用这个模式
    if (positions.length >= Math.max(totalCount, 2)) {
      // 按序号排序
      positions.sort((a, b) => a.num - b.num);

      // 取目标索引对应的片段
      if (targetIndex < positions.length) {
        const start = positions[targetIndex].idx;
        const end = targetIndex + 1 < positions.length ? positions[targetIndex + 1].idx : text.length;
        return text.slice(start, end).trim();
      }
      // 如果 targetIndex 超出但有多余内容，取最后一段
      if (targetIndex === positions.length && positions.length > 0) {
        return text.slice(positions[positions.length - 1].idx).trim();
      }
    }
    // 如果找到了恰好等于或大于 targetIndex+1 的标记数，也尝试使用
    if (positions.length >= targetIndex + 1 && positions.length >= 2) {
      positions.sort((a, b) => a.num - b.num);
      const start = positions[targetIndex].idx;
      const end = targetIndex + 1 < positions.length ? positions[targetIndex + 1].idx : text.length;
      return text.slice(start, end).trim();
    }
  }

  return '';
}

/**
 * 策略2：按指定编号前缀匹配拆分
 * 如 markerNum="1" 时匹配 "1)" "1、" "1." "（1）" "(1)" 开头的段落
 */
function splitTextByNumberPrefix(text: string, markerNum: string, targetIndex: number): string {
  const escaped = escapeRegex(markerNum);
  const patterns = [
    // (1) 或 （1）开头
    new RegExp(`(?:^|\\n)\\s*[\\(（]${escaped}[\\)）][\\s、.。,，:：]?\\s*`, 'gm'),
    // 1. 或 1、开头
    new RegExp(`(?:^|\\n)\\s*${escaped}[\\.\\.、\\)）][\\s]?`, 'gm'),
    // 第1问 / 第1小题 开头
    new RegExp(`(?:^|\\n)\\s*第\\s*${escaped}\\s*(?:问|小题|部分)[\\s:：]?`, 'gm'),
    // ① 如果 markerNum 是数字，也检查带圈形式
    ...(markerNum.match(/^\d+$/) ? [
      new RegExp(`(?:^|\\n)\\s*[${circledNumber(parseInt(markerNum, 10))}][\\s、.。,，:：]?`, 'gm'),
    ] : []),
  ];

  for (const pat of patterns) {
    const parts: Array<{ idx: number; text: string }> = [];
    let m: RegExpExecArray | null;
    pat.lastIndex = 0;

    while ((m = pat.exec(text)) !== null) {
      parts.push({ idx: m.index, text: m[0] });
    }

    if (parts.length > targetIndex) {
      const start = parts[targetIndex].idx;
      const end = targetIndex + 1 < parts.length ? parts[targetIndex + 1].idx : text.length;
      return text.slice(start, end).trim();
    }
  }

  return '';
}

/**
 * 策略3：将文本按段落/换行/句子均分为 N 份
 * 当无法通过标记拆分时的兜底方案
 */
function splitTextEvenly(text: string, targetIndex: number, totalParts: number): string {
  if (!text.trim()) return '';

  // 尝试双换行（段落边界）
  const paraParts = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (paraParts.length >= totalParts) {
    return distributeToSlot(paraParts, targetIndex, totalParts);
  }

  // 尝试单换行
  const lineParts = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (lineParts.length >= totalParts) {
    return distributeToSlot(lineParts, targetIndex, totalParts);
  }

  // 尝试句号分号
  const sentParts = text.split(/(?<=[。；;])\s*/).map(s => s.trim()).filter(Boolean);
  if (sentParts.length >= totalParts) {
    return distributeToSlot(sentParts, targetIndex, totalParts);
  }

  // 最后手段：按字符长度均分
  return splitByCharLength(text, targetIndex, totalParts);
}

/** 将数组元素分配到目标槽位 */
function distributeToSlot(parts: string[], targetIndex: number, totalSlots: number): string {
  const baseCount = Math.floor(parts.length / totalSlots);
  const extra = parts.length % totalSlots;
  const slotSize = baseCount + (targetIndex < extra ? 1 : 0);

  let offset = 0;
  for (let i = 0; i < targetIndex; i++) {
    offset += Math.floor(parts.length / totalSlots) + (i < extra ? 1 : 0);
  }

  return parts.slice(offset, offset + slotSize).join('\n').trim();
}

/** 按字符长度均分文本 */
function splitByCharLength(text: string, targetIndex: number, totalParts: number): string {
  const chunkSize = Math.ceil(text.length / totalParts);
  const start = chunkSize * targetIndex;
  const end = Math.min(chunkSize * (targetIndex + 1), text.length);
  return text.slice(start, end).trim();
}

/** 数字转带圈数字 */
function circledNumber(n: number): string {
  const chars = '〇①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  return n < chars.length ? chars[n] : '';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 旧版 Question 类型（兼容现有接口）
export interface Question {
  id: number;
  number: number;
  content: string;
  status: 'matched' | 'pending_confirm' | 'no_answer';
  answer?: string;
  analysis?: string;
  answerSource?: 'direct' | 'extracted' | 'manual';
  boxId: string;
  box: QuestionBox;
  questionType: string;
  showRecognizedContent: boolean;
  croppedImageData?: string;               // 原始完整框截图（始终保留，作为恢复原图的基准）
  userCroppedImageData?: string;          // 用户手动裁剪后的图片（用于下发给学生）
  optionCount: number;                    // 选择题选项数，默认4
  optionContents: Record<string, string>; // 新增选项内容，如 {E: '选项E内容', F: '选项F内容'}
  subQuestions?: SubQuestion[];           // 复合题的子题
  blankCount: number;                     // 填空题的填空数，默认1
  blankAnswers: string[];                 // 各空位答案，如 ['A', 'B', 'C']
}


// 支持填空数能力的题型（选词填空、短文填空与普通填空题共享多空位答案能力）
const isFillBlankType = (t: string) => ['填空题', '选词填空', '短文填空'].includes(t);

interface QuestionMatchInfo {
  hasAnswer: boolean;
  hasAnalysis: boolean;
  missingAnswer: boolean;
  missingAnalysis: boolean;
  missingLabel: string | null;
  subTotal: number;
  matchedSubCount: number;
  pendingSubCount: number;
  incompleteItemCount: number;
  needsManualSplit: boolean;
}

function isUsableAnswerText(value?: string): boolean {
  const text = value?.trim() || '';
  return !!text && !/^第\d+空答案$/.test(text) && text !== '暂无答案';
}

function hasUsableAnswer(entity: { answer?: string; blankAnswers?: string[] }): boolean {
  return isUsableAnswerText(entity.answer) || !!entity.blankAnswers?.some(isUsableAnswerText);
}

function hasUsableAnalysis(entity: { analysis?: string }): boolean {
  return !!entity.analysis?.trim();
}

function hasParentAnswerClearContent(entity: { answer?: string; blankAnswers?: string[]; analysis?: string }): boolean {
  return hasUsableAnswer(entity) || hasUsableAnalysis(entity);
}

function hasSubAnswerClearContent(question: Question): boolean {
  return !!question.subQuestions?.some(hasParentAnswerClearContent);
}

function getBoxOverlapStats(a: QuestionBox, b: QuestionBox) {
  if (a.pageNumber !== b.pageNumber) {
    return { overlapRatio: 0, iou: 0 };
  }

  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapWidth = Math.max(0, right - left);
  const overlapHeight = Math.max(0, bottom - top);
  const overlapArea = overlapWidth * overlapHeight;
  const aArea = Math.max(1, a.width * a.height);
  const bArea = Math.max(1, b.width * b.height);
  const unionArea = aArea + bArea - overlapArea;

  return {
    overlapRatio: overlapArea / Math.min(aArea, bArea),
    iou: overlapArea / Math.max(1, unionArea),
  };
}

function getQuestionSourceBox(question: Question, boxes: QuestionBox[]) {
  return question.box ?? boxes.find((box) => box.id === question.boxId);
}

function findLikelyReRecognizedQuestion(
  box: QuestionBox,
  questions: Question[],
  boxes: QuestionBox[],
) {
  const matches = questions
    .map((question) => {
      const sourceBox = getQuestionSourceBox(question, boxes);
      if (!sourceBox) return null;
      const stats = getBoxOverlapStats(box, sourceBox);

      if (stats.overlapRatio < 0.65 || stats.iou < 0.2) return null;

      return { question, ...stats };
    })
    .filter((match): match is { question: Question; overlapRatio: number; iou: number } => Boolean(match))
    .sort((a, b) => b.iou - a.iou || b.overlapRatio - a.overlapRatio);

  if (matches.length === 0) return null;

  const [best, second] = matches;
  if (second && Math.abs(best.iou - second.iou) < 0.03 && Math.abs(best.overlapRatio - second.overlapRatio) < 0.05) {
    return null;
  }

  return best.question;
}

function insertQuestionsByQuestionNumber(current: Question[], incoming: Question[]) {
  const orderedIncoming = incoming
    .map((question, index) => ({ question, index }))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.question.number) && a.question.number > 0;
      const bValid = Number.isFinite(b.question.number) && b.question.number > 0;

      if (aValid && bValid) return a.question.number - b.question.number || a.index - b.index;
      if (aValid !== bValid) return aValid ? -1 : 1;
      return a.index - b.index;
    });

  const next = [...current];

  orderedIncoming.forEach(({ question }) => {
    if (!Number.isFinite(question.number) || question.number <= 0) {
      next.push(question);
      return;
    }

    const insertIndex = next.findIndex(
      (existing) => Number.isFinite(existing.number) && existing.number > question.number,
    );

    if (insertIndex === -1) {
      next.push(question);
    } else {
      next.splice(insertIndex, 0, question);
    }
  });

  return next;
}

function getMissingLabel(missingAnswer: boolean, missingAnalysis: boolean): string | null {
  if (missingAnswer && missingAnalysis) return '未匹配到答案和解析';
  if (missingAnswer) return '未匹配到答案';
  if (missingAnalysis) return '未匹配到解析';
  return null;
}

function getQuestionMatchInfo(question: Question): QuestionMatchInfo {
  const subQuestions = question.subQuestions || [];
  const parentHasAnswer = hasUsableAnswer(question);
  const parentHasAnalysis = hasUsableAnalysis(question);

  if (subQuestions.length === 0) {
    const missingAnswer = !parentHasAnswer;
    const missingAnalysis = !parentHasAnalysis;
    return {
      hasAnswer: parentHasAnswer,
      hasAnalysis: parentHasAnalysis,
      missingAnswer,
      missingAnalysis,
      missingLabel: getMissingLabel(missingAnswer, missingAnalysis),
      subTotal: 0,
      matchedSubCount: 0,
      pendingSubCount: 0,
      incompleteItemCount: missingAnswer || missingAnalysis ? 1 : 0,
      needsManualSplit: false,
    };
  }

  const subInfos = subQuestions.map((sub) => ({
    hasAnswer: hasUsableAnswer(sub),
    hasAnalysis: hasUsableAnalysis(sub),
  }));
  const matchedSubCount = subInfos.filter((info) => info.hasAnswer && info.hasAnalysis).length;
  const pendingSubCount = subInfos.length - matchedSubCount;
  const subMissingAnswer = subInfos.some((info) => !info.hasAnswer);
  const subMissingAnalysis = subInfos.some((info) => !info.hasAnalysis);
  const needsManualSplit = (parentHasAnswer || parentHasAnalysis) && pendingSubCount > 0;

  return {
    hasAnswer: parentHasAnswer || !subMissingAnswer,
    hasAnalysis: parentHasAnalysis || !subMissingAnalysis,
    missingAnswer: !parentHasAnswer && subMissingAnswer,
    missingAnalysis: !parentHasAnalysis && subMissingAnalysis,
    missingLabel: getMissingLabel(!parentHasAnswer && subMissingAnswer, !parentHasAnalysis && subMissingAnalysis),
    subTotal: subInfos.length,
    matchedSubCount,
    pendingSubCount,
    incompleteItemCount: subInfos.filter((info) => !info.hasAnswer || !info.hasAnalysis).length,
    needsManualSplit,
  };
}

/**
 * 格式化识别后的题目文本：选项和子题序号前自动换行
 */
function formatRecognizedContent(text: string): string {
  if (!text) return text;
  let formatted = text;

  // 1. 选项换行：A. B. C. D. 或 A、 B、 C、 D、 或 A) B) C) D)
  // 使用正向回顾后发，避免在已有换行符后重复换行
  // 匹配前面不是换行符的选项标记
  formatted = formatted.replace(/([^\n])(\s*)([A-Da-d][\.、\)．])\s*/g, '$1\n$3');

  // 2. 子题序号换行：(1) (2) (3) 或 (1). (2). 或 （1）（2） 或 1. 2. 3.
  // 中文括号子题序号
  formatted = formatted.replace(/([^\n])(\s*)(（[0-9]+[）\.．])\s*/g, '$1\n$3');
  // 英文括号子题序号
  formatted = formatted.replace(/([^\n])(\s*)(\([0-9]+[\)\.．])\s*/g, '$1\n$3');
  // 纯数字序号（带点的，如 1. 2. 3.）—— 需要更严格的上下文避免误匹配题号
  // 只匹配前面有特定标点（如句号、分号、问号、感叹号）或空白后的数字序号
  formatted = formatted.replace(/([。；？!\!\?\;])(\s*)([0-9]+\.\s)/g, '$1\n$3');

  return formatted;
}

export function UploadQuestionDialog({
  onClose,
  onQuestionSelect,
  onAddToPaper,
  uploadedFiles,
  subjectInfo,
  fileRanges,
  onContinueUpload,
  onSupplementUpload,
  onReupload,
  onDeleteFile,
  onUpdateFileRange,
  fileTotalPages
}: UploadQuestionDialogProps) {
  const router = useRouter();
  // ==================== 状态持久化 key ====================
  const DIALOG_STATE_KEY = 'leke_upload_dialog_state';
  // ==================== 根据学科动态计算有效题型 ====================
  const validQuestionTypes = getValidQuestionTypes(subjectInfo || '');
  const questionTypes = validQuestionTypes;
  const requirementReader = useRequirementReader();

  const compoundQuestionTypes = validQuestionTypes.filter(t =>
    ['完形填空', '阅读理解', '任务型阅读', '问答题', '翻译题', '书面表达',
     '解答题', '证明题', '材料题', '综合题', '实验探究题'].includes(t)
  );
  const choiceQuestionTypes = validQuestionTypes.filter(t =>
    ['单选题', '多选题'].includes(t)
  );

  // ==================== 工作模式和流程阶段 ====================
  const [workMode, setWorkMode] = useState<WorkMode | null>(null);       // 选择的工作模式
  const [flowStep, setFlowStep] = useState<FlowStep>('select_mode');     // 当前流程步骤
  
  // 兼容旧的 FlowStage（内部映射）
  const [flowStage, setFlowStage] = useState<FlowStage>('cutting');

  useEffect(() => {
    if (!requirementReader) {
      return;
    }

    requirementReader.setActiveRequirementIds(getActiveUploadDialogRequirementIds(flowStep));

    return () => requirementReader.setActiveRequirementIds(null);
  }, [flowStep, requirementReader]);
  
  // 重新识别后高亮标记（自动清除）
  const [highlightedQuestionIds, setHighlightedQuestionIds] = useState<Set<number>>(new Set());

  // 答案识别加载状态 & 匹配失败标记
  const [answerProcessingForQuestionIds, setAnswerProcessingForQuestionIds] = useState<Set<number | string>>(new Set());
  const [answerMatchFailedForQuestionIds, setAnswerMatchFailedForQuestionIds] = useState<Set<number | string>>(new Set());

  // 文件角色管理（双文件场景）
  const [fileRoles, setFileRoles] = useState<FileRoleInfo[]>([]);        // 每个文件的角色
  const [showFileRolePanel, setShowFileRolePanel] = useState(false);      // 是否显示文件角色分配面板
  const [fileRolePanelFileIds, setFileRolePanelFileIds] = useState<string[] | null>(null); // null=全部文件, 数组=只显示指定文件
  const [reRecognizingIds, setReRecognizingIds] = useState<Set<number>>(new Set()); // 正在重新识别的题目ID
  const [flashNewIds, setFlashNewIds] = useState<Set<number>>(new Set()); // 新增题目闪烁绿色
  const [flashUpdateIds, setFlashUpdateIds] = useState<Set<number>>(new Set()); // 重识别题目闪烁蓝色
  useEffect(() => {
    if (!requirementReader) {
      return;
    }

    const cleanupHandlers = [
      requirementReader.registerActivationHandler(createActivationHandlerKey('setStep', 'upload_files'), () => {
        setShowFileRolePanel(false);
        setFlowStep('upload_files');
        setFlowStage('cutting');
        setManualAnswerLinking(false);
        setManualLinkTarget(null);
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('setStep', 'select_mode'), () => {
        setShowFileRolePanel(false);
        setWorkMode(null);
        setFlowStep('select_mode');
        setFlowStage('cutting');

      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('setStep', 'frame_and_review'), () => {
        setShowFileRolePanel(false);
        setWorkMode((current) => current ?? 'questions-only');
        setFlowStep('frame_and_review');
        setFlowStage('cutting');

      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('setStep', 'review'), () => {
        setShowFileRolePanel(false);
        setWorkMode((current) => current ?? 'questions-only');
        setFlowStep('review');
        setFlowStage('matched');
        setManualAnswerLinking(false);
        setManualLinkTarget(null);
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('setStep', 'manual_link'), () => {
        setShowFileRolePanel(false);
        setWorkMode((current) => current ?? 'same-file');
        setFlowStep('review');
        setFlowStage('matched');
        setManualAnswerLinking(true);
        setManualLinkTarget(null);
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('openDialog', 'SelectModeFileRoleDialog'), () => {
        if (fileRoles.length === 0 && uploadedFiles.length > 0) {
          setFileRoles(uploadedFiles.map((file) => ({
            fileName: file.name,
            role: 'unassigned' as const,
          })));
        }
        setWorkMode('same-file');
        setFlowStep('select_mode');
        setFlowStage('cutting');
        setShowFileRolePanel(true);
      }),
      requirementReader.registerActivationHandler(createActivationHandlerKey('openPanel', 'BoxStepMoreTools'), () => {
        setMoreToolsOpen(true);
      }),
    ];

    return () => cleanupHandlers.forEach((cleanup) => cleanup());
  }, [fileRoles.length, requirementReader, uploadedFiles]);

  // ==================== 多页数据 ====================
  const [pageImages, setPageImages] = useState<PageImage[]>([]);

  const [totalPages, setTotalPages] = useState(0);
  const [isPagesLoading, setIsPagesLoading] = useState(true);
  
  // 文件类型信息
  const [fileType, setFileType] = useState<'pdf' | 'image' | 'unknown'>('unknown');
  
  // 画框相关
  const [questionBoxes, setQuestionBoxes] = useState<QuestionBox[]>([]);
  const [reviewHiddenBoxIds, setReviewHiddenBoxIds] = useState<Set<string>>(new Set());
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number; pageNumber: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<Partial<QuestionBox> | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ boxId: string; direction: string; initialW: number; initialH: number } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [moving, setMoving] = useState<{ boxId: string; startX: number; startY: number; initialX: number; initialY: number; initialW: number; initialH: number } | null>(null);
  
  // 题目和答案数据
  const [questions, setQuestions] = useState<Question[]>([]);
  const [batchProcessing, setBatchProcessing] = useState(false); // 批量识别+匹配流程中，控制右侧显示进度还是题目
  const prevQuestionCountRef = useRef(0);
  const customProgressRef = useRef(false); // handleBatchMove 已设置自定义进度文案
  const prevReRecognizingIdsRef = useRef<Set<number>>(new Set());
  const prevBatchProcessingRef = useRef(false);
  const maxQuestionIdRef = useRef(0);

  // 识别完成后触发闪烁动画
  useEffect(() => {
    const wasProcessing = prevBatchProcessingRef.current;
    prevBatchProcessingRef.current = batchProcessing;
    if (wasProcessing && !batchProcessing && questions.length > 0) {
      // 重识别题目闪烁蓝色
      if (prevReRecognizingIdsRef.current.size > 0) {
        setFlashUpdateIds(new Set(prevReRecognizingIdsRef.current));
        setTimeout(() => setFlashUpdateIds(new Set()), 2500);
      }
      // 新增题目闪烁绿色（ID大于识别前最大ID的题目）
      const maxId = maxQuestionIdRef.current;
      const newIds = new Set(questions.filter(q => q.id > maxId).map(q => q.id));
      if (newIds.size > 0) {
        setFlashNewIds(newIds);
        setTimeout(() => setFlashNewIds(new Set()), 2500);
      }
    }
  }, [batchProcessing, questions.length]);
  const [answers, setAnswers] = useState<AnswerMarker[]>([]);
  const [pendingAnswerTargetId, setPendingAnswerTargetId] = useState<number | null>(null); // 类型弹窗中临时选择的关联题号
  const [showAnswerLinkPicker, setShowAnswerLinkPicker] = useState(false); // 第二步画答案框后的关联题号选择器
  const [pendingLinkBoxId, setPendingLinkBoxId] = useState<string | null>(null); // 待关联的答案框ID
  const [manualAnswerLinking, setManualAnswerLinking] = useState(false); // 第四步内的手动关联答案子状态
  const [manualLinkTarget, setManualLinkTarget] = useState<ManualLinkTarget | null>(null); // 从题卡答案/解析入口进入时的定向回填目标
  const [recognitionResult, setRecognitionResult] = useState<RecognitionResult | null>(null);
  
  // 使用 ref 存储最新的 questions，解决闭包问题
  const questionsRef = useRef<Question[]>(questions);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  // 需求角标相关
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const requirementsById = useMemo(
    () => createRequirementMap(uploadQuestionDialogMarkerRegistries.flatMap((registry) => registry.requirements)),
    [],
  );
  const displayNumbersByRequirementId = useMemo(
    () => createRequirementDisplayNumberMap(uploadQuestionDialogMarkerRegistries),
    [],
  );
  const renderRequirementMarker = (
    requirementId: string,
    className: string,
    displayNumber?: number,
  ) => {
    const requirement = requirementsById.get(requirementId);
    if (!requirement) return null;
    const resolvedDisplayNumber = displayNumbersByRequirementId.get(requirementId) ?? displayNumber;
    return (
      <RequirementMarker
        requirement={requirement}
        isOpen={selectedRequirementId === requirementId}
        displayNumber={resolvedDisplayNumber}
        className={className}
        onToggle={() =>
          setSelectedRequirementId((current) => (current === requirementId ? null : requirementId))
        }
        onClose={() => setSelectedRequirementId(null)}
      />
    );
  };

  // UI 状态
  const [viewMode, setViewMode] = useState<'image' | 'recognize'>('image');
  const [isModeChanging, setIsModeChanging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRecognitionBoxIdsRef = useRef<string[]>([]);
  const [zoom, setZoom] = useState(100);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [highlightedQuestionId, setHighlightedQuestionId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null); // 正在编辑题号的题目ID
  const [matchBannerCollapsed, setMatchBannerCollapsed] = useState(false); // 答案匹配提示是否收起

  // 框类型选择弹窗状态
  const [pendingBoxTypeSelection, setPendingBoxTypeSelection] = useState<string | null>(null); // 待选类型的框ID
  const [tempSelectedType, setTempSelectedType] = useState<BoxTypeOption>('question'); // 弹窗中临时选中的类型，默认「仅题干」
  // 已有框的类型编辑状态
  const [editingBoxTypeId, setEditingBoxTypeId] = useState<string | null>(null); // 正在编辑类型的框ID

  // AI 自动预检测状态
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);   // 是否正在预检测
  const [autoDetectProgress, setAutoDetectProgress] = useState(''); // 预检测进度文字
  const [hasAutoDetected, setHasAutoDetected] = useState(false);   // 是否已完成预检测

  // 手动删除所有框后清除自动检测完成提示
  useEffect(() => {
    if (questionBoxes.length === 0) {
      setAutoDetectProgress('');
    }
  }, [questionBoxes.length]);

  // ==================== 状态持久化：保存 & 恢复 ====================

  // 保存核心状态到 sessionStorage（在加入试卷前调用）
  const saveDialogState = useCallback(() => {
    try {
      // pageImages 可能很大，只保存 imageData（base64），不保存 DOM 相关字段
      const pagesToSave = pageImages.map(p => ({
        pageNumber: p.pageNumber,
        sourceFileIndex: p.sourceFileIndex,
        sourcePageNumber: p.sourcePageNumber,
        width: p.width,
        height: p.height,
        imageData: p.imageData, // base64 图片数据
      }));
      const stateToSave = {
        workMode,
        flowStep,
        questions,
        answers,
        questionBoxes,
        fileRoles,
        fileType,
        totalPages,
        previewImage,
        pagesToSave,
      };
      sessionStorage.setItem(DIALOG_STATE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.warn('[UploadDialog] 状态保存失败:', e);
    }
  }, [workMode, flowStep, questions, answers, questionBoxes, fileRoles, fileType]);

  // 从 sessionStorage 恢复状态（组件挂载时执行一次）
  const [isRestored, setIsRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DIALOG_STATE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.workMode) setWorkMode(state.workMode);
        if (state.flowStep === 'manual_link') {
          setFlowStep('review');
          setManualAnswerLinking(true);
          setManualLinkTarget(null);
        } else if (state.flowStep) {
          setFlowStep(state.flowStep);
        }
        if (state.questions?.length) setQuestions(state.questions);
        if (state.answers?.length) setAnswers(state.answers);
        if (state.questionBoxes?.length) setQuestionBoxes(state.questionBoxes);
        if (state.fileRoles?.length) setFileRoles(state.fileRoles);
        if (state.fileType) setFileType(state.fileType);
        // 恢复图片预览相关状态
        if (state.totalPages != null) setTotalPages(state.totalPages);
        if (state.previewImage) setPreviewImage(state.previewImage);
        // 恢复页面图片数据（左侧预览区）
        if (state.pagesToSave?.length) {
          setPageImages(state.pagesToSave.map((p: { pageNumber: number; sourceFileIndex: number; sourcePageNumber: number; width: number; height: number; imageData: string }) => ({
            ...p,
            imageRef: null, // DOM ref 需要重新创建
          })));
        }
        sessionStorage.removeItem(DIALOG_STATE_KEY);
      }
    } catch (e) {
      console.warn('[UploadDialog] 状态恢复失败:', e);
    }
    setIsRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 图片裁剪相关状态
  const [croppingQuestionId, setCroppingQuestionId] = useState<number | null>(null); // 正在裁剪的题目ID
  const [cropRegion, setCropRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [cropDragType, setCropDragType] = useState<'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-w' | 'resize-e' | null>(null);
  const [cropDragStart, setCropDragStart] = useState<{ mouseX: number; mouseY: number; regionX: number; regionY: number; regionW: number; regionH: number } | null>(null);
  const [imageDisplaySize, setImageDisplaySize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  // 用 ref 记录每道题图片的实际渲染尺寸（解决图片缓存后 onLoad 不触发的问题）
  const imageSizesRef = useRef<Map<number, { width: number; height: number }>>(new Map());

  // refs
  const containerRef = useRef<HTMLDivElement>(null);
  const questionListRef = useRef<HTMLDivElement>(null);
  const processedFilesCountRef = useRef<number>(0); // 已处理的文件数量，用于追加模式
  const autoDetectedPageCountRef = useRef<number>(0); // 已自动切题的页面数量，用于追加模式只切新页面
  const displayWidth = 450; // 显示宽度
  const prdPanelOffsetStyle = { right: 'var(--prd-side-panel-right, 0px)' };

  // 框类型定义
  type BoxTypeOption = 'question' | 'answer' | 'full';

  /** 确认框类型选择 */
  const handleConfirmBoxType = (boxId: string, type: BoxTypeOption) => {
    // 如果是答案类型，同时记录关联的题号信息
    if (type === 'answer' && pendingAnswerTargetId) {
      const targetQuestion = questions.find(q => q.id === pendingAnswerTargetId);
      setQuestionBoxes(prev => prev.map(box =>
        box.id === boxId
          ? { ...box, type, linkedQuestionId: pendingAnswerTargetId, questionNumber: targetQuestion?.number }
          : box
      ));
    } else {
      setQuestionBoxes(prev => prev.map(box =>
        box.id === boxId ? { ...box, type } : box
      ));
    }
    setPendingAnswerTargetId(null);
    setPendingBoxTypeSelection(null);
  };

  /** 取消框类型选择（删除该框） */
  const handleCancelBoxType = (boxId: string) => {
    setQuestionBoxes(prev => prev.filter(box => box.id !== boxId));
    setPendingAnswerTargetId(null);
    setPendingBoxTypeSelection(null);
  };

  /** 已有框修改类型 */
  const handleEditBoxType = (boxId: string) => {
    // 编辑时预填当前关联的题目 ID
    const box = questionBoxes.find(b => b.id === boxId);
    setPendingAnswerTargetId(box?.linkedQuestionId ?? null);
    setEditingBoxTypeId(boxId);
  };

  /** 确认修改已有框类型 → 重置为待识别状态 */
  const handleConfirmEditBoxType = (type: BoxTypeOption) => {
    if (!editingBoxTypeId) return;
    // 如果是答案类型，同时更新关联题号
    if (type === 'answer' && pendingAnswerTargetId) {
      const targetQuestion = questions.find(q => q.id === pendingAnswerTargetId);
      setQuestionBoxes(prev => prev.map(box =>
        box.id === editingBoxTypeId
          ? { ...box, type, recognized: false, linkedQuestionId: pendingAnswerTargetId, questionNumber: targetQuestion?.number }
          : box
      ));
    } else {
      setQuestionBoxes(prev => prev.map(box =>
        box.id === editingBoxTypeId
          ? { ...box, type, recognized: false, questionNumber: undefined, linkedQuestionId: undefined }
          : box
      ));
    }
    setPendingAnswerTargetId(null);
    setEditingBoxTypeId(null);
  };

  /** 取消修改已有框类型 */
  const handleCancelEditBoxType = () => {
    setEditingBoxTypeId(null);
  };

  // ==================== 腾讯云智能切题 ====================

  /**
   * 自动切题：调用腾讯云教育智能切题服务，自动识别题目区域
   * 腾讯云返回像素坐标，API层已转换为百分比坐标，此处再转为显示像素坐标
   */
  const runAutoDetectBoxes = useCallback(async () => {
    if (!pageImages || pageImages.length === 0 || isAutoDetecting) return;

    // 只处理新上传的页面（追加模式下）
    const startIndex = autoDetectedPageCountRef.current;
    if (startIndex >= pageImages.length) {
      setHasAutoDetected(true);
      return; // 没有新页面需要切题
    }

    const newPages = pageImages.slice(startIndex);

    // 模式三（跨文件）：仅对题目文件进行自动切题（无文件角色时默认全部视为题目文件）
    const pagesForDetect = workMode === 'cross-file'
      ? newPages.filter(p => {
          const role = p.sourceFileIndex !== undefined ? fileRoles[p.sourceFileIndex]?.role : null;
          return !role || role === 'question';
        })
      : newPages;

    if (pagesForDetect.length === 0) {
      setHasAutoDetected(true);
      return;
    }

    setIsAutoDetecting(true);
    setAutoDetectProgress('正在调用腾讯云切题服务...');
    setHasAutoDetected(false);

    try {
      const response = await fetch('/api/auto-detect-boxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: pagesForDetect }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `请求失败(${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalBoxes: Array<any> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(trimmed.slice(6));
            if (event.type === 'progress') {
              setAutoDetectProgress(event.data.message);
            } else if (event.type === 'complete') {
              finalBoxes = event.data.result.boxes;
            } else if (event.type === 'error') {
              throw new Error(event.data.error);
            }
          } catch {
            // 忽略解析错误的行
          }
        }
      }

      // 将 AI 返回的百分比坐标转换为 QuestionBox
      if (finalBoxes && finalBoxes.length > 0) {
        console.log('[AutoDetect] AI 原始返回:', JSON.stringify(finalBoxes.slice(0, 3)));

        const newBoxes: QuestionBox[] = finalBoxes
          .map((aiBox, index) => {
            // 安全校验页码：AI 返回的页码基于 newPages 数组（1-based），需加上 startIndex 偏移
            let safePageNum = (aiBox.pageNumber || 1) + startIndex;
            if (safePageNum < 1) safePageNum = 1;
            if (safePageNum > pageImages.length) safePageNum = pageImages.length;
            safePageNum = Math.round(safePageNum);

            const pageInfo = pageImages[safePageNum - 1];
            const imgWidth = pageInfo?.width || 595;
            const imgHeight = pageInfo?.height || 842;
            // 图片宽高比
            const aspectRatio = imgHeight / imgWidth;
            // 显示宽度固定为 displayWidth(450px)，高度按比例
            const displayH = displayWidth * aspectRatio;

            // 百分比 → 像素坐标（安全钳制）
            const x = Math.max(0, Math.min((aiBox.x / 100) * displayWidth, displayWidth - 10));
            const y = Math.max(0, Math.min((aiBox.y / 100) * displayH, displayH - 10));
            const w = Math.max(10, Math.min((aiBox.width / 100) * displayWidth, displayWidth - x));
            const h = Math.max(10, Math.min((aiBox.height / 100) * displayH, displayH - y));

            const box: QuestionBox = {
              id: `auto-${Date.now()}-${index}`,
              x,
              y,
              width: w,
              height: h,
              isSelected: true,
              pageNumber: safePageNum,
              recognized: false,
              type: aiBox.type as 'question' | 'answer' | 'full',
            };

            console.log(`[AutoDetect] 框${index}: page=${box.pageNumber}(raw=${aiBox.pageNumber}, offset=${startIndex}) type=${box.type} pos=(${Math.round(box.x)},${Math.round(box.y)}) size=${Math.round(box.width)}x${Math.round(box.height)}`);

            return box;
          })
          .filter(b => b.width > 10 && b.height > 10); // 过滤掉过小的框

        // 按页号分组统计
        const byPage: Record<number, number> = {};
        newBoxes.forEach(b => { byPage[b.pageNumber] = (byPage[b.pageNumber] || 0) + 1; });
        console.log('[AutoDetect] 各页框分布:', byPage, '总计:', newBoxes.length);

        // 追加到已有框（追加模式不覆盖已有框）
        setQuestionBoxes(prev => [...prev, ...newBoxes]);
        setAutoDetectProgress(`检测完成！共发现 ${newBoxes.length} 个内容区域，请检查调整`);
      } else {
        setAutoDetectProgress('未检测到内容区域，可手动画框');
      }

      // 更新已切题页面计数
      autoDetectedPageCountRef.current = pageImages.length;
      setHasAutoDetected(true);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('自动预检测失败:', msg);
      setAutoDetectProgress(`切题失败：${msg}（可手动画框）`);
      setHasAutoDetected(true); // 标记已尝试过，不再重复触发
    } finally {
      setIsAutoDetecting(false);
    }
  }, [pageImages, isAutoDetecting, displayWidth]);

  /** 手动重新触发切题 */
  const handleRetryAutoDetect = () => {
    setHasAutoDetected(false);
    setQuestionBoxes([]);
    setReviewHiddenBoxIds(new Set());
    autoDetectedPageCountRef.current = 0; // 重置切题计数，重新切全部页面
    runAutoDetectBoxes();
  };

  // 腾讯云智能切题：进入 recognize_questions 阶段且页面就绪时自动触发
  useEffect(() => {
    if (
      flowStep === 'frame_and_review' &&
      pageImages.length > 0 &&
      !hasAutoDetected &&
      !isAutoDetecting
    ) {
      // 延迟一小段时间让页面渲染完成再触发
      const timer = setTimeout(() => {
        runAutoDetectBoxes();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [flowStep, pageImages.length, hasAutoDetected, isAutoDetecting, runAutoDetectBoxes]);

  // ==================== FlowStep ↔ FlowStage 映射 ====================
  
  /** 根据 FlowStep 获取兼容的 FlowStage */
  const getCompatibleFlowStage = useCallback((): FlowStage => {
    switch (flowStep) {
      case 'select_mode': return 'cutting';
      case 'frame_and_review': return flowStage === 'recognizing' ? 'recognizing' : 'cutting';
      case 'review': return flowStage === 'recognizing' ? 'recognizing' : 'matched';
      case 'manual_link': return 'matched';
      default: return 'cutting';
    }
  }, [flowStep, flowStage]);

  /** 是否允许在左侧画框（选择识别内容和核对结果都支持） */
  const canDrawBoxes = (flowStep === 'frame_and_review' || flowStep === 'review' || flowStep === 'manual_link') && !isProcessing && !batchProcessing;

  /** 文件角色初始化：当多文件上传时自动设置 */
  useEffect(() => {
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    // 场景1：首次多文件（select_mode，未选模式） → 仅初始化 fileRoles，不弹窗
    if (uploadedFiles.length >= 2 && fileRoles.length === 0 && !workMode) {
      setFileRoles(uploadedFiles.map(f => ({ fileName: f.name, role: 'unassigned' as const })));
      return;
    }

    // 场景2：继续上传 + 分步模式（父组件通过 sessionStorage 标记追加完成）
    const appendedCount = sessionStorage.getItem('leke_appended_count');
    if (appendedCount && workMode === 'cross-file' && uploadedFiles.length >= 2) {
      sessionStorage.removeItem('leke_appended_count');
      sessionStorage.removeItem('leke_appended_names');
      const newRoles: FileRoleInfo[] = uploadedFiles.map((f, i) => {
        if (i < fileRoles.length) return fileRoles[i];
        return { fileName: f.name, role: 'unassigned' as const };
      });
      setFileRoles(newRoles);
      // 如果之前所有已有文件都已分配角色（无 unassigned），弹窗只显示新文件
      const oldRoles = fileRoles.slice(0, fileRoles.length); // 快照
      const allOldAssigned = oldRoles.length > 0 && oldRoles.every(r => r.role !== 'unassigned');
      if (allOldAssigned && oldRoles.length >= 1) {
        // 只显示新文件的 file ID（通过文件名匹配）
        const newFileNames = uploadedFiles.slice(fileRoles.length).map(f => f.name);
        setFileRolePanelFileIds(newFileNames);
      } else {
        // 全部文件都需要显示（之前未分配或只有1个文件）
        setFileRolePanelFileIds(null);
      }
      setShowFileRolePanel(true);
      return;
    }

    // 场景3：重新上传 / 首次单文件 → 无需弹窗（回到 select_mode 由用户重新选择）
    // 仅初始化 fileRoles，等待用户在步骤1选择识别方式
    if (!workMode && fileRoles.length === 0 && uploadedFiles.length > 0) {
      setFileRoles(uploadedFiles.map(f => ({ fileName: f.name, role: 'unassigned' as const })));
      return;
    }
  }, [uploadedFiles?.length, workMode]);

  /** 选择工作模式后的处理 */
  const handleModeSelect = (mode: WorkMode) => {
    if (mode === 'cross-file' && (!uploadedFiles || uploadedFiles.length < 2)) {
      return;
    }

    setWorkMode(mode);
    if (mode === 'questions-only' || mode === 'same-file') {
      // 仅题目 / 题目+答案（同文件）：直接进入框选识别阶段
      setFlowStep('frame_and_review');
      setFlowStage('cutting');
    } else {
      // 题目+答案（不同文件）：需要先分配文件角色
      if (uploadedFiles && uploadedFiles.length >= 2) {
        // 多文件：需要先分配角色
        setFileRolePanelFileIds(null);
        setShowFileRolePanel(true);
      } else {
        // 单文件：自动标记为题目文件
        if (uploadedFiles && uploadedFiles.length === 1) {
          setFileRoles(uploadedFiles.map(f => ({ fileName: f.name, role: 'question' as const })));
        }
        setFlowStep('frame_and_review');
        setFlowStage('cutting');
      }
    }
  };

  /** 文件角色分配确认 */
  const handleFileRoleConfirm = () => {
    setShowFileRolePanel(false);
    setFileRolePanelFileIds(null);
    setFlowStep('frame_and_review');
    setFlowStage('cutting');
  };

  /** 流程步骤切换 */
  const goToStep = (step: FlowStep) => {
    setFlowStep(step);
    switch (step) {
      case 'upload_files':
        setFlowStage('cutting');
        setManualAnswerLinking(false);
        setManualLinkTarget(null);
        break;
      case 'select_mode':
        setFlowStage('cutting');
        setWorkMode(null);
        setShowFileRolePanel(false);
        setFileRolePanelFileIds(null);
        setManualAnswerLinking(false);
        setManualLinkTarget(null);
        break;
      case 'frame_and_review':
        setFlowStage('cutting');
        setManualAnswerLinking(false);
        setManualLinkTarget(null);
        // 回退到识别阶段时，重置所有处理状态，确保按钮和操作可用
        setIsProcessing(false);
        setBatchProcessing(false);
        setProcessingMessage('');
        // 回退时取消所有框的选中状态，保留已框选区域
        setQuestionBoxes(prev => prev.map(b => ({ ...b, isSelected: false })));
        break;
      case 'review':
        setFlowStage('matched');
        setManualAnswerLinking(false);
        setManualLinkTarget(null);
        break;
      case 'manual_link':
        setFlowStep('review');
        setFlowStage('matched');
        setManualAnswerLinking(true);
        setManualLinkTarget(null);
        // 进入核对阶段时，如果有未匹配答案的题目，定位到第一个
        setTimeout(() => {
          const failedIds = Array.from(answerMatchFailedForQuestionIds);
          if (failedIds.length > 0) {
            const firstEl = document.querySelector(`[data-question-id="${failedIds[0]}"]`) as HTMLElement | null;
            firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            const firstIncomplete = questions.find(q => getQuestionMatchInfo(q).incompleteItemCount > 0);
            if (firstIncomplete) {
              const firstEl = document.querySelector(`[data-question-id="${firstIncomplete.id}"]`) as HTMLElement | null;
              firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }, 200);
        break;
    }
  };

  /** 从步骤3返回步骤2（重新调整框选） */
  const handleBackToQuestions = () => {
    goToStep('frame_and_review');
  };

  /** 确认返回模式选择 */
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearRecognitionConfirm, setShowClearRecognitionConfirm] = useState<'modify_files' | 'modify_mode' | null>(null);
  const [showAddToPaperConfirm, setShowAddToPaperConfirm] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false); // 步骤3右侧更多工具菜单展开/收起
  const [editingRangeIndex, setEditingRangeIndex] = useState<number | null>(null); // 正在调整页码范围的文件索引
  const [editRangeStart, setEditRangeStart] = useState(1);
  const [editRangeEnd, setEditRangeEnd] = useState(1);

  // 从 pageImages 计算每个文件的总页数
  const computedFileTotalPages = useMemo(() => {
    if (!pageImages || pageImages.length === 0) return undefined;
    const counts: number[] = [];
    pageImages.forEach(p => {
      const idx = p.sourceFileIndex ?? 0;
      counts[idx] = (counts[idx] || 0) + 1;
    });
    return counts.length > 0 ? counts : undefined;
  }, [pageImages]);
  const effectiveTotalPages = fileTotalPages || computedFileTotalPages;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  /** 返回到录题方式选择（先弹窗确认） */
  const handleResetToSelectMode = () => {
    setShowResetConfirm(true);
  };

  /** 确认重置：清空所有数据返回模式选择 */
  const handleConfirmReset = () => {
    setWorkMode(null);
    setFlowStep('select_mode');
    setFlowStage('cutting');
    setQuestions([]);
    setAnswers([]);
    setQuestionBoxes([]);
    setReviewHiddenBoxIds(new Set());
    setFileRoles([]);
    setManualAnswerLinking(false);
    setManualLinkTarget(null);
    setShowResetConfirm(false);
  };


  // 初始化：处理上传的文件（支持多文件，支持追加模式）
  useEffect(() => {
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const prevCount = processedFilesCountRef.current;
    const isAppend = prevCount > 0 && prevCount < uploadedFiles.length;

    // 确定要处理的文件范围
    const startIdx = isAppend ? prevCount : 0;
    const filesToProcess = uploadedFiles.slice(startIdx);

    if (filesToProcess.length === 0) return;

    const initFiles = async () => {
      if (!isAppend) {
        setIsPagesLoading(true);
      }

      try {
        // 存储每个文件处理后的页面，保留文件索引信息
        const filePages: { pages: PageImage[]; fileIndex: number }[] = [];
        let primaryFileType: 'pdf' | 'image' | 'unknown' = 'unknown';

        // 逐个处理新增的文件
        for (let i = 0; i < filesToProcess.length; i++) {
          const file = filesToProcess[i];
          const fileName = file.name.toLowerCase();
          const mimeType = file.type.toLowerCase();
          const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif'];

          const isPdf = mimeType.includes('pdf') || fileName.endsWith('.pdf');
          const isImage = mimeType.startsWith('image/') || imageExtensions.some(ext => fileName.endsWith(ext));

          // 判断主文件类型（第一个文件的类型）
          if (i === 0 && !isAppend) {
            if (isPdf) primaryFileType = 'pdf';
            else if (isImage) primaryFileType = 'image';
            else primaryFileType = 'unknown';
          }

          console.log(`开始处理文件 ${startIdx + i + 1}/${uploadedFiles.length}:`, file.name, '类型:', mimeType);

          try {
            // 获取该文件的页码范围配置
            const fileRange = fileRanges?.[startIdx + i];
            const startPage = fileRange?.rangeStart ?? 1;
            const rangeEnd = fileRange?.rangeEnd;
            // maxPages 根据用户选择的范围计算
            const effectiveMaxPages = rangeEnd ? (rangeEnd - startPage + 1) : 24;

            const result = await processUploadedFile(file, {
              scale: 1.5,
              maxWidth: 1200,
              maxPages: effectiveMaxPages,
              startPage,
            });

            console.log(`文件 ${file.name} 处理完成:`, result.pages.length, '页');

            filePages.push({ pages: result.pages, fileIndex: startIdx + i });

            if (result.isTruncated) {
              console.warn(`文件 ${file.name} 超过 24 页，仅处理前 ${result.processedPages} 页`);
            }
          } catch (fileError) {
            console.error(`文件 ${file.name} 处理失败:`, fileError);
            // 单个文件失败不影响其他文件
          }
        }

        // 更新已处理文件计数
        processedFilesCountRef.current = uploadedFiles.length;

        if (isAppend) {
          // 追加模式：获取当前已有页数，新页面重新编号后追加
          setHasAutoDetected(false);  // 重置切题标记，新增文件后需再次触发切题
          setPageImages(prev => {
            const existingCount = prev.length;
            let runningPageNum = existingCount;
            const allNewPages: PageImage[] = [];
            for (const fp of filePages) {
              const pagesWithSource = fp.pages.map((page, pageIdx) => ({
                ...page,
                pageNumber: ++runningPageNum,
                sourceFileIndex: fp.fileIndex,
                sourcePageNumber: page.pageNumber, // 保留 PDF 中的实际页码
              }));
              allNewPages.push(...pagesWithSource);
            }
            return [...prev, ...allNewPages];
          });
          // 计算新增总页数
          const newPageCount = filePages.reduce((sum, fp) => sum + fp.pages.length, 0);
          setTotalPages(prev => prev + newPageCount);
          console.log('追加文件完成，新增:', newPageCount, '页');
        } else {
          // 首次上传：设置文件类型
          setFileType(primaryFileType);

          // 为所有页面标记来源文件和编号
          let runningPageNum = 0;
          const allPagesWithSource: PageImage[] = [];
          for (const fp of filePages) {
            const pagesWithSource = fp.pages.map((page, pageIdx) => ({
              ...page,
              pageNumber: ++runningPageNum,
              sourceFileIndex: fp.fileIndex,
              sourcePageNumber: page.pageNumber, // 保留 PDF 中的实际页码
            }));
            allPagesWithSource.push(...pagesWithSource);
          }

          console.log('文件处理完成，共:', allPagesWithSource.length, '页');
          setPageImages(allPagesWithSource);
          setTotalPages(allPagesWithSource.length);

          if (allPagesWithSource.length === 0) {
            console.error('所有文件处理结果为空');
          }
        }
      } catch (error) {
        console.error('文件处理失败:', error);
        if (!isAppend) {
          setPageImages([]);
        }
      } finally {
        setIsPagesLoading(false);
      }
    };

    initFiles();

    return () => {
      // cleanup if needed
    };
  }, [uploadedFiles]);

  const isReviewStep = flowStep === 'review' || flowStep === 'manual_link';
  const isSelectionStep = flowStep === 'frame_and_review';
  const visibleQuestionBoxes = questionBoxes;
  const isBoxRecognizing = (boxId: string) =>
    reviewHiddenBoxIds.has(boxId) && (isProcessing || batchProcessing || flowStage === 'recognizing');
  const getBoxStatusLabel = (box: QuestionBox) => {
    if (isBoxRecognizing(box.id)) return '识别中';
    return box.recognized ? '已识别' : '待识别';
  };
  const getBoxStatusClassName = (box: QuestionBox) => {
    if (isBoxRecognizing(box.id)) return 'bg-blue-500 text-white';
    return box.recognized ? 'bg-emerald-500 text-white' : 'bg-yellow-400 text-yellow-900';
  };
  const getBoxBorderClassName = (box: QuestionBox) => {
    if (isBoxRecognizing(box.id)) return 'border-blue-400';
    if (box.recognized) return box.isSelected ? 'border-emerald-600' : 'border-emerald-400';
    return box.isSelected ? 'border-emerald-500' : 'border-gray-400';
  };
  const getBoxBackgroundColor = (box: QuestionBox) => {
    if (isBoxRecognizing(box.id)) return 'rgba(59, 130, 246, 0.12)';
    if (box.isSelected) return 'rgba(16, 185, 129, 0.1)';
    if (box.recognized) return 'rgba(16, 185, 129, 0.08)';
    return box.type === 'answer' ? 'rgba(249, 115, 22, 0.06)' : 'rgba(16, 185, 129, 0.06)';
  };
  const getBoxQuestionNumberLabel = (box: QuestionBox) => {
    const explicitNumber = typeof box.questionNumber === 'number' && Number.isFinite(box.questionNumber) && box.questionNumber > 0
      ? Math.floor(box.questionNumber)
      : null;
    return explicitNumber ? `第${explicitNumber}题` : '未识别到题号';
  };
  const getBoxNumberLabelClassName = (box: QuestionBox) => {
    const hasExplicitNumber = typeof box.questionNumber === 'number' && Number.isFinite(box.questionNumber) && box.questionNumber > 0;
    if (!hasExplicitNumber) return 'border-amber-200 bg-amber-50/95 text-amber-700';
    if (isBoxRecognizing(box.id)) return 'border-blue-200 bg-blue-50/95 text-blue-700';
    if (box.recognized) return 'border-emerald-200 bg-white/95 text-emerald-700';
    return 'border-slate-200 bg-white/95 text-slate-700';
  };

  // 当前选择统计：第四步保留已识别框，识别中框不参与选择
  const selectedCount = visibleQuestionBoxes.filter(b => b.isSelected).length;
  const totalBoxCount = visibleQuestionBoxes.length;
  const canOperateBoxes = totalBoxCount > 0 && !isAutoDetecting && !isProcessing && !batchProcessing;
  const showBoxStepFloatingActions = (isReviewStep || (isSelectionStep && hasAutoDetected)) && !isAutoDetecting;
  const hideBoxesInReview = (boxIds: string[]) => {
    if (boxIds.length === 0) return;
    setReviewHiddenBoxIds(prev => {
      const next = new Set(prev);
      boxIds.forEach(id => next.add(id));
      return next;
    });
  };
  const restoreActiveRecognitionBoxes = () => {
    const boxIds = activeRecognitionBoxIdsRef.current;
    if (boxIds.length === 0) return;
    setReviewHiddenBoxIds(prev => {
      const next = new Set(prev);
      boxIds.forEach(id => next.delete(id));
      return next;
    });
    activeRecognitionBoxIdsRef.current = [];
  };
  const clearActiveRecognitionBoxes = () => {
    const boxIds = activeRecognitionBoxIdsRef.current;
    if (boxIds.length > 0) {
      setReviewHiddenBoxIds(prev => {
        const next = new Set(prev);
        boxIds.forEach(id => next.delete(id));
        return next;
      });
    }
    activeRecognitionBoxIdsRef.current = [];
  };
  const scrollToAnswerFilePage = () => {
    if (workMode !== 'cross-file') return;
    const answerPageIndex = pageImages.findIndex((page) => {
      const sourceFileIndex = page.sourceFileIndex;
      return sourceFileIndex !== undefined && fileRoles[sourceFileIndex]?.role === 'answer';
    });
    if (answerPageIndex < 0) return;
    const pageNum = answerPageIndex + 1;
    setTimeout(() => {
      const answerPageEl = containerRef.current?.querySelector(`[data-page="${pageNum}"]`) as HTMLElement | null;
      answerPageEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };
  const enterManualAnswerLinking = (target?: ManualLinkTarget | null) => {
    if (target !== undefined) {
      setManualLinkTarget(target);
    }
    setManualAnswerLinking(target !== null);
    if (target !== null) scrollToAnswerFilePage();
  };
  const handleDirectedManualLinkEntryClick = (questionId: number, field: ManualLinkField) => {
    const target = { questionId, field };
    setManualLinkTarget(target);
    if (manualAnswerLinking) {
      enterManualAnswerLinking(target);
      return;
    }
    enterManualAnswerLinking(target);
  };
  const reviewStats = useMemo(() => {
    const infos = questions.map(getQuestionMatchInfo);
    return {
      parentCount: questions.length,
      matchedAnswerCount: infos.filter(info => info.hasAnswer).length,
      pendingAnswerCount: infos.filter(info => !info.hasAnswer).length,
      pendingSubCount: infos.reduce((sum, info) => sum + info.pendingSubCount, 0),
      incompleteItemCount: infos.reduce((sum, info) => sum + info.incompleteItemCount, 0),
      firstIncompleteQuestionId: questions.find((question) => getQuestionMatchInfo(question).incompleteItemCount > 0)?.id ?? null,
    };
  }, [questions]);

  // 模式三（跨文件）：题目文件页在前，答案文件页在后
  const pageOrder = useMemo(() => {
    const order = pageImages.map((_, i) => i);
    if (workMode !== 'cross-file') return order;
    const rolePriority: Record<string, number> = { question: 0, answer: 1, unassigned: 2 };
    return [...order].sort((ai, bi) => {
      const roleA = fileRoles[pageImages[ai].sourceFileIndex ?? -1]?.role ?? 'unassigned';
      const roleB = fileRoles[pageImages[bi].sourceFileIndex ?? -1]?.role ?? 'unassigned';
      return (rolePriority[roleA] ?? 2) - (rolePriority[roleB] ?? 2);
    });
  }, [workMode, pageImages, fileRoles]);

  // 获取某页的文件角色标签（仅模式三）
  const getPageFileRole = (pageImage: PageImage): string | null => {
    if (workMode !== 'cross-file' || pageImage.sourceFileIndex === undefined) return null;
    const role = fileRoles[pageImage.sourceFileIndex]?.role;
    return role === 'question' ? '题目' : role === 'answer' ? '答案' : null;
  };

  const getPageRoleValue = (pageNumber: number): FileRoleInfo['role'] | null => {
    if (workMode !== 'cross-file') return null;
    const page = pageImages[pageNumber - 1];
    if (!page || page.sourceFileIndex === undefined) return null;
    return fileRoles[page.sourceFileIndex]?.role ?? null;
  };

  const isAnswerFilePage = (pageNumber: number) => getPageRoleValue(pageNumber) === 'answer';

  const canDrawOnPage = (pageNumber: number) => {
    if (!canDrawBoxes) return false;
    if (!isReviewStep || workMode !== 'cross-file') return true;

    const pageRole = getPageRoleValue(pageNumber);

    if (manualAnswerLinking) {
      return pageRole !== 'question';
    }

    return pageRole !== 'answer';
  };

  const showDrawBlockedToast = (pageNumber: number) => {
    if (!isReviewStep || workMode !== 'cross-file') return;

    const pageRole = getPageRoleValue(pageNumber);
    if (!manualAnswerLinking && pageRole === 'answer') {
      setToastMessage('当前为题干重识别状态，请在题目文件中框选题干内容');
    } else if (manualAnswerLinking && pageRole === 'question') {
      setToastMessage('当前为答案/解析关联状态，请在答案文件中框选内容');
    } else {
      return;
    }

    setTimeout(() => setToastMessage(''), 3000);
  };

  const unlinkedAnswerCount = answers.filter(a => a.status === 'unlinked').length;
  
  // 未识别的框数量
  const unrecognizedCount = questionBoxes.filter(b => !b.recognized).length;

  // 鼠标事件处理
  const handleMouseDown = useCallback((e: React.MouseEvent, pageNum: number) => {
    // 允许在可画框阶段画框
    if (!canDrawBoxes) return;
    if (!canDrawOnPage(pageNum)) {
      showDrawBlockedToast(pageNum);
      return;
    }
    if ((e.target as HTMLElement).closest('.question-box')) return;
    if ((e.target as HTMLElement).closest('.recognized-box')) return;
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    if ((e.target as HTMLElement).closest('.answer-marker')) return;
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsDrawing(true);
    setDrawStart({ x, y, pageNumber: pageNum });
    setCurrentBox({ x, y, width: 0, height: 0, pageNumber: pageNum });
    setSelectedBoxId(null);
  }, [canDrawBoxes, canDrawOnPage, showDrawBlockedToast]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 找到当前鼠标所在的页面容器
    const pageContainer = (e.target as HTMLElement).closest('[data-page]');

    // 如果鼠标不在任何页面上，且正在画框或移动框，使用上一个已知的页面信息
    if (!pageContainer && !isDrawing && !moving) return;

    let rect, x, y, pageNum;

    if (pageContainer) {
      rect = (pageContainer as HTMLElement).getBoundingClientRect();
      if (!rect) return;
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
      pageNum = parseInt((pageContainer as HTMLElement).dataset.page || '1');
    } else {
      // 鼠标在页面间隙，使用当前框的页面信息
      if (currentBox) {
        pageNum = currentBox.pageNumber || 1;
        // 计算相对于上一个页面的位置（基于页面容器的位置）
        const currentContainer = containerRef.current?.querySelector(`[data-page="${pageNum}"]`) as HTMLElement;
        if (currentContainer) {
          rect = currentContainer.getBoundingClientRect();
          x = e.clientX - rect.left;
          y = e.clientY - rect.top;
        } else {
          return;
        }
      } else if (moving) {
        const boxToMove = questionBoxes.find(b => b.id === moving.boxId);
        if (!boxToMove) return;
        pageNum = boxToMove.pageNumber;
        const currentContainer = containerRef.current?.querySelector(`[data-page="${pageNum}"]`) as HTMLElement;
        if (currentContainer) {
          rect = currentContainer.getBoundingClientRect();
          x = e.clientX - rect.left;
          y = e.clientY - rect.top;
        } else {
          return;
        }
      } else {
        return;
      }
    }

    // 画框模式 - 支持跨页画框
    if (isDrawing && drawStart && currentBox) {
      const startPageNum = drawStart.pageNumber || currentBox.pageNumber || 1;

      if (pageNum === startPageNum) {
        // 同页内正常画框
        const width = x - drawStart.x;
        const height = y - drawStart.y;
        setCurrentBox(prev => ({
          x: prev?.x || (width > 0 ? drawStart.x : x),
          y: prev?.y || (height > 0 ? drawStart.y : y),
          width: Math.abs(width),
          height: Math.abs(height),
          pageNumber: pageNum,
        }));
      } else if (pageNum === startPageNum + 1) {
        // 跨页画框：鼠标从起始页拖到了下一页
        // 获取起始页容器的高度
        const startPageContainer = containerRef.current?.querySelector(`[data-page="${startPageNum}"]`) as HTMLElement;
        if (startPageContainer) {
          const startPageRect = startPageContainer.getBoundingClientRect();
          const startPageDisplayHeight = startPageRect.height;
          // 起始页部分：从drawStart到页面底部
          const firstPageHeight = startPageDisplayHeight - drawStart.y;
          // 下一页部分：从顶部到鼠标位置
          const secondPageHeight = y;
          const boxWidth = Math.abs(x - drawStart.x) || currentBox.width || 200;

          setCurrentBox({
            x: drawStart.x,
            y: drawStart.y,
            width: boxWidth,
            height: firstPageHeight,
            pageNumber: startPageNum,
            endPageNumber: pageNum,
            endPageY: 0,
            endPageHeight: secondPageHeight,
          });
        }
      } else {
        // 鼠标在间隙或其他页面，保持当前框状态
      }
    } else if (resizing) {
      // 调整框大小模式 - 不支持跨页
      setQuestionBoxes(prev => prev.map(box => {
        if (box.id !== resizing.boxId) return box;

        let newX = box.x;
        let newY = box.y;
        let newWidth = box.width;
        let newHeight = box.height;

        if (resizing.direction.includes('e')) newWidth = Math.max(50, x - box.x);
        if (resizing.direction.includes('w')) {
          newWidth = Math.max(50, box.x + box.width - x);
          newX = x;
        }
        if (resizing.direction.includes('s')) newHeight = Math.max(30, y - box.y);
        if (resizing.direction.includes('n')) {
          newHeight = Math.max(30, box.y + box.height - y);
          newY = y;
        }

        return { ...box, x: newX, y: newY, width: newWidth, height: newHeight };
      }));
    } else if (moving) {
      // 移动框模式 - 支持跨页移动
      const boxToMove = questionBoxes.find(b => b.id === moving.boxId);
      if (!boxToMove) return;

      const prevPageNum = boxToMove.pageNumber;

      // 检测是否跨页
      if (pageNum !== prevPageNum) {
        // 跨页移动：将框移动到新页面
        // 限制框在新页面内的位置
        let newX = Math.max(0, x - (boxToMove.width / 2));
        let newY = Math.max(0, y - (boxToMove.height / 2));

        setQuestionBoxes(prev => prev.map(box => {
          if (box.id !== moving.boxId) return box;
          return { ...box, x: newX, y: newY, pageNumber: pageNum };
        }));

        // 更新移动起始点为新页面的位置
        setMoving(prev => prev ? { ...prev, startX: x, startY: y } : null);
      } else {
        // 同页内移动
        const dx = x - moving.startX;
        const dy = y - moving.startY;

        setQuestionBoxes(prev => prev.map(box => {
          if (box.id !== moving.boxId) return box;

          // 限制框在页面内
          let newX = box.x + dx;
          let newY = box.y + dy;
          newX = Math.max(0, Math.min(newX, displayWidth - box.width));
          newY = Math.max(0, newY); // 不限制Y轴下限，因为页面高度可能不同

          return { ...box, x: newX, y: newY };
        }));

        setMoving(prev => prev ? { ...prev, startX: x, startY: y } : null);
      }
    }
  }, [isDrawing, drawStart, currentBox, resizing, moving, questionBoxes, displayWidth, containerRef]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing && currentBox && currentBox.width && currentBox.height) {
      if (currentBox.width > 30 && currentBox.height > 20) {
        const newBoxId = `box-${Date.now()}`;
        const newBox: QuestionBox = {
          id: newBoxId,
          x: currentBox.x!,
          y: currentBox.y!,
          width: currentBox.width,
          height: currentBox.height,
          isSelected: true,
          pageNumber: currentBox.pageNumber || 1,
          recognized: false,
          type: 'question', // 默认类型，用户在弹窗中确认或修改
        };
        // 如果是跨页框，附加第二页信息
        if (currentBox.endPageNumber && currentBox.endPageHeight && currentBox.endPageHeight > 5) {
          newBox.endPageNumber = currentBox.endPageNumber;
          newBox.endPageY = currentBox.endPageY || 0;
          newBox.endPageHeight = currentBox.endPageHeight;
        }
        setQuestionBoxes(prev => [...prev, newBox]);
        // 分步/跨文件模式：按步骤自动设定框类型，跳过类型选择弹窗
        if (workMode === 'same-file' || workMode === 'cross-file') {
          if (manualAnswerLinking || flowStep === 'manual_link') {
            // 第四步手动关联答案：定向入口直接回填；普通入口弹出关联题号选择器
            const targetQuestion = manualLinkTarget
              ? questionsRef.current.find(q => q.id === manualLinkTarget.questionId)
              : null;
            const linkedAnswerBox: QuestionBox = {
              ...newBox,
              type: 'answer',
              linkedQuestionId: targetQuestion?.id,
              questionNumber: targetQuestion?.number,
            };
            setQuestionBoxes(prev => prev.map(b =>
              b.id === newBoxId ? linkedAnswerBox : b
            ));
            if (manualLinkTarget && targetQuestion) {
              setPendingAnswerTargetId(null);
              setPendingLinkBoxId(null);
              setShowAnswerLinkPicker(false);
              setIsProcessing(true);
              void processAnswerBoxes([linkedAnswerBox], manualLinkTarget);
            } else {
              setPendingAnswerTargetId(null);
              setPendingLinkBoxId(newBoxId);
              setShowAnswerLinkPicker(true);
            }
          }
          // 步骤2：默认题干框，无需弹窗（type 已设为 question）
        }
      }
    }

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentBox(null);
    
    // 移动/调整大小结束后，仅当位置/尺寸确实发生变化时才重置识别状态并弹出类型选择弹窗
    // 单击框（无位移）不应触发弹窗
    if (resizing || moving) {
      const boxId = resizing?.boxId || moving?.boxId;
      if (boxId) {
        const currentBox = questionBoxes.find(b => b.id === boxId);
        // 判断是否发生了实际位移或尺寸变化（阈值 2px 避免浮点误差）
        const actuallyMoved = moving && currentBox && (
          Math.abs(currentBox.x - moving.initialX) > 2 ||
          Math.abs(currentBox.y - moving.initialY) > 2
        );
        const actuallyResized = resizing && currentBox && (
          Math.abs(currentBox.width - resizing.initialW) > 2 ||
          Math.abs(currentBox.height - resizing.initialH) > 2
        );
        if ((moving && actuallyMoved) || (resizing && actuallyResized)) {
          setQuestionBoxes(prev => prev.map(b => {
            if (b.id === boxId && b.recognized) {
              return { ...b, recognized: false, questionNumber: undefined, isSelected: true };
            }
            return b;
          }));
          // 分步模式：按步骤自动设定框类型，跳过类型选择弹窗
	          if (workMode === 'same-file' || workMode === 'cross-file') {
            if (manualAnswerLinking || flowStep === 'manual_link') {
              // 第四步手动关联答案：定向入口直接回填；普通入口弹出关联题号选择器
              const targetQuestion = manualLinkTarget
                ? questionsRef.current.find(q => q.id === manualLinkTarget.questionId)
                : null;
              const linkedAnswerBox: QuestionBox | null = currentBox
                ? {
                    ...currentBox,
                    type: 'answer',
                    recognized: false,
                    linkedQuestionId: targetQuestion?.id ?? currentBox.linkedQuestionId,
                    questionNumber: targetQuestion?.number ?? currentBox.questionNumber,
                  }
                : null;
              setQuestionBoxes(prev => prev.map(b =>
                b.id === boxId
                  ? { ...b, type: 'answer', recognized: false, linkedQuestionId: targetQuestion?.id ?? b.linkedQuestionId, questionNumber: targetQuestion?.number ?? b.questionNumber }
                  : b
              ));
              if (manualLinkTarget && targetQuestion && linkedAnswerBox) {
                setPendingAnswerTargetId(null);
                setPendingLinkBoxId(null);
                setShowAnswerLinkPicker(false);
                setIsProcessing(true);
                void processAnswerBoxes([linkedAnswerBox], manualLinkTarget);
              } else {
                setPendingAnswerTargetId(currentBox?.linkedQuestionId ?? null);
                setPendingLinkBoxId(boxId);
                setShowAnswerLinkPicker(true);
              }
            }
            // 第一步：默认题干框（type 保持 question 即可）
	          }
	      }
    }
	  }
    
    setResizing(null);
    setMoving(null);
  }, [isDrawing, currentBox, resizing, moving, workMode, flowStep, manualAnswerLinking, manualLinkTarget, questionBoxes, selectedBoxId]);

  // 删除框
  const handleDeleteBox = (boxId: string) => {
    if (isBoxRecognizing(boxId)) return;
    setQuestionBoxes(prev => prev.filter(b => b.id !== boxId));
    setReviewHiddenBoxIds(prev => {
      const next = new Set(prev);
      next.delete(boxId);
      return next;
    });
    if (selectedBoxId === boxId) setSelectedBoxId(null);
  };

  // 清空当前可操作的切题框
  const handleClearAllBoxes = () => {
    setQuestionBoxes(prev => isReviewStep ? prev.filter(b => b.recognized) : []);
    if (!isReviewStep) {
      setReviewHiddenBoxIds(new Set());
    }
    setSelectedBoxId(null);
    setShowClearConfirm(false);
    if (!isReviewStep) {
      autoDetectedPageCountRef.current = 0; // 重置切题计数
    }
  };

  // 切换框选中状态
  const handleToggleBox = (boxId: string) => {
    if (isBoxRecognizing(boxId)) return;
    setQuestionBoxes(prev => prev.map(b =>
      b.id === boxId ? { ...b, isSelected: !b.isSelected } : b
    ));
  };

  // 开始调整大小
  const handleResizeStart = (e: React.MouseEvent, boxId: string, direction: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (isBoxRecognizing(boxId)) return;
    const box = questionBoxes.find(b => b.id === boxId);
    setResizing({ boxId, direction, initialW: box?.width ?? 0, initialH: box?.height ?? 0 });
  };

  // 开始移动
  const handleMoveStart = (e: React.MouseEvent, boxId: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (isBoxRecognizing(boxId)) return;

    // 找到当前鼠标所在的页面容器
    const pageContainer = (e.target as HTMLElement).closest('[data-page]');
    if (!pageContainer) return;

    const rect = (pageContainer as HTMLElement).getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 记录初始位置，用于区分「单击」和「实际移动」
    const box = questionBoxes.find(b => b.id === boxId);
    setMoving({ boxId, startX: x, startY: y, initialX: box?.x ?? 0, initialY: box?.y ?? 0, initialW: box?.width ?? 0, initialH: box?.height ?? 0 });
    setSelectedBoxId(boxId);
  };

  const extractManualLinkFieldText = (
    result: { answer?: string; analysis?: string; content?: string } | undefined,
    field: ManualLinkField
  ) => {
    if (!result) return '';
    const candidates = field === 'answer'
      ? [result.answer, result.content, result.analysis]
      : [result.analysis, result.content, result.answer];
    return candidates.find((value) => value?.trim())?.trim() || '';
  };

  const applyManualLinkTargetToQuestion = (question: Question, field: ManualLinkField, text: string): Question => {
    const normalizedText = text.trim();
    if (!normalizedText) return question;

    if (field === 'answer') {
      if (isFillBlankType(question.questionType) && question.blankCount > 1) {
        const splitAnswers = splitAnswerByBlanks(normalizedText, question.blankCount);
        const blankAnswers = splitAnswers || Array.from({ length: question.blankCount }, (_, index) =>
          index === 0 ? normalizedText : (question.blankAnswers[index] || '')
        );
        return {
          ...question,
          blankAnswers,
          answer: splitAnswers ? '' : question.answer,
          status: 'matched',
          answerSource: 'manual',
        };
      }
      return { ...question, answer: normalizedText, status: 'matched', answerSource: 'manual' };
    }

    return {
      ...question,
      analysis: normalizedText,
      status: hasUsableAnswer(question) ? 'matched' : 'pending_confirm',
    };
  };

  // 处理答案框：裁剪后调用答案提取 API，匹配到已有题目
  const processAnswerBoxes = async (boxes: QuestionBox[], directTarget?: ManualLinkTarget | null) => {
    setProcessingMessage(`正在裁剪 ${boxes.length} 个答案区域...`);

    // 标记正在处理答案的题目
    const processingIds = new Set<number | string>();
    boxes.forEach(b => {
      if (b.linkedQuestionId) processingIds.add(b.linkedQuestionId);
    });
    if (directTarget) processingIds.add(directTarget.questionId);
    setAnswerProcessingForQuestionIds(processingIds);
    setAnswerMatchFailedForQuestionIds(new Set());

    // 自动滚动到第一个被处理的题目
    const firstProcessingId = Array.from(processingIds)[0];
    if (firstProcessingId !== undefined) {
      setTimeout(() => {
        const el = document.getElementById(`question-card-${firstProcessingId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }

    const croppedImagesMap = new Map<string, string>();
    const croppedImages: PageImage[] = [];
    const orderedBoxes: QuestionBox[] = [];

    try {
      for (const page of pageImages) {
        // 分离跨页框和非跨页框
        const pageBoxes = boxes.filter(b => b.pageNumber === page.pageNumber && !b.endPageNumber);
        const crossPageBoxes = boxes.filter(b => b.pageNumber === page.pageNumber && b.endPageNumber);
        if (pageBoxes.length === 0 && crossPageBoxes.length === 0) continue;

        const displayActualWidth = displayWidth * (zoom / 100);
        const scale = page.width / displayActualWidth;

        // 处理非跨页框
        if (pageBoxes.length > 0) {
          const scaledBoxes = pageBoxes.map(b => ({
            id: b.id,
            x: Math.round(b.x * scale),
            y: Math.round(b.y * scale),
            width: Math.round(b.width * scale),
            height: Math.round(b.height * scale),
          }));

          const cropped = await batchCropImages(page.imageData, scaledBoxes, page.width, page.height);

          cropped.forEach((value, key) => {
            croppedImagesMap.set(key, value);
            const originalBox = pageBoxes.find(b => b.id === key);
            croppedImages.push({
              pageNumber: page.pageNumber,
              imageData: value,
              width: originalBox?.width || 400,
              height: originalBox?.height || 200,
            });
            if (originalBox) orderedBoxes.push(originalBox);
          });
        }

        // 处理跨页框：从起始页裁剪第一部分，从结束页裁剪第二部分，然后垂直拼接
        for (const box of crossPageBoxes) {
          // 第一部分：从框的 y 到页面底部
          const firstPartHeight = displayWidth * (page.height / page.width) - box.y;
          const firstPartScaled = {
            id: box.id + '_part1',
            x: Math.round(box.x * scale),
            y: Math.round(box.y * scale),
            width: Math.round(box.width * scale),
            height: Math.round(firstPartHeight * scale),
          };

          const firstPartCropped = await batchCropImages(
            page.imageData,
            [firstPartScaled],
            page.width,
            page.height
          );

          const firstPartData = firstPartCropped.get(box.id + '_part1');
          if (!firstPartData) {
            console.error('跨页框第一部分裁剪失败:', box.id);
            continue;
          }

          // 第二部分：从结束页顶部到 endPageY + endPageHeight
          const endPage = pageImages.find(p => p.pageNumber === box.endPageNumber);
          if (!endPage) {
            console.error('找不到跨页框的结束页:', box.endPageNumber);
            continue;
          }

          const endPageScale = endPage.width / displayActualWidth;
          const secondPartScaled = {
            id: box.id + '_part2',
            x: Math.round(box.x * endPageScale),
            y: Math.round((box.endPageY || 0) * endPageScale),
            width: Math.round(box.width * endPageScale),
            height: Math.round((box.endPageHeight || 0) * endPageScale),
          };

          const secondPartCropped = await batchCropImages(
            endPage.imageData,
            [secondPartScaled],
            endPage.width,
            endPage.height
          );

          const secondPartData = secondPartCropped.get(box.id + '_part2');
          if (!secondPartData) {
            console.error('跨页框第二部分裁剪失败:', box.id);
            continue;
          }

          // 拼接两部分
          try {
            const stitchedImage = await stitchImagesVertically(firstPartData, secondPartData);
            croppedImagesMap.set(box.id, stitchedImage);
            croppedImages.push({
              pageNumber: page.pageNumber,
              imageData: stitchedImage,
              width: box.width,
              height: firstPartHeight + (box.endPageHeight || 0),
            });
            orderedBoxes.push(box);
          } catch (e) {
            console.error('跨页框拼接失败:', box.id, e);
          }
        }
      }

      if (croppedImages.length === 0) throw new Error('裁剪图片失败');

      // 调用 AI 答案提取
      setProcessingMessage(`AI 正在提取 ${croppedImages.length} 个区域的答案...`);

      const response = await fetch('/api/recognize-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: croppedImages,
          userBoxes: orderedBoxes,
          croppedMode: true,
          options: {
            extractAnswerFromAnalysis: true,
            validQuestionTypes: getValidQuestionTypes(subjectInfo || ''),
          },
          subjectInfo,
          answerMode: true,
          // 传递已有题目，让后端能将提取的答案正确关联到对应题目（特别是子题结构）
          existingQuestions: questions.map(q => ({
            id: q.id,
            number: q.number,
            content: q.content || '',
            questionType: q.questionType,
            hasAnswer: hasUsableAnswer(q),
          })),
        }),
      });

      if (!response.ok) throw new Error(`请求失败 (${response.status})`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const chunk = JSON.parse(line.slice(6));
              if (chunk.type === 'progress') {
                if (!customProgressRef.current) {
                  setProcessingMessage(chunk.data.message);
                }
              } else if (chunk.type === 'complete') {
                const result = chunk.data.result;
                const unmatchedAnswers = result.unmatchedAnswers as Array<{
                  id: string;
                  questionNumber: number | null;
                  content: string;
                  answer: string;
                  analysis: string;
                  boxId: string;
                }> | undefined;

                // 标记答案框为已识别（保留用户设定的原始 type 和 questionNumber，取消选中状态）
                setQuestionBoxes(prev => prev.map(box => {
                  const matchedBox = orderedBoxes.find(ob => ob.id === box.id);
                  if (matchedBox) {
                    return {
                      ...box,
                      recognized: true,
                      isSelected: false, // 识别完成后取消选中
                      // 保留用户在类型弹窗中设定的 questionNumber，不被覆盖
                      questionNumber: box.questionNumber || matchedBox.questionNumber,
                    };
                  }
                  return box;
                }));

                // 处理后端预匹配的答案（已有题目 + 答案框 → 直接关联）
                const preMatched = result.preMatchedAnswers as Array<{
                  id: string; questionId: number; questionNumber: number;
                  answer: string; analysis: string; boxId: string;
                }> | undefined;

                // 收集成功匹配的 questionId（用于后续判断匹配失败）
                const matchedIds = new Set<number | string>();

                if (directTarget) {
                  const directBoxId = orderedBoxes[0]?.id;
                  const directResult =
                    preMatched?.find((item) => item.boxId === directBoxId) ||
                    unmatchedAnswers?.find((item) => item.boxId === directBoxId) ||
                    preMatched?.[0] ||
                    unmatchedAnswers?.[0];
                  const directText = extractManualLinkFieldText(directResult, directTarget.field);

                  if (directText) {
                    setQuestions(prev => prev.map(q =>
                      q.id === directTarget.questionId
                        ? applyManualLinkTargetToQuestion(q, directTarget.field, directText)
                        : q
                    ));
                    matchedIds.add(directTarget.questionId);
                    setHighlightedQuestionIds(new Set([directTarget.questionId]));
                    setTimeout(() => setHighlightedQuestionIds(new Set()), 2500);
                  }

                  setProcessingMessage('答案提取完成');
                } else if (preMatched && preMatched.length > 0) {
                  let preMatchedCount = 0;
                  setQuestions(prev => {
                    let updated = [...prev];
                    preMatched.forEach(pa => {
                      // 优先通过 questionId 精确匹配（支持子题）
                      let targetQ = updated.find(q => q.id === pa.questionId);
                      if (!targetQ) {
                        // 兜底：通过题号匹配
                        targetQ = updated.find(q => q.number === pa.questionNumber);
                      }
                      // 同时检查子题
                      if (!targetQ) {
                        for (const q of updated) {
                          if (q.subQuestions) {
                            const subQ = q.subQuestions.find(sq => sq.id === pa.questionId || sq.id === pa.questionNumber);
                            if (subQ) {
                              targetQ = { ...q, _targetSubId: pa.questionId } as any;
                              break;
                            }
                          }
                        }
                      }

                      if (targetQ && pa.answer) {
                        const targetId = (targetQ as any)._targetSubId || targetQ.id;
                        updated = updated.map(q => {
                          if ((targetQ as any)._targetSubId && q.subQuestions) {
                            // 子题答案填充
                            return {
                              ...q,
                              subQuestions: q.subQuestions!.map(sq =>
                                sq.id === targetId
                                  ? { ...sq, answer: pa.answer, analysis: pa.analysis || sq.analysis, status: 'matched' as const }
                                  : sq
                              ),
                            };
                          }
                          return q.id === targetId ? mergeAnswerToQuestion(q, pa.answer, pa.analysis) : q;
                        });
                        matchedIds.add(pa.questionId);
                        preMatchedCount++;
                      }
                    });
                    return updated;
                  });
                  console.log(`[processAnswerBoxes] 预匹配完成: ${preMatchedCount}/${preMatched.length} 道题目`);
                }

                // 匹配答案到已有题目
                // 核心策略：优先使用框类型弹窗时建立的 linkedQuestionId 映射关系自动填充
                // 其次用 AI 返回的 questionNumber 尝试自动匹配（兜底）
                if (!directTarget && unmatchedAnswers && unmatchedAnswers.length > 0) {
                  let matchedCount = 0;
                  setQuestions(prev => {
                    let updated = [...prev];
                    unmatchedAnswers.forEach(ua => {
                      // 策略1: 通过 boxId 找到对应的 QuestionBox，检查是否有预关联的题目
                      const sourceBox = questionBoxes.find(b => b.id === ua.boxId);
                      const paramBox = orderedBoxes.find(b => b.id === ua.boxId);
                      const linkedId = sourceBox?.linkedQuestionId || paramBox?.linkedQuestionId;
                      if (linkedId) {
                        updated = updated.map(q =>
                          q.id === linkedId
                            ? mergeAnswerToQuestion(q, ua.answer, ua.analysis)
                            : q
                        );
                        matchedIds.add(linkedId);
                        matchedCount++;
                        return;
                      }
                      // 策略2: 用 AI 识别到的题号自动匹配（兜底）
                      if (ua.questionNumber != null) {
                        const targetQ = updated.find(q => q.number === ua.questionNumber);
                        if (targetQ && ua.answer) {
                          updated = updated.map(q =>
                            q.id === targetQ.id ? mergeAnswerToQuestion(q, ua.answer, ua.analysis) : q
                          );
                          matchedIds.add(targetQ.id);
                          matchedCount++;
                        }
                      }
                    });
                    return updated;
                  });
                  setProcessingMessage('答案提取完成');
                } else if (!directTarget) {
                  setProcessingMessage('答案提取完成');
                }

                // 计算匹配失败的题目（使用字符串比较避免类型不匹配）
                const failedIds = new Set<number | string>();
                const matchedIdsStr = new Set(Array.from(matchedIds).map(id => String(id)));
                processingIds.forEach(id => {
                  if (!matchedIdsStr.has(String(id))) failedIds.add(id);
                });
                setAnswerMatchFailedForQuestionIds(failedIds);
                setAnswerProcessingForQuestionIds(new Set());

                // 如果有未匹配答案的题目，高亮闪烁并定位到第一个
                if (failedIds.size > 0) {
                  const failedIdArray = Array.from(failedIds).map(id => typeof id === 'string' ? parseInt(id, 10) : id).filter(id => !isNaN(id));
                  if (failedIdArray.length > 0) {
                    setHighlightedQuestionIds(new Set(failedIdArray));
                    setTimeout(() => setHighlightedQuestionIds(new Set()), 5000);
                    setTimeout(() => {
                      const firstEl = document.querySelector(`[data-question-id="${failedIdArray[0]}"]`) as HTMLElement | null;
                      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  }
                }

                setTimeout(() => {
                  setIsProcessing(false);
                  setBatchProcessing(false);
                  setFlowStep('review');
                  setFlowStage('matched');
                  setProcessingMessage('');
                  if (directTarget) {
                    setManualAnswerLinking(false);
                    setManualLinkTarget(null);
                  }
                }, 2000);
                return;
              } else if (chunk.type === 'error') {
                throw new Error(chunk.data.error);
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '答案提取失败';
      console.error('[答案框处理失败]', err);
      setProcessingMessage(`答案提取失败: ${message}`);
      setAnswerProcessingForQuestionIds(new Set());
      setBatchProcessing(false);
      restoreActiveRecognitionBoxes();
      if (directTarget) {
        setManualAnswerLinking(false);
        setManualLinkTarget(null);
      }
      setTimeout(() => {
        setIsProcessing(false);
        setFlowStep('review');
        setFlowStage('matched');
        setProcessingMessage('');
      }, 3000);
    }
  };

  // 批量移入 + AI 识别（按框类型区分：题目框走完整识别，答案框走答案提取）
  const handleBatchMove = async () => {
    // 处理被选中的框（包括未识别和已识别的框）
    // 已识别的框：用户可能调整了范围或想重新识别，先重置为未识别状态再走流程
    let selectedBoxes = questionBoxes.filter(b => b.isSelected && !isBoxRecognizing(b.id));
    if (isReviewStep && workMode === 'cross-file' && !manualAnswerLinking) {
      const answerFileBoxIds = selectedBoxes
        .filter(box => isAnswerFilePage(box.pageNumber))
        .map(box => box.id);

      if (answerFileBoxIds.length > 0) {
        setQuestionBoxes(prev => prev.map(box =>
          answerFileBoxIds.includes(box.id) ? { ...box, isSelected: false } : box
        ));
        selectedBoxes = selectedBoxes.filter(box => !answerFileBoxIds.includes(box.id));
        setToastMessage('已跳过答案文件区域；普通重识别请在题目文件中框选题干内容');
        setTimeout(() => setToastMessage(''), 3000);
      }
    }
    if (selectedBoxes.length === 0) return;
    const selectedBoxIds = selectedBoxes.map(box => box.id);
    activeRecognitionBoxIdsRef.current = selectedBoxIds;
    hideBoxesInReview(selectedBoxIds);
    setQuestionBoxes(prev => prev.map(box =>
      selectedBoxIds.includes(box.id) ? { ...box, isSelected: false } : box
    ));
    if (flowStep === 'frame_and_review') {
      setFlowStep('review');
    }
    setManualAnswerLinking(false);
    setManualLinkTarget(null);

    // 在重置前捕获：哪些题目将被重新识别（用于场景B/C的UI状态）
    const currentQuestions = questionsRef.current;
    const reIds = new Set<number>();
    if (currentQuestions.length > 0) {
      selectedBoxes.forEach(box => {
        if (box.recognized) {
          // 策略1：通过 q.box.id 精确匹配（最可靠）
          let existing = currentQuestions.find(q => q.box && q.box.id === box.id);
          // 策略2：通过 q.boxId 字段匹配
          if (!existing) {
            existing = currentQuestions.find(q => q.boxId === box.id);
          }
          // 策略3：通过题号匹配
          if (!existing && box.questionNumber && box.questionNumber > 0) {
            existing = currentQuestions.find(q => q.number === box.questionNumber);
          }
          if (existing) reIds.add(existing.id);
          return;
        }

        if (isReviewStep && box.type !== 'answer') {
          const likelyExisting = findLikelyReRecognizedQuestion(box, currentQuestions, questionBoxes);
          if (likelyExisting) reIds.add(likelyExisting.id);
        }
      });
    }
    console.log('[重识别检测] 开始');
    console.log('[重识别检测] selectedBoxes.length:', selectedBoxes.length);
    console.log('[重识别检测] 已识别框:', selectedBoxes.filter(b => b.recognized).map(b => ({ id: b.id, recognized: b.recognized, qNumber: b.questionNumber })));
    console.log('[重识别检测] 未识别框:', selectedBoxes.filter(b => !b.recognized).map(b => ({ id: b.id, recognized: b.recognized })));
    console.log('[重识别检测] 已有题目:', currentQuestions.map(q => ({ id: q.id, number: q.number, boxId: q.boxId, boxObjId: q.box?.id })));
    console.log('[重识别检测] reIds结果:', [...reIds]);
    // 将已识别的选中框重置为未识别状态（重新识别）
    const hasRecognizedBoxes = selectedBoxes.some(b => b.recognized);
    if (hasRecognizedBoxes) {
      setQuestionBoxes(prev => prev.map(b =>
        selectedBoxIds.includes(b.id) && b.recognized
          ? { ...b, recognized: false, questionNumber: undefined, isSelected: false }
          : b
      ));
      selectedBoxes.forEach(b => { if (b.recognized) { b.recognized = false; b.questionNumber = undefined; } });
    }

    // 按框类型分离：题目框 vs 答案框
    const questionTypeBoxes = selectedBoxes.filter(b => b.type !== 'answer');
    const answerTypeBoxes = selectedBoxes.filter(b => b.type === 'answer');
    console.log('[重识别检测] questionTypeBoxes:', questionTypeBoxes.length, 'reIds.size:', reIds.size, '→ newBoxCount:', questionTypeBoxes.length - reIds.size);

    if (questionTypeBoxes.length === 0 && answerTypeBoxes.length === 0) {
      restoreActiveRecognitionBoxes();
      return;
    }

    setIsProcessing(true);
    setFlowStage('recognizing');

    const hasQuestions = questionTypeBoxes.length > 0;
    const hasAnswers = answerTypeBoxes.length > 0;

    // 批量识别+匹配流程：有题目框时启用 batchProcessing
    if (hasQuestions) {
      setBatchProcessing(true);
      if (reIds.size > 0) setReRecognizingIds(reIds);
      // 保存识别前状态，用于完成后的闪烁动画
      prevQuestionCountRef.current = currentQuestions.length;
      prevReRecognizingIdsRef.current = new Set(reIds);
      maxQuestionIdRef.current = currentQuestions.length > 0 ? Math.max(...currentQuestions.map(q => q.id)) : 0;

      // 按场景设置进度提示文案（进度已重置，用总数-重识别数推算新增数）
      const newBoxCount = questionTypeBoxes.length - reIds.size;
      const reBoxCount = reIds.size;
      if (reBoxCount > 0 && newBoxCount > 0) {
        setProcessingMessage(`正在识别 ${questionTypeBoxes.length} 个区域（含 ${reBoxCount} 道重新识别）...`);
        console.log('[重识别检测] 场景C：混合');
      } else if (reBoxCount > 0) {
        setProcessingMessage(`正在重新识别 ${reBoxCount} 道题目...`);
        console.log('[重识别检测] 场景B：仅重识别');
      } else {
        setProcessingMessage(`正在识别 ${questionTypeBoxes.length} 个新增区域...`);
        console.log('[重识别检测] 场景A：仅新增');
      }
      customProgressRef.current = true;
    }

    if (hasAnswers && !hasQuestions) {
      // 场景A：纯答案框 → 答案提取模式（覆盖已有题目的答案/解析）
      await processAnswerBoxes(answerTypeBoxes);
      clearActiveRecognitionBoxes();
      return;
    }

    if (hasQuestions && !hasAnswers) {
      // 场景B：纯题目框 → 完整识别流程（新增/合并题目卡片）
      await recognizeQuestionBoxes(questionTypeBoxes, new Map(), reIds);
      clearActiveRecognitionBoxes();
      return;
    }

    // 场景C：混合（既有答案框又有题目框）→ 分离并行处理
    // 答案框走答案提取，题目框走完整识别
    const results = await Promise.allSettled([
      processAnswerBoxes(answerTypeBoxes),
      recognizeQuestionBoxes(questionTypeBoxes, new Map(), reIds),
    ]);
    // 检查是否有失败
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.error('混合识别部分失败:', failures.map(f => f.status === 'rejected' ? f.reason : ''));
    }
    clearActiveRecognitionBoxes();
    return;
  };

  // 题目框完整识别流程（裁剪 → AI识别 → 新增/合并题目卡片）
  // 用于 type=question 或 type=full 的框，会新增或合并题目卡片
  const recognizeQuestionBoxes = async (
    boxes: QuestionBox[],
    existingCroppedImagesMap: Map<string, string>,
    reRecognizingQuestionIds: Set<number> = new Set(),
  ) => {
    // 裁剪图片存储
    const croppedImagesMap = new Map(existingCroppedImagesMap);
    let hasError = false;

    try {
      // 1. 裁剪所有选中框的图片
      const croppedImages: PageImage[] = [];
      // 记录裁剪图片对应的框，确保顺序一致（与croppedImages索引对应）
      const orderedBoxes: QuestionBox[] = [];
      
      for (const page of pageImages) {
        // 分离跨页框和非跨页框
        const pageBoxes = boxes.filter(b => b.pageNumber === page.pageNumber && !b.endPageNumber);
        // 跨页框：起始页为当前页的框
        const crossPageBoxes = boxes.filter(b => b.pageNumber === page.pageNumber && b.endPageNumber);
        if (pageBoxes.length === 0 && crossPageBoxes.length === 0) continue;
        
        // 计算缩放比例：
        // 用户画框时的坐标是相对于 getBoundingClientRect() 的
        // getBoundingClientRect() 返回的是经过 CSS transform scale 后的尺寸
        // 显示尺寸 = displayWidth * (zoom / 100)
        // 原始图片尺寸 = page.width（经过 pdfToImages 缩放后的尺寸）
        const displayActualWidth = displayWidth * (zoom / 100);
        const scale = page.width / displayActualWidth;
        
        // 处理非跨页框
        if (pageBoxes.length > 0) {
          // 将显示坐标转换为原始图片坐标
          const scaledBoxes = pageBoxes.map(b => ({
            id: b.id,
            x: Math.round(b.x * scale),
            y: Math.round(b.y * scale),
            width: Math.round(b.width * scale),
            height: Math.round(b.height * scale),
          }));
          
          const cropped = await batchCropImages(
            page.imageData,
            scaledBoxes,
            page.width,
            page.height
          );
          
          cropped.forEach((value, key) => {
            croppedImagesMap.set(key, value);
            // 为每个裁剪图片创建 PageImage 结构
            const originalBox = pageBoxes.find(b => b.id === key);
            croppedImages.push({
              pageNumber: page.pageNumber,
              imageData: value,
              width: originalBox?.width || 400,
              height: originalBox?.height || 200,
            });
            // 记录对应的框，确保顺序与croppedImages一致
            if (originalBox) {
              orderedBoxes.push(originalBox);
            }
          });
        }
        
        // 处理跨页框：从起始页裁剪第一部分，从结束页裁剪第二部分，然后垂直拼接
        for (const box of crossPageBoxes) {
          // 第一部分：从框的 y 到页面底部
          const firstPartHeight = displayWidth * (page.height / page.width) - box.y;
          const firstPartScaled = {
            id: box.id + '_part1',
            x: Math.round(box.x * scale),
            y: Math.round(box.y * scale),
            width: Math.round(box.width * scale),
            height: Math.round(firstPartHeight * scale),
          };
          
          const firstPartCropped = await batchCropImages(
            page.imageData,
            [firstPartScaled],
            page.width,
            page.height
          );
          
          const firstPartData = firstPartCropped.get(box.id + '_part1');
          if (!firstPartData) {
            console.error('跨页框第一部分裁剪失败:', box.id);
            continue;
          }
          
          // 第二部分：从结束页顶部到 endPageY + endPageHeight
          const endPage = pageImages.find(p => p.pageNumber === box.endPageNumber);
          if (!endPage) {
            console.error('找不到跨页框的结束页:', box.endPageNumber);
            continue;
          }
          
          const endPageScale = endPage.width / displayActualWidth;
          const secondPartScaled = {
            id: box.id + '_part2',
            x: Math.round(box.x * endPageScale),
            y: Math.round((box.endPageY || 0) * endPageScale),
            width: Math.round(box.width * endPageScale),
            height: Math.round((box.endPageHeight || 0) * endPageScale),
          };
          
          const secondPartCropped = await batchCropImages(
            endPage.imageData,
            [secondPartScaled],
            endPage.width,
            endPage.height
          );
          
          const secondPartData = secondPartCropped.get(box.id + '_part2');
          if (!secondPartData) {
            console.error('跨页框第二部分裁剪失败:', box.id);
            continue;
          }
          
          // 垂直拼接两部分
          const stitchedImage = await stitchImagesVertically(firstPartData, secondPartData);
          
          croppedImagesMap.set(box.id, stitchedImage);
          croppedImages.push({
            pageNumber: page.pageNumber,
            imageData: stitchedImage,
            width: box.width,
            height: firstPartHeight + (box.endPageHeight || 0),
          });
          orderedBoxes.push(box);
        }
      }
      
      // 2. 调用 AI 识别（只发送裁剪后的图片）
      // 仅在没有自定义进度文案时才设置默认文案
      if (!customProgressRef.current) {
        setProcessingMessage(`正在 AI 识别 ${croppedImages.length} 个题目...`);
      } else {
        console.log('[重识别检测] 跳过默认文案，使用自定义场景文案');
      }
      
      // 检查是否有裁剪图片
      if (croppedImages.length === 0) {
        throw new Error('裁剪图片失败，请重试');
      }
      
      console.log('调用 AI 识别，裁剪图片数:', croppedImages.length);

      // 创建 AbortController 以支持暂停/取消
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await fetch('/api/recognize-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: croppedImages,
          userBoxes: orderedBoxes,
          croppedMode: true,
          options: {
            extractAnswerFromAnalysis: true,
            validQuestionTypes: getValidQuestionTypes(subjectInfo || ''),
          },
          subjectInfo: subjectInfo,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 尝试读取错误信息
        let errorMsg = `AI 识别请求失败 (${response.status})`;
        try {
          const errorText = await response.text();
          console.error('API 错误响应:', errorText);
          const errorData = JSON.parse(errorText);
          errorMsg = errorData.error || errorMsg;
        } catch (e) {
          console.error('解析错误响应失败:', e);
        }
        throw new Error(errorMsg);
      }

      // 3. 处理 SSE 流式响应
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        // 检查是否被中止（暂停或取消）
        if (controller.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              const chunk = JSON.parse(jsonStr);

              if (chunk.type === 'progress') {
                if (!customProgressRef.current) {
                  setProcessingMessage(chunk.data.message);
                }
              } else if (chunk.type === 'complete') {
                const { result } = chunk.data;
                setRecognitionResult(result.recognition);
                
                // 生成匹配的题目
                const matchedQuestions = result.matchedQuestions as MatchedQuestion[];
                const answerMarkers = result.answerMarkers as AnswerMarker[];
                const unmatchedAnswers = result.unmatchedAnswers as Array<{
                  id: string;
                  questionNumber: number | null;
                  content: string;
                  answer: string;
                  analysis: string;
                  boxId: string;
                  croppedImageData?: string;
                  pageNumber?: number;
                }>;
                const boxTypes = result.boxTypes as Array<{
                  boxId: string;
                  type: 'question' | 'answer';
                  questionNumber: number | null;
                }>;
                
                // 更新框的识别状态和题号（保留用户设定的 type，不覆盖，取消选中状态）
                if (boxTypes && boxTypes.length > 0) {
                  setQuestionBoxes(prev => prev.map(box => {
                    const boxType = boxTypes.find(bt => bt.boxId === box.id);
                    if (boxType) {
                      return {
                        ...box,
                        recognized: true, // 标记为已识别
                        isSelected: false, // 识别完成后取消选中
                        // 保留用户设定的 type（question/answer/full），不被 AI 覆盖
                        // AI 的 boxTypes.type 只有 question|answer，会丢失 full 类型
                        questionNumber: boxType.questionNumber || undefined,
                      };
                    }
                    return box;
                  }));

                }

                // 计算新题目的起始ID（基于现有题目的最大ID）
                const currentQuestionsForId = questionsRef.current;
                const maxExistingId = currentQuestionsForId.length > 0 
                  ? Math.max(...currentQuestionsForId.map(q => q.id)) 
                  : 0;
                
                // 转换为旧版 Question 格式
                const newQuestions: Question[] = matchedQuestions.map((q, index) => {
                  // 兜底：AI 未识别到有效题号时（如 NaN / 0 / 负数），用索引+1 作为默认题号
                  const rawNum = q.number;
                  const validNumber = (rawNum != null && !isNaN(rawNum) && isFinite(rawNum) && rawNum > 0)
                    ? Math.floor(rawNum)
                    : index + 1;

                  return {
                    id: maxExistingId + index + 1,
                    number: validNumber,
                    content: formatRecognizedContent(q.questionContent),
                    status: q.status,
                    answer: typeof q.answer === 'string' ? q.answer : String(q.answer || ''),
                    analysis: typeof q.analysis === 'string' ? q.analysis : String(q.analysis || ''),
                    answerSource: q.answerSource,
                    boxId: q.questionBoxId,
                    box: q.questionBox,
                    questionType: resolveQuestionType(q.questionType, q.questionContent, validQuestionTypes),
                    showRecognizedContent: q.showRecognizedContent,
                    croppedImageData: croppedImagesMap.get(q.questionBoxId) || q.croppedImageData,
                    optionCount: q.optionCount ?? (choiceQuestionTypes.includes(q.questionType) ? 4 : 0),
                    optionContents: {},
                    subQuestions: recognizeSubQuestions(q, validQuestionTypes),
                    blankCount: q.blankCount ?? 1,
                    blankAnswers: (() => {
                      const blankCount = q.blankCount ?? 1;
                      if (isFillBlankType(q.questionType) && blankCount > 1 && q.answer) {
                        const parts = splitAnswerByBlanks(q.answer, blankCount);
                        if (parts) return parts;
                      }
                      return [];
                    })(),
                  };
                });

                // 图片模式直接使用完整框截图，不做二次裁剪
                // 理由：这是教师端录题工具（非学生视图），图片仅作辅助参考；
                //       固定比例裁剪无法适配不同高度的题目框，必然导致「截多丢选项 / 截少露答案」的两难。

                // 处理未匹配的答案
                // 核心策略：优先使用框类型弹窗时建立的 linkedQuestionId 映射关系自动填充
                // 其次用 AI 返回的 questionNumber 尝试自动匹配
                if (unmatchedAnswers && unmatchedAnswers.length > 0) {
                  setQuestions(prev => {
                    let updated = [...prev];
                    unmatchedAnswers.forEach(ua => {
                      // 策略1: 通过 boxId 找到对应的 QuestionBox，检查是否有预关联的题目
                      const sourceBox = questionBoxes.find(b => b.id === ua.boxId);
                      if (sourceBox?.linkedQuestionId) {
                        updated = updated.map(q =>
                          q.id === sourceBox.linkedQuestionId
                            ? mergeAnswerToQuestion(q, ua.answer, ua.analysis)
                            : q
                        );
                        return;
                      }
                      // 策略2: 用 AI 识别到的题号自动匹配（兜底）
                      if (ua.questionNumber != null) {
                        const targetQ = updated.find(q => q.number === ua.questionNumber);
                        if (targetQ) {
                          updated = updated.map(q =>
                            q.id === targetQ.id ? mergeAnswerToQuestion(q, ua.answer, ua.analysis) : q
                          );
                        }
                      }
                    });
                    return updated;
                  });
                }
                
                // 处理新题目与已有题目的题号重复：将答案合并到已有题目，而非创建重复题目
                // 场景：用户先识别了题目并添加了子题结构，再框答案重新识别时，
                //       AI 可能将同一题号的答案作为新的 matchedQuestion 返回，
                //       此时需要将答案合并回已有题目（包括子题），而不是新增重复题目
                const questionsToMerge: typeof newQuestions = [];
                const questionsToAppend: typeof newQuestions = [];
                const questionsToUpdate: { index: number; newQ: typeof newQuestions[0] }[] = [];
                
                for (const newQ of newQuestions) {
                  // 使用 ref 获取最新的题目列表，避免闭包问题
                  const currentQuestions = questionsRef.current;
                  // 查找已有题目中是否有相同题号的题目
                  const existingIdx = currentQuestions.findIndex(
                    q => q.number === newQ.number && q.number > 0
                  );
                  
                  if (existingIdx !== -1) {
                    const existingQ = currentQuestions[existingIdx];
                    // 判断是否应合并答案到已有题目：
                    // 1. 已有题目有内容
                    // 2. 新题目内容为空或很短（可能只是答案区域被误识别为题目）
                    // 3. 或者新题目有答案需要合并到已有题目
                    const existingHasContent = existingQ.content && existingQ.content.trim().length > 0;
                    const newContentIsShort = !newQ.content || newQ.content.trim().length <= 10;
                    const newHasAnswer = !!(newQ.answer && newQ.answer.trim());
                    const shouldUpdateExisting = reRecognizingQuestionIds.has(existingQ.id) || !newContentIsShort;
                    
                    if (existingHasContent && !shouldUpdateExisting && (newContentIsShort || newHasAnswer)) {
                      // 合并答案到已有题目
                      questionsToMerge.push(newQ);
                      continue;
                    } else {
                      // 覆盖更新已有题目（重新识别场景）
                      questionsToUpdate.push({ index: existingIdx, newQ });
                      continue;
                    }
                  }
                  
                  // 不需要合并，直接追加
                  questionsToAppend.push(newQ);
                }
                
                // 执行合并：将新题目的答案/解析合并到已有题目中
                if (questionsToMerge.length > 0) {
                  setQuestions(prev => prev.map(q => {
                    const mergeSource = questionsToMerge.find(nq => nq.number === q.number);
                    if (mergeSource) {
                      const ansStr = mergeSource.answer || '';
                      const anaStr = mergeSource.analysis || '';
                      if (ansStr || anaStr) {
                        return mergeAnswerToQuestion(q, ansStr, anaStr);
                      }
                    }
                    return q;
                  }));
                }
                
                // 合并更新、追加到一次 setState 中，避免竞态条件
                const updatedIds: number[] = [];
                const appendedIds: number[] = [];
                setQuestions(prev => {
                  let next = [...prev];
                  // 覆盖更新已有题目
                  if (questionsToUpdate.length > 0) {
                    next = next.map((q, idx) => {
                      const updateItem = questionsToUpdate.find(u => u.index === idx);
                      if (updateItem) {
                        updatedIds.push(q.id);
                        return { ...updateItem.newQ, id: q.id };
                      }
                      return q;
                    });
                  }
                  // 追加新题目
                  if (questionsToAppend.length > 0) {
                    questionsToAppend.forEach(q => appendedIds.push(q.id));
                    next = insertQuestionsByQuestionNumber(next, questionsToAppend);
                  }
                  return next;
                });
                setAnswers(prev => [...prev, ...answerMarkers]);
                
                // 高亮显示更新/追加的题目
                const highlightIds = [...updatedIds, ...appendedIds];
                if (highlightIds.length > 0) {
                  setHighlightedQuestionIds(new Set(highlightIds));
                  setTimeout(() => setHighlightedQuestionIds(new Set()), 3000);
                }

                // 分步模式/跨文件模式-题目识别完成后，自动触发全局答案匹配
                if ((workMode === 'same-file' || workMode === 'cross-file') && (flowStep === 'frame_and_review' || flowStep === 'review')) {
                  setTimeout(() => {
                    handleGlobalMatchAnswers(true);
                  }, 100);
                }

                // 识别完成后进入核对结果步骤，右侧展示结果，左侧继续可框选新增内容
                setFlowStep('review');
                setFlowStage('matched');
                return; // 成功完成，退出函数
              } else if (chunk.type === 'error') {
                throw new Error(chunk.data.error);
              }
            } catch (e) {
              // 如果是我们主动抛出的错误，继续抛出
              if (e instanceof Error && !e.message.includes('解析 SSE')) {
                throw e;
              }
              console.error('解析 SSE 数据失败:', e);
            }
          }
        }
      }
      
      // 如果流结束但没有收到 complete 消息
      throw new Error('AI 识别未返回完整结果，请重试');
    } catch (error) {
      // 检查是否被用户主动中止（取消识别）
      const isAborted = error instanceof DOMException && error.name === 'AbortError';
      if (isAborted) {
        abortControllerRef.current = null;
        console.log('[识别] 用户取消识别');
        restoreActiveRecognitionBoxes();
        // 不清空已识别的结果，只停止后续处理
        return; // 直接返回，不创建 mock 数据
      }

      hasError = true;
      console.error('批量移入失败:', error);

      const errorMessage = error instanceof Error ? error.message : '未知错误';
      const isNetworkError = errorMessage.includes('network') || errorMessage.includes('网络')
        || errorMessage.includes('Failed to fetch') || errorMessage.includes('Connection')
        || errorMessage.includes('timeout') || errorMessage.includes('超时');
      const isCredentialError = errorMessage.includes('credentials') || errorMessage.includes('apiKey')
        || errorMessage.includes('OPENAI_API_KEY') || errorMessage.includes('API_KEY')
        || errorMessage.includes('workloadIdentity') || errorMessage.includes('adminAPIKey');

      // 如果已有题目（增量识别场景），不添加mock数据，只显示错误提示
      const currentQuestions = questionsRef.current;
      if (currentQuestions.length > 0) {
        setProcessingMessage(`识别失败: ${isNetworkError ? '网络连接异常，请稍后重试' : isCredentialError ? 'AI 服务未配置，请联系管理员设置 API Key' : errorMessage}`);
        // 保留已有题目，停留在当前步骤
        restoreActiveRecognitionBoxes();
        setFlowStep('review');
        setFlowStage('matched');
      } else {
        // 首次识别失败，降级为 Mock 数据
        setProcessingMessage(`AI 识别失败: ${isCredentialError ? 'AI 服务未配置，请设置 COZE_WORKLOAD_IDENTITY_API_KEY 或 OPENAI_API_KEY 环境变量' : errorMessage}，使用模拟数据...`);

        // 延迟一下让用户看到错误信息
        await new Promise(resolve => setTimeout(resolve, 2000));

        const mockQuestions: Question[] = boxes.map((box, index) => ({
          id: index + 1,
          number: index + 1,
          content: `第${index + 1}题：模拟题目内容（AI识别失败，请手动编辑）`,
          status: index < 3 ? 'matched' : 'no_answer',
          answer: index < 3 ? ['A', 'B', 'C'][index] : undefined,
          analysis: index < 3 ? `第${index + 1}题解析内容` : undefined,
          answerSource: 'direct',
          boxId: box.id,
          box,
          questionType: '单选题',
          showRecognizedContent: false,
          croppedImageData: croppedImagesMap.get(box.id),
          optionCount: 4,
          optionContents: {},
          blankCount: 1,
          blankAnswers: [],
        }));

        setQuestions(prev => [...prev, ...mockQuestions]);
        setFlowStep('review');
        setFlowStage('matched');
      }
    } finally {
      setIsProcessing(false);
      // 仅在成功完成后清除进度信息，报错时保留错误提示
      if (!hasError) {
        setProcessingMessage('');
      }
      // 清除重识别状态和自定义进度标记
      setReRecognizingIds(new Set());
      customProgressRef.current = false;
      // 一步模式识别完成后重置 batchProcessing
      if (workMode === 'questions-only') {
        setBatchProcessing(false);
      }
    }
  };

  /** 取消识别 */
  const handleCancelRecognition = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setReRecognizingIds(new Set());
    customProgressRef.current = false;
    setIsProcessing(false);
    setProcessingMessage('');
    setBatchProcessing(false);
    restoreActiveRecognitionBoxes();
  };

  // 全局匹配答案：AI 从整页/多页资料中定位答案区域，自动关联到已有题目
  const handleGlobalMatchAnswers = async (isAutoTriggered = false) => {
    const currentQs = questionsRef.current;
    if (currentQs.length === 0 || pageImages.length === 0) {
      if (isAutoTriggered) setBatchProcessing(false);
      return;
    }

    setIsProcessing(true);
    setFlowStage('recognizing');
    setProcessingMessage('正在匹配资料题目答案...');

    try {
      // 发送所有页面图片 + 已有题目信息，让 AI 从整页中定位答案
      const response = await fetch('/api/recognize-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: pageImages,  // 整页图片
          globalMatch: true,   // 标记为全局匹配模式
          existingQuestions: currentQs.map(q => ({
            id: q.id,
            number: q.number,
            content: q.content,
            questionType: q.questionType,
            hasAnswer: hasUsableAnswer(q),
          })),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `请求失败(${response.status})`);
      }

      // 解析 SSE 流
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const chunk = JSON.parse(line.slice(6));
              if (chunk.type === 'progress') {
                if (!customProgressRef.current) {
                  setProcessingMessage(chunk.data.message);
                }
              } else if (chunk.type === 'complete') {
                const result = chunk.data.result;
                // result.globalMatches: Array<{ questionId: number; answer: string; analysis: string }>
                const globalMatches = result.globalMatches as Array<{
                  questionId: number;
                  answer: string;
                  analysis: string;
                }> | undefined;

                let unmatchedIds: number[] = [];
                if (globalMatches && globalMatches.length > 0) {
                  let matchedCount = 0;
                  setQuestions(prev => prev.map(q => {
                    const match = globalMatches.find(m => m.questionId === q.id);
                    if (match) {
                      matchedCount++;
                      return mergeAnswerToQuestion(q, match.answer, match.analysis);
                    }
                    return q;
                  }));
                  setProcessingMessage('全局匹配完成');
                  // 找出未匹配到答案的题目
                  unmatchedIds = currentQs
                    .filter(q => !globalMatches.some(m => m.questionId === q.id))
                    .map(q => q.id);
                } else {
                  setProcessingMessage('全局匹配完成');
                  unmatchedIds = currentQs.map(q => q.id);
                }

                // 如果有未匹配的题目，高亮闪烁并定位到第一个
                if (unmatchedIds.length > 0) {
                  setHighlightedQuestionIds(new Set(unmatchedIds));
                  setTimeout(() => setHighlightedQuestionIds(new Set()), 5000);
                  setTimeout(() => {
                    const firstEl = document.querySelector(`[data-question-id="${unmatchedIds[0]}"]`) as HTMLElement | null;
                    firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 100);
                }

                // 标记答案框（如果有）
                if (result.answerBoxes && result.answerBoxes.length > 0) {
                  setQuestionBoxes(prev => [...prev, ...result.answerBoxes.map((ab: { id: string; x: number; y: number; width: number; height: number; pageNumber: number; questionNumber: number }) => ({
                    id: ab.id,
                    x: ab.x,
                    y: ab.y,
                    width: ab.width,
                    height: ab.height,
                    isSelected: false,
                    pageNumber: ab.pageNumber,
                    recognized: true,
                    type: 'answer' as const,
                    questionNumber: ab.questionNumber,
                  }))]);
                }

                setTimeout(() => {
                  setIsProcessing(false);
                  setBatchProcessing(false);
                  setFlowStep('review');
                  setFlowStage('matched');
                  setProcessingMessage('');
                }, 2000);
                return;
              } else if (chunk.type === 'error') {
                throw new Error(chunk.data.error);
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }

      // 兜底：SSE 流结束后如果还在 processing 状态，强制清除
      // （防止后端发送 error/complete 事件前流就关闭了的情况）
      // 注意：正常流程中 complete/error 事件会通过 return 或 throw 提前退出
      console.warn('[全局匹配] SSE 流结束但未收到 complete/error 事件，强制清除 loading');
      setIsProcessing(false);
      setFlowStep('review');
      setFlowStage('matched');
      setProcessingMessage('全局匹配完成');
      setTimeout(() => setProcessingMessage(''), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '全局匹配失败';
      console.error('[全局匹配答案失败]', err);
      setProcessingMessage(`全局匹配失败: ${message}`);
      setTimeout(() => {
        setIsProcessing(false);
        setFlowStep('review');
        setFlowStage('matched');
        setProcessingMessage('');
        if (isAutoTriggered) setBatchProcessing(false);
      }, 3000);
    }
  };

  // 重新上传
  const [showReuploadConfirm, setShowReuploadConfirm] = useState(false);

  const handleReupload = () => {
    setShowReuploadConfirm(true);
  };

  const handleReuploadConfirm = () => {
    setShowReuploadConfirm(false);
    // 清空当前数据
    setQuestionBoxes([]);
    setReviewHiddenBoxIds(new Set());
    setQuestions([]);
    setAnswers([]);
    setRecognitionResult(null);
    setFlowStage('cutting');
    setSelectedBoxId(null);
    setPageImages([]);
    setTotalPages(0);
    processedFilesCountRef.current = 0;
    autoDetectedPageCountRef.current = 0; // 重置切题计数
    setWorkMode(null);
    setFileRoles([]);
    setHasAutoDetected(false);
    setIsAutoDetecting(false);
    // 清理持久化状态，回到主页（AI小乐面板页面）
    sessionStorage.removeItem('leke_upload_dialog_open');
    if (onClose) {
      onClose();
    }
  };

  const handleReuploadCancel = () => {
    setShowReuploadConfirm(false);
  };

  // 切换视图模式
  const handleModeChange = (mode: 'image' | 'recognize') => {
    if (mode === viewMode) return;
    setIsModeChanging(true);
    setTimeout(() => {
      setViewMode(mode);
      setIsModeChanging(false);
    }, 300);
  };

  // 更新题号
  const handleUpdateNumber = (questionId: number, newNumber: number) => {
    if (newNumber < 1) return;
    
    // 使用 ref 获取最新的题目状态，避免闭包问题
    const currentQuestion = questionsRef.current.find(q => q.id === questionId);
    if (!currentQuestion) return;
    
    const oldNumber = currentQuestion.number;
    const questionBoxId = currentQuestion.boxId;
    
    // 如果题号没变化，直接返回
    if (oldNumber === newNumber) return;
    
    // 更新题目列表中的题号，同时替换 content 中的题号文本
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      // 替换 content 开头的旧题号文本为新题号（匹配 "13."、"13、"、"13 " 等格式）
      const updatedContent = q.content.replace(
        new RegExp(`^\\s*${oldNumber}\\s*[.。、\\s]\\s*`),
        `${newNumber}. `
      );
      return { ...q, number: newNumber, content: updatedContent };
    }));
    
    // 同步更新左侧框的题号（题目框和答案框）
    setQuestionBoxes(prev => prev.map(box => {
      // 更新题目框
      if (box.id === questionBoxId) {
        return { ...box, questionNumber: newNumber };
      }
      // 更新答案框（通过旧题号匹配）
      if (box.type === 'answer' && box.questionNumber === oldNumber) {
        return { ...box, questionNumber: newNumber };
      }
      return box;
    }));
  };

  // 更新题目内容
  const handleUpdateContent = (questionId: number, content: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return { ...q, content };
    }));
  };

  // 更新答案
  const handleUpdateAnswer = (questionId: number, answer: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      const newStatus = answer ? 'matched' : 'pending_confirm';
      return { ...q, answer, status: newStatus, answerSource: 'manual' };
    }));
    // 答案已补充，移除匹配失败提示
    setAnswerMatchFailedForQuestionIds(prev => {
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });
  };

  // 更新解析
  const handleUpdateAnalysis = (questionId: number, analysis: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;

      let extractedAnswer = q.answer;
      let answerSource = q.answerSource;

      if (!q.answer && analysis) {
        const extracted = extractAnswerFromAnalysis(analysis);
        if (extracted) {
          extractedAnswer = extracted;
          answerSource = 'extracted';
        }
      }

      return {
        ...q,
        analysis,
        answer: extractedAnswer,
        answerSource,
        status: extractedAnswer ? 'matched' : q.status
      };
    }));
    // 解析已补充，移除匹配失败提示
    setAnswerMatchFailedForQuestionIds(prev => {
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });
  };

  // 重新识别单题答案：清空当前答案后触发全局匹配（仅针对此题）
  const handleReRecognizeAnswer = async (questionId: number) => {
    if (isProcessing) return;

    // 先清空该题的答案和解析，标记为无答案状态
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return { ...q, answer: '', analysis: '', status: 'no_answer', answerSource: undefined };
    }));

    // 等待状态更新后触发全局匹配
    await new Promise(resolve => setTimeout(resolve, 100));

    // 调用全局匹配（后端会自动过滤 hasAnswer=false 的题目）
    await handleGlobalMatchAnswers();
  };

  // ==================== 图片裁剪相关函数 ====================

  /** 开始裁剪：从已记录的图片尺寸中同步初始化裁剪区域（默认高度70%） */
  const handleStartCrop = (questionId: number) => {
    const question = questions.find(q => q.id === questionId);
    if (!question?.croppedImageData) return;

    // 从 ref 中读取该题图片的渲染尺寸（正常模式下 onLoad 时记录）
    const recordedSize = imageSizesRef.current.get(questionId);
    if (recordedSize && recordedSize.width > 0 && recordedSize.height > 0) {
      setImageDisplaySize(recordedSize);
      setCropRegion({
        x: 0,
        y: 0,
        width: recordedSize.width,
        height: Math.round(recordedSize.height * 0.7),
      });
    } else {
      // 尚未记录尺寸时设为 null，等待裁剪模式下的 img onLoad 触发
      setCropRegion(null);
    }

    setCroppingQuestionId(questionId);
    setCropDragType(null);
    setCropDragStart(null);
  };

  /** 图片加载完成后计算并设置初始裁剪区域 */
  const handleCropImageLoad = (imgWidth: number, imgHeight: number) => {
    setImageDisplaySize({ width: imgWidth, height: imgHeight });
    if (!cropRegion && croppingQuestionId !== null) {
      // 默认：宽度100%，高度70%，从顶部开始
      setCropRegion({
        x: 0,
        y: 0,
        width: imgWidth,
        height: Math.round(imgHeight * 0.7),
      });
    }
  };

  /** 确认裁剪：用 Canvas 截取选区 */
  const handleConfirmCrop = () => {
    if (!cropRegion || croppingQuestionId === null) return;
    const question = questions.find(q => q.id === croppingQuestionId);
    if (!question?.croppedImageData) return;

    // 最小尺寸校验
    if (cropRegion.width < 50 || cropRegion.height < 30) {
      alert('裁剪区域太小，请调整后重试');
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      // 计算实际图片尺寸与显示尺寸的比例
      const scaleX = img.naturalWidth / imageDisplaySize.width;
      const scaleY = img.naturalHeight / imageDisplaySize.height;

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropRegion.width * scaleX);
      canvas.height = Math.round(cropRegion.height * scaleY);
      const ctx = canvas.getContext('2d');
      if (!ctx) { setCroppingQuestionId(null); return; }

      ctx.drawImage(
        img,
        cropRegion.x * scaleX,
        cropRegion.y * scaleY,
        cropRegion.width * scaleX,
        cropRegion.height * scaleY,
        0, 0,
        canvas.width,
        canvas.height
      );

      const croppedDataUrl = canvas.toDataURL('image/png');
      setQuestions(prev => prev.map(q =>
        q.id === croppingQuestionId
          ? { ...q, userCroppedImageData: croppedDataUrl }
          : q
      ));
      setCroppingQuestionId(null);
      setCropRegion(null);
    };
    img.src = question.croppedImageData;
  };

  /** 取消裁剪 */
  const handleCancelCrop = () => {
    setCroppingQuestionId(null);
    setCropRegion(null);
    setCropDragType(null);
    setCropDragStart(null);
  };

  /** 恢复原图（清除用户裁剪） */
  const handleRestoreOriginalImage = (questionId: number) => {
    setQuestions(prev => prev.map(q =>
      q.id === questionId
        ? { ...q, userCroppedImageData: undefined }
        : q
    ));
  };

  /** 裁剪框鼠标按下 */
  const handleCropMouseDown = (
    e: React.MouseEvent,
    dragType: 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-w' | 'resize-e'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!cropRegion || !imageDisplaySize.width) return;

    setCropDragType(dragType);
    setCropDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      regionX: cropRegion.x,
      regionY: cropRegion.y,
      regionW: cropRegion.width,
      regionH: cropRegion.height,
    });
  };

  /** 裁剪框鼠标移动 */
  useEffect(() => {
    if (!cropDragType || !cropDragStart || !cropRegion || !imageDisplaySize.width) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - cropDragStart.mouseX;
      const dy = e.clientY - cropDragStart.mouseY;
      const maxW = imageDisplaySize.width;
      const maxH = imageDisplaySize.height;
      const MIN_SIZE = 30; // 最小裁剪尺寸

      let newX = cropDragStart.regionX;
      let newY = cropDragStart.regionY;
      let newW = cropDragStart.regionW;
      let newH = cropDragStart.regionH;

      switch (cropDragType) {
        case 'move':
          newX = Math.max(0, Math.min(maxW - newW, cropDragStart.regionX + dx));
          newY = Math.max(0, Math.min(maxH - newH, cropDragStart.regionY + dy));
          break;
        case 'resize-nw':
          newW = Math.max(MIN_SIZE, cropDragStart.regionW - dx);
          newH = Math.max(MIN_SIZE, cropDragStart.regionH - dy);
          newX = cropDragStart.regionX + (cropDragStart.regionW - newW);
          newY = cropDragStart.regionY + (cropDragStart.regionH - newH);
          break;
        case 'resize-ne':
          newW = Math.max(MIN_SIZE, cropDragStart.regionW + dx);
          newH = Math.max(MIN_SIZE, cropDragStart.regionH - dy);
          newY = cropDragStart.regionY + (cropDragStart.regionH - newH);
          break;
        case 'resize-sw':
          newW = Math.max(MIN_SIZE, cropDragStart.regionW - dx);
          newH = Math.max(MIN_SIZE, cropDragStart.regionH + dy);
          newX = cropDragStart.regionX + (cropDragStart.regionW - newW);
          break;
        case 'resize-se':
          newW = Math.max(MIN_SIZE, cropDragStart.regionW + dx);
          newH = Math.max(MIN_SIZE, cropDragStart.regionH + dy);
          break;
        case 'resize-n':
          newH = Math.max(MIN_SIZE, cropDragStart.regionH - dy);
          newY = cropDragStart.regionY + (cropDragStart.regionH - newH);
          break;
        case 'resize-s':
          newH = Math.max(MIN_SIZE, cropDragStart.regionH + dy);
          break;
        case 'resize-w':
          newW = Math.max(MIN_SIZE, cropDragStart.regionW - dx);
          newX = cropDragStart.regionX + (cropDragStart.regionW - newW);
          break;
        case 'resize-e':
          newW = Math.max(MIN_SIZE, cropDragStart.regionW + dx);
          break;
      }

      // 边界约束
      newX = Math.max(0, newX);
      newY = Math.max(0, newY);
      newW = Math.min(newW, maxW - newX);
      newH = Math.min(newH, maxH - newY);

      setCropRegion({ x: Math.round(newX), y: Math.round(newY), width: Math.round(newW), height: Math.round(newH) });
    };

    const handleMouseUp = () => {
      setCropDragType(null);
      setCropDragStart(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [cropDragType, cropDragStart, cropRegion, imageDisplaySize]);

  // 更新题目类型（切换时重置选项数/子题）
  const handleUpdateQuestionType = (questionId: number, questionType: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      const updated = { ...q, questionType };
      // 切换到选择题时，初始化选项数
      if (choiceQuestionTypes.includes(questionType)) {
        if (!updated.optionCount || updated.optionCount < 2) {
          updated.optionCount = 4;
        }
        updated.subQuestions = undefined;
      } else if (compoundQuestionTypes.includes(questionType)) {
        // 切换到复合题时，初始化子题
        updated.optionCount = 0;
        updated.optionContents = {};
        if (!updated.subQuestions) {
          updated.subQuestions = [];
        }
      } else {
        // 简单题（判断/填空）
        updated.optionCount = 0;
        updated.optionContents = {};
        updated.subQuestions = undefined;
        if (isFillBlankType(questionType)) {
          updated.blankCount = updated.blankCount || 1;
        } else {
          // 从填空题切换到其他类型时，合并 blankAnswers 回 answer
          if (isFillBlankType(q.questionType) && q.blankCount > 1 && q.blankAnswers.length > 0) {
            const mergedAnswer = q.blankAnswers.filter(Boolean).join('；');
            updated.answer = mergedAnswer || q.answer;
          }
          updated.blankCount = 1;
          updated.blankAnswers = [];
        }
      }
      return updated;
    }));
  };

  // 更新选择题选项数
  const handleUpdateOptionCount = (questionId: number, newCount: number) => {
    const clampedCount = Math.max(2, Math.min(26, newCount)); // 最少2个，最多26个
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      // 清理超出范围的选项内容
      const newContents: Record<string, string> = {};
      for (let i = 0; i < clampedCount; i++) {
        const letter = OPTION_LETTERS[i];
        newContents[letter] = q.optionContents[letter] || '';
      }
      return { ...q, optionCount: clampedCount, optionContents: newContents };
    }));
  };

  // 完形填空：批量设置所有子题的选项数
  const handleUpdateClozeOptionCount = (questionId: number, newCount: number) => {
    const clampedCount = Math.max(2, Math.min(26, newCount));
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      // 批量更新所有子题的选项
      const updatedSubs = (q.subQuestions || []).map((sub, idx) => {
        const newContents: Record<string, string> = {};
        for (let i = 0; i < clampedCount; i++) {
          const letter = OPTION_LETTERS[i];
          newContents[letter] = (sub.optionContents && sub.optionContents[letter]) || '';
        }
        return {
          ...sub,
          questionType: '单选题',
          optionCount: clampedCount,
          optionContents: newContents,
        };
      });
      return { ...q, subQuestions: updatedSubs };
    }));
  };

  // 更新选项内容
  const handleUpdateOptionContent = (questionId: number, letter: string, value: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return { ...q, optionContents: { ...q.optionContents, [letter]: value } };
    }));
  };

  // 更新填空数（仅填空题使用）
  // 关键逻辑：
  //   - 从 1 增加到 >1 时：尝试将已有 answer 剥离到 blankAnswers 各空位
  //   - 从 >1 减少到 1 时：将 blankAnswers 合并回 answer 单行
  //   - blankCount=1 时保持单行输入框，不影响未设置填空数的题目
  const handleUpdateBlankCount = (questionId: number, newCount: number, isSubQuestion = false, subId?: number) => {
    const clampedCount = Math.max(1, Math.min(10, newCount)); // 最少1个，最多10个
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      if (isSubQuestion && subId !== undefined) {
        // 子题填空数更新
        return {
          ...q,
          subQuestions: (q.subQuestions || []).map(s => {
            if (s.id !== subId) return s;
            const oldCount = s.blankCount || 1;
            const newBlankAnswers = [...(s.blankAnswers || [])];

            if (oldCount <= 1 && clampedCount > 1) {
              // 从单空增加到多空：尝试剥离已有答案
              if (s.answer) {
                const parts = splitAnswerByBlanks(s.answer, clampedCount);
                if (parts) {
                  // 剥离成功：答案拆分到各空位
                  return { ...s, blankCount: clampedCount, blankAnswers: parts, answer: '' };
                }
              }
              // 剥离失败：保留原答案，空位填空
              while (newBlankAnswers.length < clampedCount) newBlankAnswers.push('');
            } else if (oldCount > 1 && clampedCount <= 1) {
              // 从多空减少到单空：合并 blankAnswers 回 answer
              const mergedAnswer = (s.blankAnswers || []).filter(Boolean).join('；');
              return { ...s, blankCount: 1, blankAnswers: [], answer: mergedAnswer || s.answer };
            } else if (oldCount > 1 && clampedCount > 1) {
              // 多空之间调整：保留已有空位答案，扩展或截断
              // 无需额外处理
            }

            if (newBlankAnswers.length < clampedCount) {
              while (newBlankAnswers.length < clampedCount) newBlankAnswers.push('');
            }
            if (newBlankAnswers.length > clampedCount) newBlankAnswers.length = clampedCount;
            return { ...s, blankCount: clampedCount, blankAnswers: newBlankAnswers };
          }),
        };
      }
      // 主题填空数更新
      const oldCount = q.blankCount || 1;
      const newBlankAnswers = [...q.blankAnswers];

      if (oldCount <= 1 && clampedCount > 1) {
        // 从单空增加到多空：尝试剥离已有答案
        if (q.answer) {
          const parts = splitAnswerByBlanks(q.answer, clampedCount);
          if (parts) {
            // 剥离成功：答案拆分到各空位，清空单行答案
            return { ...q, blankCount: clampedCount, blankAnswers: parts, answer: '' };
          }
        }
        // 剥离失败：保留原答案，空位填空
        while (newBlankAnswers.length < clampedCount) newBlankAnswers.push('');
      } else if (oldCount > 1 && clampedCount <= 1) {
        // 从多空减少到单空：合并 blankAnswers 回 answer
        const mergedAnswer = q.blankAnswers.filter(Boolean).join('；');
        return { ...q, blankCount: 1, blankAnswers: [], answer: mergedAnswer || q.answer };
      }
      // 多空之间调整 或 单空内调整：保留已有空位答案

      if (newBlankAnswers.length < clampedCount) {
        while (newBlankAnswers.length < clampedCount) newBlankAnswers.push('');
      }
      if (newBlankAnswers.length > clampedCount) newBlankAnswers.length = clampedCount;
      return { ...q, blankCount: clampedCount, blankAnswers: newBlankAnswers };
    }));
  };

  // 更新某个空位的答案（仅填空题使用）
  const handleUpdateBlankAnswer = (questionId: number, blankIndex: number, value: string, isSubQuestion = false, subId?: number) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      if (isSubQuestion && subId !== undefined) {
        return {
          ...q,
          subQuestions: (q.subQuestions || []).map(s => {
            if (s.id !== subId) return s;
            const newBlankAnswers = [...(s.blankAnswers || [])];
            newBlankAnswers[blankIndex] = value;
            return { ...s, blankAnswers: newBlankAnswers };
          }),
        };
      }
      const newBlankAnswers = [...q.blankAnswers];
      newBlankAnswers[blankIndex] = value;
      return { ...q, blankAnswers: newBlankAnswers };
    }));
    // 答案已补充，移除匹配失败提示
    setAnswerMatchFailedForQuestionIds(prev => {
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });
  };

  // 删除新增选项（E及以后），将后续选项字母向前补位
  const handleDeleteOption = (questionId: number, deleteLetter: string) => {
    const deleteIndex = OPTION_LETTERS.indexOf(deleteLetter);
    if (deleteIndex < 4) return; // 不允许删除A/B/C/D
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      const newCount = q.optionCount - 1;
      if (newCount < 2) return q; // 至少保留2个选项
      // 构建新的 optionContents：被删选项之后的选项字母向前补位
      const newContents: Record<string, string> = {};
      for (let i = 0; i < newCount; i++) {
        const targetLetter = OPTION_LETTERS[i];
        if (i < deleteIndex) {
          // 被删选项之前的字母不变
          newContents[targetLetter] = q.optionContents[targetLetter] || '';
        } else {
          // 被删选项及之后：从原选项的下一个字母取值
          const sourceLetter = OPTION_LETTERS[i + 1];
          newContents[targetLetter] = q.optionContents[sourceLetter] || '';
        }
      }
      return { ...q, optionCount: newCount, optionContents: newContents };
    }));
  };

  // 删除子题新增选项（E及以后），将后续选项字母向前补位
  const handleDeleteSubOption = (questionId: number, subId: number, deleteLetter: string) => {
    const deleteIndex = OPTION_LETTERS.indexOf(deleteLetter);
    if (deleteIndex < 4) return;
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return {
        ...q,
        subQuestions: (q.subQuestions || []).map(s => {
          if (s.id !== subId) return s;
          const curCount = s.optionCount || 4;
          const newCount = curCount - 1;
          if (newCount < 2) return s;
          const newContents: Record<string, string> = {};
          const oldContents = s.optionContents || {};
          for (let i = 0; i < newCount; i++) {
            const targetLetter = OPTION_LETTERS[i];
            if (i < deleteIndex) {
              newContents[targetLetter] = oldContents[targetLetter] || '';
            } else {
              const sourceLetter = OPTION_LETTERS[i + 1];
              newContents[targetLetter] = oldContents[sourceLetter] || '';
            }
          }
          return { ...s, optionCount: newCount, optionContents: newContents };
        }),
      };
    }));
  };

  // 添加子题
  const handleAddSubQuestion = (questionId: number) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      const subQuestions = [...(q.subQuestions || [])];
      const newSubId = subQuestions.length > 0 ? Math.max(...subQuestions.map(s => s.id)) + 1 : 1;
      subQuestions.push({
        id: newSubId,
        questionType: resolveQuestionType(undefined, '', validQuestionTypes),
        content: '',
        answer: '',
        analysis: '',
        optionCount: 4,
        optionContents: {},
        blankCount: 1,
        blankAnswers: [],
      });
      return { ...q, subQuestions };
    }));
  };

  // 删除子题
  const handleDeleteSubQuestion = (questionId: number, subId: number) => {
    const targetQuestion = questionsRef.current.find(q => q.id === questionId);
    const targetSub = targetQuestion?.subQuestions?.find(s => s.id === subId);
    const hasProtectedContent = targetSub ? hasUsableAnswer(targetSub) || hasUsableAnalysis(targetSub) : false;
    if (hasProtectedContent && !window.confirm('该子题已有答案/解析，删除后内容将一并移除，是否继续？')) {
      return;
    }

    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return { ...q, subQuestions: (q.subQuestions || []).filter(s => s.id !== subId) };
    }));
  };

  // 更新子题题型
  const handleUpdateSubQuestionType = (questionId: number, subId: number, questionType: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return {
        ...q,
        subQuestions: (q.subQuestions || []).map(s => {
          if (s.id !== subId) return s;
          const updated = { ...s, questionType };
          if (choiceQuestionTypes.includes(questionType)) {
            updated.optionCount = updated.optionCount || 4;
            updated.optionContents = updated.optionContents || {};
          } else {
            updated.optionCount = undefined;
            updated.optionContents = undefined;
          }
          if (isFillBlankType(questionType)) {
            updated.blankCount = updated.blankCount || 1;
          } else {
            // 从填空题切换到其他类型时，合并 blankAnswers 回 answer
            if (isFillBlankType(s.questionType) && (s.blankCount || 1) > 1 && (s.blankAnswers || []).length > 0) {
              const mergedAnswer = (s.blankAnswers || []).filter(Boolean).join('；');
              updated.answer = mergedAnswer || s.answer;
            }
            updated.blankCount = undefined;
            updated.blankAnswers = undefined;
          }
          return updated;
        }),
      };
    }));
  };

  // 更新子题选项数
  const handleUpdateSubOptionCount = (questionId: number, subId: number, newCount: number) => {
    const clampedCount = Math.max(2, Math.min(26, newCount));
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return {
        ...q,
        subQuestions: (q.subQuestions || []).map(s => {
          if (s.id !== subId) return s;
          const newContents: Record<string, string> = {};
          for (let i = 0; i < clampedCount; i++) {
            const letter = OPTION_LETTERS[i];
            newContents[letter] = s.optionContents?.[letter] || '';
          }
          return { ...s, optionCount: clampedCount, optionContents: newContents };
        }),
      };
    }));
  };

  // 更新子题选项内容
  const handleUpdateSubOptionContent = (questionId: number, subId: number, letter: string, value: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return {
        ...q,
        subQuestions: (q.subQuestions || []).map(s => {
          if (s.id !== subId) return s;
          return { ...s, optionContents: { ...(s.optionContents || {}), [letter]: value } };
        }),
      };
    }));
  };

  // 更新子题答案
  const handleUpdateSubAnswer = (questionId: number, subId: number, answer: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return {
        ...q,
        subQuestions: (q.subQuestions || []).map(s =>
          s.id === subId ? { ...s, answer } : s
        ),
      };
    }));
    // 答案已补充，移除匹配失败提示
    setAnswerMatchFailedForQuestionIds(prev => {
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });
  };

  // 更新子题解析
  const handleUpdateSubAnalysis = (questionId: number, subId: number, analysis: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      return {
        ...q,
        subQuestions: (q.subQuestions || []).map(s =>
          s.id === subId ? { ...s, analysis } : s
        ),
      };
    }));
    // 解析已补充，移除匹配失败提示
    setAnswerMatchFailedForQuestionIds(prev => {
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });
  };

  // 切换"使用图片"开关
  const handleToggleRecognizedContent = (questionId: number) => {
    setQuestions(prev => prev.map(q => 
      q.id === questionId ? { ...q, showRecognizedContent: !q.showRecognizedContent } : q
    ));
  };

  // 删除题目
  const handleDeleteQuestion = (questionId: number) => {
    setQuestions(prev => prev.filter(q => q.id !== questionId));
    setAnswers(prev => prev.map(a => 
      a.questionId === String(questionId) ? { ...a, questionId: null, status: 'unlinked' } : a
    ));
  };

  // 上移题目卡片
  const handleMoveQuestionUp = (questionId: number) => {
    setQuestions(prev => {
      const index = prev.findIndex(q => q.id === questionId);
      if (index <= 0) return prev;
      const newQuestions = [...prev];
      [newQuestions[index - 1], newQuestions[index]] = [newQuestions[index], newQuestions[index - 1]];
      return newQuestions;
    });
  };

  // 下移题目卡片
  const handleMoveQuestionDown = (questionId: number) => {
    setQuestions(prev => {
      const index = prev.findIndex(q => q.id === questionId);
      if (index < 0 || index >= prev.length - 1) return prev;
      const newQuestions = [...prev];
      [newQuestions[index], newQuestions[index + 1]] = [newQuestions[index + 1], newQuestions[index]];
      return newQuestions;
    });
  };

  // 点击答案标记
  const handleAnswerMarkerClick = (questionId: string) => {
    if (!questionId) return;
    
    const qId = parseInt(questionId);
    setHighlightedQuestionId(qId);
    
    const questionElement = document.getElementById(`question-card-${qId}`);
    if (questionElement && questionListRef.current) {
      questionListRef.current.scrollTo({
        top: questionElement.offsetTop - 10,
        behavior: 'smooth'
      });
    }
    
    setTimeout(() => {
      setHighlightedQuestionId(null);
    }, 3000);
  };

  // 点击右侧题号定位到左侧切图区的对应框
  const handleLocateBoxByQuestion = (question: Question) => {
    if (!question.boxId || !containerRef.current) return;

    // 找到对应的框
    const targetBox = questionBoxes.find(b => b.id === question.boxId);
    if (!targetBox) return;

    // 找到框所在的页面并滚动
    const pageEl = containerRef.current.querySelector(`[data-page="${targetBox.pageNumber}"]`) as HTMLElement;
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 高亮对应的框
    setTimeout(() => {
      const boxEl = containerRef.current?.querySelector(`[data-box-id="${targetBox.id}"]`) as HTMLElement;
      if (boxEl) {
        boxEl.classList.add('ring-4', 'ring-blue-400', 'ring-offset-2', 'ring-offset-white', 'z-50');
        boxEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        setTimeout(() => {
          boxEl.classList.remove('ring-4', 'ring-blue-400', 'ring-offset-2', 'ring-offset-white', 'z-50');
        }, 3000);
      }
    }, 300);
  };
  
  // 点击题号标签定位到对应题目
  const handleBoxLabelClick = (box: QuestionBox) => {
    // 使用 ref 获取最新的题目状态，避免闭包问题
    const currentQuestions = questionsRef.current;
    
    // 根据框类型找到对应的题目
    let targetQuestion: Question | undefined;
    
    if (box.type === 'question') {
      // 题目框：直接通过 boxId 找到对应题目
      targetQuestion = currentQuestions.find(q => q.boxId === box.id);
      console.log('[题号定位] 题目框, boxId:', box.id, 'questionNumber:', box.questionNumber, '找到题目:', targetQuestion ? `第${targetQuestion.number}题(id=${targetQuestion.id})` : '未找到');
    } else if (box.type === 'answer') {
      // 答案框：通过题号找到对应题目
      targetQuestion = currentQuestions.find(q => q.number === box.questionNumber);
      console.log('[题号定位] 答案框, questionNumber:', box.questionNumber, '找到题目:', targetQuestion ? `第${targetQuestion.number}题(id=${targetQuestion.id})` : '未找到');
    } else {
      // 未知类型：尝试通过 boxId 查找
      targetQuestion = currentQuestions.find(q => q.boxId === box.id);
      console.log('[题号定位] 未知类型框, boxId:', box.id, '找到题目:', targetQuestion ? `第${targetQuestion.number}题(id=${targetQuestion.id})` : '未找到');
    }
    
    if (!targetQuestion) {
      console.log('[题号定位] 未找到对应题目, 所有题目:', currentQuestions.map(q => ({ id: q.id, number: q.number, boxId: q.boxId })));
      return;
    }
    
    // 高亮目标题目
    setHighlightedQuestionId(targetQuestion.id);
    
    // 使用 requestAnimationFrame 确保 DOM 更新后再滚动
    requestAnimationFrame(() => {
      const questionElement = document.getElementById(`question-card-${targetQuestion!.id}`);
      if (questionElement) {
        // 使用 scrollIntoView 确保可靠滚动定位
        questionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.log('[题号定位] 滚动到题目卡片:', `question-card-${targetQuestion!.id}`);
      } else {
        console.log('[题号定位] 未找到DOM元素:', `question-card-${targetQuestion!.id}`);
      }
    });
    
    // 3秒后取消高亮
    setTimeout(() => {
      setHighlightedQuestionId(null);
    }, 3000);
  };

  // 关联答案
  const handleLinkAnswer = (answer: AnswerMarker, questionId: number) => {
    setAnswers(prev => prev.map(a =>
      a.id === answer.id ? { ...a, questionId: String(questionId), status: 'linked' } : a
    ));
    setQuestions(prev => prev.map(q =>
      q.id === questionId ? { ...q, answer: answer.content, analysis: answer.analysis, status: 'matched' } : q
    ));
  };

  // 加入试卷
  const handleAddToPaper = () => {
    if (questions.length === 0) return;
    if (workMode !== 'questions-only' && reviewStats.incompleteItemCount > 0) {
      setShowAddToPaperConfirm(true);
      return;
    }
    doAddToPaper();
  };

  const doAddToPaper = () => {
    saveDialogState();

    try {
      const paperData = {
        pageImages: pageImages.map(p => ({
          data: p.imageData,
          fileName: uploadedFiles[p.sourceFileIndex || 0]?.name || '',
          sourceFileIndex: p.sourceFileIndex || 0,
          pageNumber: p.pageNumber,
        })),
        questions: questions.map(q => ({
          id: String(q.id),
          number: q.number,
          questionType: q.questionType,
          content: q.content,
          answer: workMode === 'questions-only' ? '' : q.answer || '',
          analysis: workMode === 'questions-only' ? '' : q.analysis || '',
          knowledgePoints: [],
          difficulty: '容易',
          croppedImageData: q.userCroppedImageData || q.croppedImageData || '',
          originalCroppedImageData: q.croppedImageData || '',
          optionCount: q.optionCount,
          optionContents: q.optionContents || {},
          blankCount: q.blankCount,
          blankAnswers: workMode === 'questions-only' ? [] : q.blankAnswers || [],
          subQuestions: (q.subQuestions || []).map((sub, subIndex) => ({
            id: String(sub.id),
            number: `${q.number}.${subIndex + 1}`,
            questionType: sub.questionType,
            content: sub.content,
            answer: workMode === 'questions-only' ? '' : sub.answer || '',
            analysis: workMode === 'questions-only' ? '' : sub.analysis || '',
            optionCount: sub.optionCount,
            optionContents: sub.optionContents || {},
            blankCount: sub.blankCount || 1,
            blankAnswers: workMode === 'questions-only' ? [] : sub.blankAnswers || [],
          })),
        })),
        subjectInfo: subjectInfo || '',
      };
      sessionStorage.setItem('paperEditData', JSON.stringify(paperData));
    } catch (e) {
      console.error('[handleAddToPaper] sessionStorage 写入失败:', e);
    }
    onAddToPaper(questions);
  };

  // 加入试卷前校验并保存状态，以便「返回录题」时恢复
  const handleAddToPaperWithSave = () => {
    handleAddToPaper();
  };

  const isQuestionAnswerReviewMode = workMode === 'same-file' || workMode === 'cross-file';
  const questionCardReorderRequirementId = isQuestionAnswerReviewMode ? 'REVIEW_STEP-015' : 'REVIEW_STEP-013';
  const questionCardDeleteRequirementId = isQuestionAnswerReviewMode ? 'REVIEW_STEP-016' : 'REVIEW_STEP-014';
  const questionCardReorderAnchorId = isQuestionAnswerReviewMode
    ? 'review-step-question-reorder-stepwise'
    : 'review-step-question-reorder';
  const questionCardDeleteAnchorId = isQuestionAnswerReviewMode
    ? 'review-step-question-delete-stepwise'
    : 'review-step-question-delete';
  const questionCardReorderDisplayNumber = isQuestionAnswerReviewMode ? 11 : 3;
  const questionCardDeleteDisplayNumber = isQuestionAnswerReviewMode ? 12 : 4;
  const firstQuestionWithCardActionsId = questions[0]?.id;
  const firstQuestionWithTypeSelectorId = questions[0]?.id;
  const firstQuestionWithParentAnswerClearId = questions.find((question) => {
    const hasVisibleParentAnswerSection =
      workMode !== 'questions-only' &&
      (!(compoundQuestionTypes.includes(question.questionType) && (question.subQuestions || []).length > 0) ||
        getQuestionMatchInfo(question).needsManualSplit);

    return hasVisibleParentAnswerSection && hasParentAnswerClearContent(question);
  })?.id;
  const firstQuestionWithSubAnswerClearId = questions.find(
    (question) =>
      workMode !== 'questions-only' &&
      compoundQuestionTypes.includes(question.questionType) &&
      (question.subQuestions || []).length > 0 &&
      hasSubAnswerClearContent(question),
  )?.id;
  const firstQuestionWithImageId = questions.find(q => q.croppedImageData)?.id;
  const firstQuestionWithSubQuestionsId = questions.find(q =>
    compoundQuestionTypes.includes(q.questionType) && (q.subQuestions || []).length > 0
  )?.id;
  const isRecognitionFailure = processingMessage.includes('识别失败');

  return (
    <div
      className="fixed inset-y-0 left-0 bg-[#f0f4f7] z-50 flex flex-col"
      style={prdPanelOffsetStyle}
    >
      {/* Toast 提示 */}
      {toastMessage && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg transition-opacity">
          {toastMessage}
        </div>
      )}

      {/* ==================== 进度条 ==================== */}
      {(workMode || flowStep === 'select_mode' || flowStep === 'upload_files') && (
        <div
          data-req-anchor={flowStep === 'upload_files' ? 'upload-files-step.step-bar' : 'select-mode-step-bar'}
          className="relative bg-white border-b px-4 py-2"
        >
          {flowStep === 'upload_files'
            ? renderRequirementMarker('UPLOAD_FILES_STEP-001', 'right-2 top-1')
            : renderRequirementMarker('SELECT_MODE-007', 'right-2 top-1', 1)}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
            {(() => {
              const baseSteps = [
                { step: 'upload_files' as FlowStep, label: '上传资料', hint: '管理本次识别的资料文件' },
                { step: 'select_mode' as FlowStep, label: '选择识别方式', hint: '请根据资料内容选择识别方式' },
                { step: 'frame_and_review' as FlowStep, label: '选择识别内容', hint: '在左侧资料上选择要识别的内容' },
                { step: 'review' as FlowStep, label: '核对识别结果', hint: '核对并补充识别出的题目内容' },
              ];
              const steps = baseSteps;
              const currentStep = flowStep === 'manual_link' ? 'review' : flowStep;
              const currentStepIndex = steps.findIndex(s => s.step === currentStep);

              return (
                <div className="flex items-start gap-1">
                  {steps.map(({ step, label, hint }, idx) => {
                    const isCurrent = step === currentStep;
                    const isPast = currentStepIndex > idx;
                    const canClickBack = isPast && !isCurrent;

                    return (
                      <Fragment key={step}>
                        {idx > 1 && (
                          <ArrowRight className={cn("w-4 h-4 mt-2", isPast || isCurrent ? "text-emerald-500" : "text-gray-300")} />
                        )}
                        <div className="flex flex-col gap-0.5">
                          {idx === 0 ? (
                            isCurrent ? (
                              <>
                                <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white shadow-md shadow-emerald-200 ring-2 ring-emerald-300">
                                  <span className="flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                    1. {label}
                                  </span>
                                </span>
                                <span className="text-[10px] px-1 leading-tight text-gray-500">{hint}</span>
                              </>
                            ) : (
                              <>
                                <div className="relative inline-flex">
                                <button
                                  data-req-anchor="select-mode-back-btn"
                                  onClick={() => goToStep('upload_files')}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 cursor-pointer hover:bg-gray-200 active:scale-95 transition-all"
                                >
                                  <span className="flex items-center gap-1">
                                    <ArrowLeft className="w-3 h-3" />
                                    1. {label}
                                  </span>
                                </button>
                              </div>
                                <span className="text-[10px] px-1 leading-tight text-gray-400">{hint}</span>
                              </>
                            )
                          ) : (
                            <>
                              {canClickBack ? (
                                <button
                                  onClick={() => goToStep(step)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200 active:scale-95 transition-all"
                                >
                                  <span className="flex items-center gap-1">
                                    <Check className="w-3 h-3" />
                                    {idx + 1}. {label}
                                  </span>
                                </button>
                              ) : (
                                <span className={cn(
                                  "px-3 py-1.5 rounded-lg text-xs font-medium",
                                  isCurrent
                                    ? "bg-emerald-500 text-white shadow-md shadow-emerald-200 ring-2 ring-emerald-300"
                                    : "bg-gray-100 text-gray-400"
                                )}>
                                  <span className="flex items-center gap-1">
                                    {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                                    {idx + 1}. {label}
                                  </span>
                                </span>
                              )}
                              <span className={cn(
                                "text-[10px] px-1 leading-tight",
                                isCurrent ? "text-gray-500" : isPast ? "text-emerald-600" : "text-gray-400"
                              )}>{hint}</span>
                            </>
                          )}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              );
            })()}
            </div>
            <div className="flex shrink-0 items-center gap-3 pt-0.5">
<button onClick={() => setShowHelpDialog(true)} className="flex items-center gap-1 px-2 py-1 text-sm text-gray-500 hover:text-gray-700">
                <HelpCircle className="w-4 h-4" />操作说明
              </button>
              <div data-req-anchor="review-step-add-to-paper-btn" className="relative inline-flex">
                {isReviewStep && renderRequirementMarker('REVIEW_STEP-008', '-right-1 -top-1')}
                <button
                  onClick={handleAddToPaperWithSave}
                  disabled={questions.length === 0}
                  className={cn(
                    "px-3 py-1 rounded text-sm",
                    questions.length > 0 ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  )}
                >
                  加入试卷
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 模式选择面板（第一步）==================== */}
      {flowStep === 'select_mode' && (
        <div className="flex-1 overflow-auto p-6 flex flex-col items-center bg-[#f0f4f7]">
          <div className="max-w-6xl w-full flex flex-col h-full">

            <div data-req-anchor="select-mode-title" className="relative">
              <h2 className="text-lg font-medium text-gray-800 mb-2 text-center">请选择识别方式</h2>
              <p className="text-sm text-gray-500 mb-6 text-center">建议根据您的资料内容，选择合适的处理流程</p>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              {/* 仅识别题目 */}
              <div data-req-anchor="select-mode-single-btn" className="relative">
                {renderRequirementMarker('SELECT_MODE-002', 'right-2 top-2', 2)}
                <RecognitionModeCard
                  mode="questions-only"
                  icon={FileText}
                  title="仅识别题目"
                  scenario="适合只包含题目、不包含答案解析的资料"
                  visualType="question-only"
                  steps={['框选题目', 'OCR识别']}
                  accent="blue"
                  selected={workMode === 'questions-only'}
                  onSelect={handleModeSelect}
                />
              </div>

              {/* 题目+答案（同文件） */}
              <div data-req-anchor="select-mode-stepwise-btn" className="relative">
                {renderRequirementMarker('SELECT_MODE-003', 'right-2 top-2', 3)}
                <RecognitionModeCard
                  mode="same-file"
                  icon={Layers}
                  title="题目+答案"
                  badge="同文件"
                  scenario="适合题目与答案解析在同一份资料中的场景"
                  visualType="same-file"
                  steps={['自动框选', 'OCR识别']}
                  accent="purple"
                  selected={workMode === 'same-file'}
                  onSelect={handleModeSelect}
                />
              </div>

              {/* 题目+答案（不同文件） */}
              <div data-req-anchor="select-mode-cross-file-btn" className="relative">
                {renderRequirementMarker('SELECT_MODE-008', 'right-2 top-2', 4)}
                <RecognitionModeCard
                  mode="cross-file"
                  icon={Files}
                  title="题目+答案"
                  badge="不同文件"
                  scenario="适合题目文件与答案文件分别上传的场景"
                  visualType="cross-file"
                  steps={['分别识别', '自动关联']}
                  accent="amber"
                  selected={workMode === 'cross-file'}
                  disabled={(uploadedFiles?.length ?? 0) < 2}
                  disabledReason="该模式需要 2 个及以上文件"
                  onSelect={handleModeSelect}
                />
              </div>
            </div>

            {/* 已上传文件信息 */}
            {uploadedFiles && uploadedFiles.length > 0 && (
              <div data-req-anchor="select-mode-file-list" className="relative bg-gray-50 rounded-lg p-3 mt-3">
                {renderRequirementMarker('SELECT_MODE-004', 'right-1 top-1', 6)}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">已上传的资料：</span>
                  <button
                    onClick={() => goToStep('upload_files')}
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    更换资料
                  </button>
                </div>
                <div className="space-y-1">
                  {uploadedFiles.map((f, i) => {
                    const range = fileRanges?.[i];
                    const pages = range ? range.rangeEnd - range.rangeStart + 1 : null;
                    return (
                    <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span>{f.name}</span>
                      {pages !== null && (
                        <span className="text-xs text-gray-400">识别{pages}页</span>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 上传资料步骤（第一步）==================== */}
      {flowStep === 'upload_files' && (
        <div className="flex-1 overflow-auto p-8 flex justify-center bg-[#f0f4f7]">
          <div className="max-w-[640px] w-full mt-4">
            {/* 中央资料管理卡片 */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              {uploadedFiles && uploadedFiles.length > 0 ? (() => {
                // 24页限制校验（与 ImportDocumentDialog 逻辑一致）
                const totalOriginalPages = effectiveTotalPages?.reduce((sum, p) => sum + p, 0) || 0;
                const totalSelectedPages = fileRanges?.reduce((sum, r) => sum + (r.rangeEnd - r.rangeStart + 1), 0) || 0;
                const isOverLimit = totalOriginalPages > 24;
                const isSelectedOverLimit = totalSelectedPages > 24;
                const isPageLimitExceeded = isOverLimit && isSelectedOverLimit;

                return (
                /* ========== 有数据态 ========== */
                <div data-req-anchor="upload-files-step.file-list" className="relative p-6">
                  {renderRequirementMarker('UPLOAD_FILES_STEP-002', 'right-3 top-3')}
                  {/* 区块标题 */}
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-gray-800">已上传资料</h3>
                    <p className="text-xs text-gray-400 mt-1">
                      已上传 {uploadedFiles.length} 份文件，共{' '}
                      {totalSelectedPages} 页
                    </p>
                  </div>

                  {/* 文件列表 */}
                  <div className="mb-5">
                    {uploadedFiles.map((file, idx) => {
                      const range = fileRanges?.[idx];
                      const pageCount = range ? range.rangeEnd - range.rangeStart + 1 : null;
                      const totalPages = effectiveTotalPages?.[idx];
                      return (
                        <div key={idx} className="flex items-center justify-between p-3 hover:bg-gray-50">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                              <FileText className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-gray-700 truncate">{file.name}</div>
                              <div className="text-xs text-gray-500 flex items-center gap-2">
                                <span>{formatFileSize(file.size)}</span>
                                <span>·</span>
                                {pageCount !== null && totalPages ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingRangeIndex(idx);
                                      setEditRangeStart(range?.rangeStart ?? 1);
                                      setEditRangeEnd(range?.rangeEnd ?? 1);
                                    }}
                                    className="text-xs text-blue-600 font-medium hover:text-blue-800 hover:underline cursor-pointer"
                                  >
                                    识别{pageCount}页 / 共{totalPages}页
                                  </button>
                                ) : pageCount !== null ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingRangeIndex(idx);
                                      setEditRangeStart(range?.rangeStart ?? 1);
                                      setEditRangeEnd(range?.rangeEnd ?? 1);
                                    }}
                                    className="text-xs text-blue-600 font-medium hover:text-blue-800 hover:underline cursor-pointer"
                                  >
                                    识别{pageCount}页
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div
                            data-req-anchor={idx === 0 ? 'upload-files-step.file-delete' : undefined}
                            className="relative"
                          >
                            {idx === 0 && renderRequirementMarker('UPLOAD_FILES_STEP-003', 'right-0 -top-3')}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <button className="text-gray-400 hover:text-red-500">
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="max-w-sm">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>确认删除该文件？</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    将移除「{file.name}」，此操作不可撤销。
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>取消</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => onDeleteFile?.(idx)}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                  >
                                    确认删除
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 24页超限警告 */}
                  {isPageLimitExceeded && (
                    <div data-req-anchor="upload-files-step.page-limit" className="relative mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      {renderRequirementMarker('UPLOAD_FILES_STEP-006', 'right-2 top-2')}
                      <p className="text-xs text-amber-700 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>检测到文件共{totalOriginalPages}页，最多支持识别24页，请删除部分文件或自定义选择文件识别范围后，再继续操作</span>
                      </p>
                      <div className="flex justify-center mt-2">
                        <button
                          onClick={() => {
                            // 打开第一个文件的页码范围调整
                            setEditingRangeIndex(0);
                            const range = fileRanges?.[0];
                            setEditRangeStart(range?.rangeStart ?? 1);
                            setEditRangeEnd(range?.rangeEnd ?? 1);
                          }}
                          className="px-4 py-1.5 text-xs font-medium text-amber-700 border border-amber-400 rounded-lg hover:bg-amber-100 transition-colors"
                        >
                          选择识别范围
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 底部操作栏 */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <div data-req-anchor="upload-files-step.continue-upload" className="relative">
                      {renderRequirementMarker('UPLOAD_FILES_STEP-005', '-right-2 -top-3')}
                      <button
                        onClick={() => onContinueUpload?.()}
                        className="px-4 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
                      >
                        <CloudUpload className="w-4 h-4" /> 继续上传
                      </button>
                    </div>
                    <div data-req-anchor="upload-files-step.next" className="relative">
                      {renderRequirementMarker('UPLOAD_FILES_STEP-011', '-right-2 -top-3')}
                      <button
                        onClick={() => {
                          setFlowStep('select_mode');
                          setFlowStage('cutting');
                        }}
                        disabled={isPageLimitExceeded}
                        className={cn(
                          "px-5 py-2 text-sm rounded-lg transition-colors flex items-center gap-1.5 font-medium",
                          isPageLimitExceeded
                            ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                            : "bg-emerald-500 text-white hover:bg-emerald-600"
                        )}
                      >
                        下一步 <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
                );
              })() : (
                /* ========== 无数据态 ========== */
                <div data-req-anchor="upload-files-step.empty-upload" className="relative p-8 flex flex-col items-center">
                  {renderRequirementMarker('UPLOAD_FILES_STEP-004', 'right-3 top-3')}
                  {/* 上传图标 */}
                  <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
                    <CloudUpload className="w-8 h-8 text-gray-300" />
                  </div>

                  {/* 主提示文案 */}
                  <p className="text-sm font-medium text-gray-700 mb-1">请上传本次需要识别的资料文件</p>

                  {/* 辅助说明文案 */}
                  <p className="text-xs text-gray-400 mb-6">支持 PDF、JPG、PNG 等格式，单次上传最多识别 24 页内容</p>

                  {/* 上传区域（虚线框） */}
                  <button
                    onClick={() => onContinueUpload?.()}
                    className="w-full border-2 border-dashed border-gray-300 rounded-lg py-10 flex flex-col items-center justify-center hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors mb-4"
                  >
                    <CloudUpload className="w-8 h-8 text-gray-300 mb-2" />
                    <span className="text-sm text-gray-500">点击上传，或拖拽文件至此</span>
                  </button>

                  {/* 上传按钮 */}
                  <button
                    onClick={() => onContinueUpload?.()}
                    className="px-6 py-2 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors font-medium"
                  >
                    上传资料
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 页码范围调整弹窗 ==================== */}
      {editingRangeIndex !== null && (() => {
        const file = uploadedFiles?.[editingRangeIndex];
        const totalPages = effectiveTotalPages?.[editingRangeIndex] || 1;
        const selectedCount = editRangeEnd - editRangeStart + 1;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[65]" onClick={() => setEditingRangeIndex(null)}>
            <div
              data-req-anchor="upload-files-step.range-dialog"
              className="relative bg-white rounded-lg shadow-xl w-[520px] max-w-[90vw]"
              onClick={e => e.stopPropagation()}
            >
              {renderRequirementMarker('UPLOAD_FILES_STEP-007', 'right-2 top-2')}
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="font-medium text-gray-800">选择识别范围</h3>
                <button onClick={() => setEditingRangeIndex(null)} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-100">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <p className="text-xs text-gray-500">选择需要识别的页码范围：</p>

                <div className="p-3 rounded-lg border bg-blue-50 border-blue-300 ring-1 ring-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-sm text-gray-700 truncate">{file?.name || ''}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 flex-shrink-0">起始页~结束页：</span>
                    <select
                      value={editRangeStart}
                      onChange={(e) => setEditRangeStart(Number(e.target.value))}
                      className="px-2 py-1 text-xs border rounded focus:outline-none focus:border-emerald-500"
                    >
                      {Array.from({ length: totalPages }, (_, i) => (
                        <option key={i + 1} value={i + 1}>第{i + 1}页</option>
                      ))}
                    </select>
                    <select
                      value={Math.min(editRangeEnd, totalPages)}
                      onChange={(e) => setEditRangeEnd(Number(e.target.value))}
                      className="px-2 py-1 text-xs border rounded focus:outline-none focus:border-emerald-500"
                    >
                      {Array.from({ length: totalPages - editRangeStart + 1 }, (_, i) => {
                        const pageNum = editRangeStart + i;
                        return <option key={pageNum} value={pageNum}>第{pageNum}页</option>;
                      })}
                    </select>
                    <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                      识别{selectedCount}页 / 共{totalPages}页
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t px-4 py-3 bg-gray-50 rounded-b-lg flex justify-end gap-2">
                <button
                  onClick={() => setEditingRangeIndex(null)}
                  className="px-4 py-2 text-sm border rounded text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    onUpdateFileRange?.(editingRangeIndex, editRangeStart, editRangeEnd);
                    setEditingRangeIndex(null);
                  }}
                  className="px-4 py-2 text-sm rounded text-white bg-emerald-500 hover:bg-emerald-600"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ==================== 文件角色分配弹窗 ==================== */}
      {showFileRolePanel && (
        <div
          data-req-anchor="select-mode-file-role-dialog"
          className="fixed inset-y-0 left-0 bg-black/50 flex items-center justify-center z-[60]"
          style={prdPanelOffsetStyle}
        >
          <div className="relative bg-white rounded-lg shadow-xl w-[480px] max-w-[90vw]">
            {renderRequirementMarker('SELECT_MODE-005', 'right-2 top-2', 5)}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-emerald-50 rounded-t-lg">
              <h3 className="font-medium text-emerald-600">指定文件用途</h3>
              <button onClick={() => { setShowFileRolePanel(false); setWorkMode(null); setFileRolePanelFileIds(null); }} className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-600 mb-4">
                {fileRolePanelFileIds
                  ? `检测到您新增了 ${fileRolePanelFileIds.length} 个文件，请分别为新增文件指定用途：`
                  : `检测到您上传了 ${uploadedFiles?.length || 0} 个文件，请分别指定用途：`
                }
              </p>
              <div className="space-y-3">
                {fileRoles.map((role, idx) => {
                  // 如果设置了只显示特定文件，跳过不在列表里的文件
                  if (fileRolePanelFileIds && !fileRolePanelFileIds.includes(role.fileName)) return null;
                  return (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm text-gray-700 flex-1 truncate cursor-default">{role.fileName}</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-max break-all">
                        {role.fileName}
                      </TooltipContent>
                    </Tooltip>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setFileRoles(prev => prev.map((r, i) =>
                            i === idx ? { ...r, role: r.role === 'question' ? 'unassigned' as const : 'question' as const } : r
                          ));
                        }}
                        className={cn(
                          "px-3 py-1 text-xs rounded border transition-colors",
                          role.role === 'question'
                            ? "bg-emerald-500 text-white border-emerald-500"
                            : "bg-white text-gray-600 border-gray-300 hover:border-emerald-300"
                        )}
                      >
                        题目文件
                      </button>
                      <button
                        onClick={() => {
                          setFileRoles(prev => prev.map((r, i) =>
                            i === idx ? { ...r, role: r.role === 'answer' ? 'unassigned' as const : 'answer' as const } : r
                          ));
                        }}
                        className={cn(
                          "px-3 py-1 text-xs rounded border transition-colors",
                          role.role === 'answer'
                            ? "bg-emerald-500 text-white border-emerald-500"
                            : "bg-white text-gray-600 border-gray-300 hover:border-emerald-300"
                        )}
                      >
                        答案文件
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>

            </div>
            <div className="flex items-center justify-end gap-3 px-4 py-3 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={() => { setShowFileRolePanel(false); setWorkMode(null); setFileRolePanelFileIds(null); }}
                className="px-4 py-2 text-sm text-gray-600 rounded border border-gray-300 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleFileRoleConfirm}
                disabled={fileRoles.some(r => r.role === 'unassigned')}
                className={cn(
                  "px-4 py-2 text-sm rounded text-white",
                  fileRoles.some(r => r.role === 'unassigned') 
                    ? "bg-gray-300 cursor-not-allowed" 
                    : "bg-emerald-500 hover:bg-emerald-600"
                )}
              >
                确认，开始处理
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 主工作区（非 select_mode 时显示）==================== */}
      {flowStep !== 'select_mode' && flowStep !== 'upload_files' && (
      <>


      {/* 主内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：资料预览区 */}
        <div className="w-[46%] bg-gray-200 flex flex-col relative">
          {/* 继续上传后的切题提示 */}
          {isAutoDetecting && questionBoxes.length > 0 && (
            <div data-req-anchor="box-step-append-detect-tip" className="relative flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-xs text-blue-600">
              {renderRequirementMarker('BOX_STEP-008', 'right-2 top-1', 10)}
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>正在处理新文件...</span>
            </div>
          )}
          {/* 模式三（跨文件）：文件标签已移除，改为每页顶部标签显示 */}

          {/* ==================== 框选&识别页面：三层布局 ==================== */}
          {(isSelectionStep || isReviewStep) && (
            <>

              {/* 第一层：操作提示 + 统计信息 + 操作按钮 */}

              {/* 清空切题框确认弹窗 */}
              <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
                <AlertDialogContent className="max-w-sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认清空所有切题框？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将删除当前可见的 {totalBoxCount} 个切题框，此操作不可撤销。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleClearAllBoxes}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      确认清空
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* 返回模式选择确认弹窗 */}
              <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
                <AlertDialogContent className="max-w-sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>返回模式选择？</AlertDialogTitle>
                    <AlertDialogDescription>
                      返回模式选择将清空当前识别进度（包括框选和已识别的题目），是否继续？
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleConfirmReset}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      确认返回
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* 更换资料/识别方式 → 清空识别结果确认弹窗 */}
              <AlertDialog open={showClearRecognitionConfirm !== null} onOpenChange={() => setShowClearRecognitionConfirm(null)}>
                <AlertDialogContent className="max-w-sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {showClearRecognitionConfirm === 'modify_files' ? '确认更换资料吗？' : '确认修改识别方式吗？'}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {showClearRecognitionConfirm === 'modify_files'
                        ? '更换资料，将清空当前已识别的内容，并且需要重新选择识别方式。'
                        : '修改识别方式，将清空已有的识别内容。'
                      }
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        const action = showClearRecognitionConfirm;
                        setShowClearRecognitionConfirm(null);
                        // 清空识别结果
                        setQuestions([]);
                        setAnswers([]);
                        setQuestionBoxes([]);
                        setReviewHiddenBoxIds(new Set());
                        setFileRoles([]);
                        setWorkMode(null);
                        if (action === 'modify_files') {
                          goToStep('upload_files');
                        } else {
                          goToStep('select_mode');
                        }
                      }}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      确认
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* 加入试卷 — 未匹配答案解析确认弹窗 */}
              <AlertDialog open={showAddToPaperConfirm} onOpenChange={setShowAddToPaperConfirm}>
                <AlertDialogContent className="max-w-sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认加入试卷吗？</AlertDialogTitle>
                    <AlertDialogDescription>
                      当前还有{reviewStats.incompleteItemCount}道题的答案/解析没有补充，您可以在后续组卷页面使用AI批量补充功能，进行补充。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => {
                      setShowAddToPaperConfirm(false);
                      if (reviewStats.firstIncompleteQuestionId) {
                        const firstEl = document.querySelector(`[data-question-id="${reviewStats.firstIncompleteQuestionId}"]`) as HTMLElement | null;
                        firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }}>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setShowAddToPaperConfirm(false);
                        doAddToPaper();
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      确认
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

            </>
          )}

          {/* 第四步 - 手动关联答案提示 */}
          {(workMode === 'same-file' || workMode === 'cross-file') && isReviewStep && manualAnswerLinking && (
            <div className="px-4 py-2 bg-gray-50 border-b">
              <p className="text-xs text-emerald-600">
                {manualLinkTarget
                  ? `在左侧资料区框选内容，框选后将自动填入第${questions.find(q => q.id === manualLinkTarget.questionId)?.number ?? ''}题${manualLinkTarget.field === 'answer' ? '答案' : '解析'}`
                  : '在左侧资料区框选答案或解析区域，框选后将自动弹出关联题号弹窗'}
              </p>
            </div>
          )}

          {/* 资料预览区 - 多页滚动显示 */}
          <div data-req-anchor="box-step-selection-layer" className="relative min-h-0 flex-1 group/doc-area">
            {/* 右上角悬浮统计：已选中/已框选 */}
            {(isSelectionStep || isReviewStep) && (
              <div
                data-req-anchor={isSelectionStep ? 'box-step-selection-stats' : undefined}
                className="absolute top-3 right-3 z-40 flex items-center"
              >
                {isSelectionStep && renderRequirementMarker('BOX_STEP-001', '-left-2 -top-2', 2)}
                <div className="pointer-events-none rounded bg-black/70 px-3 py-1.5 text-xs text-white">
                  <span>已选中 <span className="font-medium">{selectedCount}</span> 题 / 已框选 <span className="font-medium">{totalBoxCount}</span> 题</span>
                </div>
              </div>
            )}
            {/* 右边缘悬浮球 — 中部：开始识别 / 清空 */}
            {showBoxStepFloatingActions && (
              <div className="absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2">
                <div data-req-anchor="box-step-start-btn" className="relative flex flex-col items-center gap-1">
                  {renderRequirementMarker('BOX_STEP-002', '-left-1 -top-1', 3)}
                  <button
                    onClick={handleBatchMove}
                    disabled={selectedCount === 0 || isProcessing || isAutoDetecting}
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all",
                      selectedCount > 0 && !isProcessing && !isAutoDetecting
                        ? "bg-emerald-500 text-white hover:bg-emerald-600 hover:scale-110"
                        : "bg-gray-300 text-gray-400 cursor-not-allowed"
                    )}
                    title={`开始识别(${selectedCount})`}
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleBatchMove}
                    disabled={selectedCount === 0 || isProcessing || isAutoDetecting}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight shadow-sm transition-colors",
                      selectedCount > 0 && !isProcessing && !isAutoDetecting
                        ? "border-emerald-100 bg-white text-emerald-700 hover:bg-emerald-50"
                        : "border-gray-200 bg-white text-gray-400 cursor-not-allowed"
                    )}
                    title={`开始识别(${selectedCount})`}
                  >
                    开始识别
                  </button>
                </div>
                {isSelectionStep && (
                  <div data-req-anchor="box-step-clear-action" className="relative flex flex-col items-center gap-2">
                    {renderRequirementMarker('BOX_STEP-014', '-left-1 -top-2', 6)}
                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { if (canOperateBoxes) setShowClearConfirm(true); }}
                        disabled={!canOperateBoxes}
                        className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center border shadow-md transition-colors",
                          canOperateBoxes
                            ? "border-red-200 bg-white text-red-400 hover:bg-red-50 hover:border-red-400 hover:text-red-500"
                            : "border-gray-200 bg-white text-gray-300 cursor-not-allowed"
                        )}
                        title="清空全部框选"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (canOperateBoxes) setShowClearConfirm(true); }}
                        disabled={!canOperateBoxes}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight shadow-sm transition-colors",
                          canOperateBoxes
                            ? "border-red-100 bg-white text-red-500 hover:bg-red-50"
                            : "border-gray-200 bg-white text-gray-400 cursor-not-allowed"
                        )}
                        title="清空全部框选"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* 右边缘悬浮球 — 右下角：更多工具 */}
            {showBoxStepFloatingActions && isSelectionStep && (
              <div data-req-anchor="box-step-more-tools" className="absolute right-3 bottom-4 z-30 flex flex-col items-center gap-1">
                {renderRequirementMarker('BOX_STEP-013', '-left-1 -top-2', 7)}
                {moreToolsOpen && (
                  <div className="mb-1 flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                    <div data-req-anchor="box-step-modify-files" className="relative">
                      {renderRequirementMarker('BOX_STEP-012', 'right-0 -top-2', 12)}
                      <button
                        onClick={() => {
                          setMoreToolsOpen(false);
                          if (questions.length > 0) {
                            setShowClearRecognitionConfirm('modify_files');
                          } else {
                            goToStep('upload_files');
                          }
                        }}
                        className="flex w-full items-center gap-1.5 rounded px-3 py-2 text-xs whitespace-nowrap text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        更换资料
                      </button>
                    </div>
                    {onSupplementUpload && (
                      <div data-req-anchor="box-step-supplement-upload" className="relative">
                        {renderRequirementMarker('BOX_STEP-005', 'right-0 -top-2', 8)}
                        <button
                          onClick={() => {
                            if (isAutoDetecting) {
                              setProcessingMessage('正在处理文件，请稍后再补充资料');
                              setTimeout(() => setProcessingMessage(''), 3000);
                              return;
                            }
                            setMoreToolsOpen(false);
                            onSupplementUpload();
                          }}
                          className="flex w-full items-center gap-1.5 rounded px-3 py-2 text-xs whitespace-nowrap text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-800"
                        >
                          <CloudUpload className="w-3.5 h-3.5" />
                          补充资料
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setMoreToolsOpen((open) => !open)}
                  className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center border shadow-md transition-colors",
                    moreToolsOpen
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-emerald-100 bg-white text-emerald-600 hover:bg-emerald-50"
                  )}
                  title="更多工具"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <span className="rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-medium leading-tight text-emerald-700 shadow-sm">
                  更多工具
                </span>
              </div>
            )}
            {(isSelectionStep || isReviewStep) && renderRequirementMarker('BOX_STEP-010', 'left-2 top-2 z-50', 1)}
            <div
              ref={containerRef}
              className="h-full overflow-auto p-4 flex flex-col items-center gap-4"
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {isPagesLoading ? (
                <div className="flex items-center justify-center h-96">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                </div>
              ) : isAutoDetecting ? (
                /* 腾讯云切题进行中 */
                <div className="flex flex-col items-center justify-center h-96 gap-4">
                  <div className="relative">
                    <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                    <div className="absolute inset-0 w-10 h-10 rounded-full border-4 border-emerald-200 animate-ping opacity-30" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-emerald-700">{autoDetectProgress || '正在智能切题...'}</p>
                    <p className="text-xs text-gray-400 mt-1">AI 正在分析每页内容，自动框选题目区域</p>
                  </div>
                </div>
              ) : (
                pageOrder.map((originalIndex) => {
                const pageImage = pageImages[originalIndex];
                const pageNum = originalIndex + 1;
                const pageBoxes = visibleQuestionBoxes.filter(box =>
                  (box.pageNumber === pageNum ||
                  (box.endPageNumber === pageNum && box.endPageHeight)) // 跨页框的第二部分
                );
                const pageAnswers = answers.filter(a => a.pageNumber === pageNum);
                const pageRole = getPageFileRole(pageImage);
                const canDrawCurrentPage = canDrawOnPage(pageNum);

                return (
                  <div
                    key={pageNum}
                    data-page={pageNum}
                    className={cn("relative bg-white shadow-lg", !canDrawCurrentPage && "cursor-not-allowed")}
                    style={{
                      width: displayWidth,
                      transform: `scale(${zoom / 100})`,
                      transformOrigin: 'top center'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, pageNum)}
                  >
                    {/* 模式三：页面文件角色标签 */}
                    {pageRole && (
                      <div className={cn(
                        "absolute top-0 left-1/2 -translate-x-1/2 text-xs px-3 py-1 rounded-b z-40 font-medium",
                        pageRole === '题目' ? "bg-blue-500 text-white" : "bg-amber-500 text-white"
                      )}>
                        {pageRole}
                      </div>
                    )}
                    {/* 页码标识 */}
                    {totalPages > 1 && (
                      <div className="absolute top-0 left-0 bg-gray-800 text-white text-xs px-2 py-1 rounded-br z-30">
                        第 {pageImage.sourcePageNumber || pageNum} 页
                      </div>
                    )}
                    
                    {/* 页面图片渲染 - 统一使用 pageImages（已将所有文件转换为 base64 图片） */}
                    {pageImages[pageNum - 1] && (
                      <img 
                        src={pageImages[pageNum - 1].imageData} 
                        alt={`第 ${pageNum} 页`} 
                        style={{ width: displayWidth, height: 'auto', display: 'block' }} 
                        draggable={false} 
                      />
                    )}

                    {!canDrawCurrentPage && (
                      <div className="absolute inset-0 z-20 cursor-not-allowed bg-amber-50/10" />
                    )}

                    {/* 题目框 - 切图阶段显示可编辑框（识别题目阶段） */}
                    {(isSelectionStep || isReviewStep) && pageBoxes.map((box) => {
                      const renderStyle = getBoxRenderStyle(box, pageNum);
                      if (!renderStyle) return null;
                      const isRecognizingBox = isBoxRecognizing(box.id);
                      const isStartPage = !renderStyle.isCrossPagePart || box.pageNumber === pageNum;
                      const questionNumberLabel = getBoxQuestionNumberLabel(box);
                      return (
                      <div
                        key={`${box.id}-${pageNum}`}
                        className={cn(
                          "question-box absolute transition-colors",
                          getBoxBorderClassName(box),
                          isRecognizingBox && "cursor-not-allowed"
                        )}
                        style={{
                          left: renderStyle.left,
                          top: renderStyle.top,
                          width: renderStyle.width,
                          height: renderStyle.height,
                          borderWidth: '2px',
                          borderStyle: 'solid',
                          backgroundColor: getBoxBackgroundColor(box),
                        }}
                      >
                        {isStartPage && questionNumberLabel && (
                          <span className={cn(
                            "absolute left-1 top-1 z-10 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none shadow-sm",
                            getBoxNumberLabelClassName(box)
                          )}>
                            {questionNumberLabel}
                          </span>
                        )}
                        {/* 只在起始页部分显示选中/删除/调整手柄 */}
                        {isStartPage ? (
                          <>
                            {/* 左上角行：勾选按钮 + 类型标签 */}
                            <div className="absolute -top-2 -left-2 flex items-center gap-1 z-20">
                              {/* 勾选按钮 */}
                              <div
                                className={cn(
                                  "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                                  isRecognizingBox
                                    ? "cursor-not-allowed bg-blue-50 border-2 border-blue-300"
                                    : box.isSelected
                                      ? "cursor-pointer bg-emerald-500"
                                      : "cursor-pointer bg-white border-2 border-gray-400"
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isRecognizingBox) handleToggleBox(box.id);
                                }}
                              >
                                {box.isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                            </div>

                            {/* 移动区域 */}
                            <div
                              className={cn("absolute inset-0", isRecognizingBox ? "cursor-not-allowed" : "cursor-move")}
                              onMouseDown={(e) => {
                                if (isRecognizingBox) {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  return;
                                }
                                handleMoveStart(e, box.id);
                              }}
                            />

                            {/* 上边缘右侧：待识别标签 + 删除按钮 */}
                            <div className="absolute -top-2 -right-2 flex items-center gap-1 z-20">
                              {/* 状态标签 */}
                              <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shadow-sm flex items-center gap-1", getBoxStatusClassName(box))}>
                                {isRecognizingBox && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                {getBoxStatusLabel(box)}
                              </span>
                              {/* 删除按钮 */}
                              {!isRecognizingBox && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteBox(box.id); }}
                                  className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
                                >
                                  <X className="w-3 h-3 text-white" />
                                </button>
                              )}
                            </div>

                            {/* 调整大小手柄 */}
                            {!isRecognizingBox && (
                              <>
                                <div className="resize-handle absolute -top-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-nw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'nw')} />
                                <div className="resize-handle absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-ne-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'ne')} />
                                <div className="resize-handle absolute -bottom-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-sw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'sw')} />
                                <div className="resize-handle absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-se-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'se')} />
                              </>
                            )}
                          </>
                        ) : (
                          /* 跨页第二部分：只显示移动区域 */
                          <div
                            className={cn("absolute inset-0", isRecognizingBox ? "cursor-not-allowed" : "cursor-move")}
                            onMouseDown={(e) => {
                              if (isRecognizingBox) {
                                e.stopPropagation();
                                e.preventDefault();
                                return;
                              }
                              handleMoveStart(e, box.id);
                            }}
                          />
                        )}
                        {/* 跨页框连接指示器 */}
                        {renderStyle.isCrossPagePart && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] text-emerald-500 bg-emerald-50 px-1 rounded border border-emerald-200 whitespace-nowrap z-20">
                            {box.pageNumber === pageNum ? '↓ 跨页' : '跨页续 ↑'}
                          </div>
                        )}
                      </div>
                      );
                    })}

                    {/* 题目框 - review阶段无识别结果时显示 */}
                    {flowStep === 'manual_link' && questions.length === 0 && pageBoxes.map((box) => {
                      const renderStyle = getBoxRenderStyle(box, pageNum);
                      if (!renderStyle) return null;
                      const isRecognized = box.recognized;
                      const isQuestion = box.type === 'question';
                      const isAnswer = box.type === 'answer';
                      const isStartPage = box.pageNumber === pageNum;
                      const isRecognizingBox = isBoxRecognizing(box.id);
                      const questionNumberLabel = getBoxQuestionNumberLabel(box);
                      
                      // 已识别的框：支持移动/调整大小 + 点击题号标签定位
                      if (isRecognized) {
                        return (
                          <div
                            key={`${box.id}-${pageNum}`}
                            data-box-id={box.id}
                            className={cn(
                              "recognized-box group absolute cursor-pointer hover:ring-2 hover:ring-emerald-400",
                              "border-emerald-500 bg-emerald-100/30"
                            )}
                            style={{
                              left: renderStyle.left,
                              top: renderStyle.top,
                              width: renderStyle.width,
                              height: renderStyle.height,
                              borderWidth: '2px', 
                              borderStyle: 'solid',
                            }}
                          >
                            {/* 题号标签 + 类型标签 + 勾选/删除 - 只在起始页显示 */}
                            {isStartPage && (
                              <>
                                <div
                                  className={cn(
                                    "absolute -top-2 -left-2 z-20 whitespace-nowrap flex items-center gap-1",
                                  )}
                                >
                                  {/* 已识别：勾选按钮 + 题号标签 + 可点击类型标签 */}
                                  {isRecognized ? (
                                    <>
                                      {/* 勾选按钮 - 支持选中后重新识别题目 */}
                                      <div
                                        className={cn("w-5 h-5 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0", box.isSelected ? "bg-emerald-500" : "bg-white border-2 border-emerald-500")}
                                        onClick={(e) => { e.stopPropagation(); handleToggleBox(box.id); }}
                                        title="勾选后可重新识别题目"
                                      >
                                        {box.isSelected && <Check className="w-3 h-3 text-white" />}
                                      </div>
                                      <div
                                        className={cn(
                                          "px-2.5 py-1 rounded text-xs font-medium cursor-pointer hover:opacity-80 active:opacity-60 flex items-center gap-1",
                                          "bg-emerald-500 text-white"
                                        )}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleBoxLabelClick(box);
                                        }}
                                        title="点击定位到对应题目"
                                      >
                                        {isQuestion && questionNumberLabel}
                                        {isAnswer && (questionNumberLabel === '未识别到题号' ? questionNumberLabel : `${questionNumberLabel}答案`)}
                                        {box.type === 'full' && questionNumberLabel}
                                      </div>
                                    </>
                                  ) : (
                                    /* 未识别：勾选按钮 + 类型标签（一步模式显示，分步模式隐藏） */
                                    <>
                                      <div
                                        className={cn("w-5 h-5 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0", box.isSelected ? "bg-emerald-500" : "bg-white border-2 border-gray-400")}
                                        onClick={(e) => { e.stopPropagation(); handleToggleBox(box.id); }}
                                      >
                                        {box.isSelected && <Check className="w-3 h-3 text-white" />}
                                      </div>
                                      {workMode !== 'same-file' && (
                                        <span
                                          className="px-1.5 py-0.5 rounded text-[11px] font-medium cursor-pointer hover:scale-105 hover:shadow-md transition-all whitespace-nowrap"
                                          style={{
                                            backgroundColor: box.type === 'answer' ? '#14b8a6' : box.type === 'full' ? '#10b981' : '#059669',
                                            color: 'white',
                                          }}
                                          onClick={(e) => { e.stopPropagation(); handleEditBoxType(box.id); }}
                                          title={`当前：${box.type === 'answer' ? '仅答案解析' : box.type === 'full' ? '题干+答案解析' : '仅题干'}，点击修改`}
                                        >
                                          {box.type === 'answer' ? '答案' : box.type === 'full' ? '完整' : '题干'}
                                          <span className="ml-0.5 text-[9px] opacity-70">✎</span>
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                                {/* 删除按钮 - 右上角（所有状态都支持） */}
                                <div className="absolute -top-2 -right-2 flex flex-col items-center gap-1 z-20">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteBox(box.id); }}
                                    className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
                                    title="删除此框"
                                  >
                                    <X className="w-3 h-3 text-white" />
                                  </button>
                                </div>
                              </>
                            )}
                            {/* 移动区域 */}
                            <div className="absolute inset-0 cursor-move" onMouseDown={(e) => handleMoveStart(e, box.id)} />
                            
                            {/* 调整大小手柄 - 只在起始页显示 */}
                            {isStartPage && (
                              <>
                                <div className="resize-handle absolute -top-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-nw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'nw')} />
                                <div className="resize-handle absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-ne-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'ne')} />
                                <div className="resize-handle absolute -bottom-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-sw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'sw')} />
                                <div className="resize-handle absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-se-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'se')} />
                              </>
                            )}
                            
                            {/* 跨页框连接指示器 */}
                            {renderStyle.isCrossPagePart && (
                              <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] text-emerald-500 bg-emerald-50 px-1 rounded border border-emerald-200 whitespace-nowrap z-20">
                                {isStartPage ? '↓ 跨页' : '跨页续 ↑'}
                              </div>
                            )}

                          </div>
                        );
                      }
                      
                      // 未识别的框：可编辑
                      return (
                        <div
                          key={`${box.id}-${pageNum}`}
                          className={cn(
                            "question-box absolute transition-colors",
                            getBoxBorderClassName(box),
                            isRecognizingBox && "cursor-not-allowed"
                          )}
                          style={{
                            left: renderStyle.left,
                            top: renderStyle.top,
                            width: renderStyle.width,
                            height: renderStyle.height,
                            borderWidth: '2px',
                            borderStyle: 'solid',
                            backgroundColor: getBoxBackgroundColor(box),
                          }}
                        >
                          {isStartPage && questionNumberLabel && (
                            <span className={cn(
                              "absolute left-1 top-1 z-10 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none shadow-sm",
                              getBoxNumberLabelClassName(box)
                            )}>
                              {questionNumberLabel}
                            </span>
                          )}
                          {/* 只在起始页部分显示操作按钮 */}
                          {isStartPage ? (
                            <>
                              {/* 左上角行：勾选按钮 + 类型标签 */}
                              <div className="absolute -top-2 -left-2 flex items-center gap-1 z-20">
                                {/* 勾选按钮 */}
                                <div
                                  className={cn(
                                    "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                                    isRecognizingBox
                                      ? "cursor-not-allowed bg-blue-50 border-2 border-blue-300"
                                      : box.isSelected
                                        ? "cursor-pointer bg-emerald-500"
                                        : "cursor-pointer bg-white border-2 border-gray-400"
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isRecognizingBox) handleToggleBox(box.id);
                                  }}
                                >
                                  {box.isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                              </div>

                              {/* 移动区域 */}
                              <div
                                className={cn("absolute inset-0", isRecognizingBox ? "cursor-not-allowed" : "cursor-move")}
                                onMouseDown={(e) => {
                                  if (isRecognizingBox) {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    return;
                                  }
                                  handleMoveStart(e, box.id);
                                }}
                              />

                              {/* 上边缘居中：待识别标签 + 删除按钮 */}
                              <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 z-20">
                                {/* 状态标签 */}
                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shadow-sm flex items-center gap-1", getBoxStatusClassName(box))}>
                                  {isRecognizingBox && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                  {getBoxStatusLabel(box)}
                                </span>
                                {/* 删除按钮 */}
                                {!isRecognizingBox && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteBox(box.id); }}
                                    className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
                                  >
                                    <X className="w-3 h-3 text-white" />
                                  </button>
                                )}
                              </div>

                              {/* 调整大小手柄 */}
                              {!isRecognizingBox && (
                                <>
                                  <div className="resize-handle absolute -top-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-nw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'nw')} />
                                  <div className="resize-handle absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-ne-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'ne')} />
                                  <div className="resize-handle absolute -bottom-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-sw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'sw')} />
                                  <div className="resize-handle absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-se-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'se')} />
                                </>
                              )}
                            </>
                          ) : (
                            /* 跨页第二部分：只显示移动区域 */
                            <div
                              className={cn("absolute inset-0", isRecognizingBox ? "cursor-not-allowed" : "cursor-move")}
                              onMouseDown={(e) => {
                                if (isRecognizingBox) {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  return;
                                }
                                handleMoveStart(e, box.id);
                              }}
                            />
                          )}

                          {/* 跨页框连接指示器 */}
                          {renderStyle.isCrossPagePart && !isStartPage && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] text-emerald-500 bg-emerald-50 px-1 rounded border border-emerald-200 whitespace-nowrap z-20">
                              跨页续 ↑
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* 正在画的框 - 起始页部分 */}
                    {isDrawing && currentBox && currentBox.pageNumber === pageNum && (
                      <div
                        className="absolute border-2 border-dashed border-emerald-500 bg-emerald-500/10"
                        style={{ left: currentBox.x, top: currentBox.y, width: currentBox.width, height: currentBox.height }}
                      />
                    )}
                    {/* 正在画的框 - 跨页的第二部分 */}
                    {isDrawing && currentBox && currentBox.endPageNumber === pageNum && currentBox.endPageHeight && (
                      <div
                        className="absolute border-2 border-dashed border-emerald-500 bg-emerald-500/10"
                        style={{ left: currentBox.x, top: currentBox.endPageY || 0, width: currentBox.width, height: currentBox.endPageHeight }}
                      />
                    )}

                    {/* 答案标记（检查阶段显示） */}
                    {((manualAnswerLinking && isReviewStep) || (workMode === 'questions-only' && flowStep === 'review' && flowStage === 'matched')) && pageAnswers.map((answer) => {
                      // 根据questionId找到对应的题目，获取题号
                      const linkedQuestion = answer.questionId ? questions.find(q => q.id === parseInt(answer.questionId as string)) : null;
                      
                      return (
                        <div
                          key={answer.id}
                          className={cn(
                            "answer-marker absolute border-2 rounded p-1 text-xs cursor-pointer transition-all hover:shadow-md",
                            answer.status === 'linked' ? "border-emerald-500 bg-emerald-100/80 hover:bg-emerald-200/80" : "border-orange-400 bg-orange-100/80 hover:bg-orange-200/80"
                          )}
                          style={{ left: answer.x, top: answer.y, width: answer.width, height: answer.height }}
                          onClick={() => answer.questionId && handleAnswerMarkerClick(answer.questionId)}
                        >
                          <div className="flex items-center gap-1">
                            {answer.status === 'linked' && linkedQuestion ? (
                              <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-600 font-medium">第{linkedQuestion.number}题答案</span></>
                            ) : (
                              <><AlertCircle className="w-3 h-3 text-orange-500" /><span className="text-orange-600 font-medium">未关联</span></>
                            )}
                            {answer.confidence && answer.confidence < 0.7 && (
                              <span className="text-xs text-yellow-600">⚠️</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
                }))}
            </div>
          </div>

          {/* 缩放控制 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white rounded-lg shadow px-3 py-1.5">
            <button onClick={() => setZoom(Math.max(50, zoom - 10))} className="p-1 hover:bg-gray-100 rounded"><ZoomOut className="w-4 h-4 text-gray-600" /></button>
            <span className="text-xs text-gray-600 w-12 text-center">{zoom}%</span>
            <button onClick={() => setZoom(Math.min(150, zoom + 10))} className="p-1 hover:bg-gray-100 rounded"><ZoomIn className="w-4 h-4 text-gray-600" /></button>
          </div>
        </div>

        {/* 右侧：题目卡片区 */}
        <div className="w-[54%] bg-[#f0f4f7] flex flex-col border-l">
          {/* ====== 增量识别进度条（有已有题目时，不遮挡内容）====== */}
          {batchProcessing && questions.length > 0 && (
            <div data-req-anchor="box-step-incremental-progress" className={cn(
              "relative",
              "px-4 py-2 border-b flex items-center gap-3",
              isRecognitionFailure ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"
            )}>
              {renderRequirementMarker('BOX_STEP-011', 'right-1 top-1', 11)}
              {isRecognitionFailure ? (
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              ) : (
                <Loader2 className="w-4 h-4 text-emerald-500 flex-shrink-0 animate-spin" />
              )}
              <span className={cn(
                "text-xs flex-1",
                isRecognitionFailure ? "text-red-700" : "text-emerald-700"
              )}>
                {processingMessage || '正在处理中...'}
              </span>
              <div data-req-anchor="box-step-pause-cancel-btn" className="relative flex items-center gap-1.5">
                {renderRequirementMarker('BOX_STEP-007', 'right-0 -top-1', 5)}
                <button onClick={handleCancelRecognition} className="px-2.5 py-0.5 text-[11px] font-medium rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors">取消识别</button>
              </div>
            </div>
          )}
          {/* ====== 首次识别：全屏加载状态 ====== */}
          {batchProcessing && questions.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden">
              <div
                data-req-anchor={isRecognitionFailure ? 'review-step-error-fallback' : undefined}
                className={cn(
                  "relative border rounded-lg p-6 max-w-md w-full flex flex-col items-center gap-3",
                  isRecognitionFailure ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"
                )}
              >
                {isRecognitionFailure && renderRequirementMarker('REVIEW_STEP-009', 'right-2 top-2')}
                {isRecognitionFailure ? (
                  <AlertCircle className="w-6 h-6 text-red-500" />
                ) : (
                  <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                )}
                <p className={cn("text-sm font-medium text-center", isRecognitionFailure ? "text-red-700" : "text-emerald-800")}>
                  {processingMessage || '正在处理中...'}
                </p>
                <div data-req-anchor="box-step-pause-cancel-btn" className="relative flex items-center gap-2 mt-1">
                  {renderRequirementMarker('BOX_STEP-007', 'right-1 top-0', 5)}
                  <button onClick={handleCancelRecognition} className="px-4 py-1.5 text-xs font-medium rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors">取消识别</button>
                </div>
              </div>
            </div>
          ) : (isSelectionStep && !isProcessing) ? (
            /* ====== 空状态引导（识别题目阶段）====== */
            <div data-req-anchor="box-step-empty-state" className="relative flex-1 flex flex-col items-center justify-center p-6 overflow-hidden">
              {renderRequirementMarker('BOX_STEP-003', 'right-2 top-2', 4)}
              <div className="border rounded-lg p-4 max-w-md w-full bg-emerald-50 border-emerald-200">
                <p className="text-sm font-medium text-emerald-800">
                  {workMode === 'cross-file'
                    ? '框选题目文件中的题目区域并选中后，点击「开始识别」，小乐会为您自动识别题目，并从答案文件中匹配对应的答案与解析。完成匹配后，您可在右侧以图片或文字的形式查看每道题'
                    : workMode === 'same-file'
                      ? '框选题目并选中后，点击「开始识别」，小乐会为您自动识别题目，并进行题目和答案的自动匹配。完成识别后，您可在右侧以图片或文字的形式分模块查看每道题的题干与答案/解析'
                      : '框选题目并选中后，点击「开始识别」，小乐会自动为您识别题目，完成识别后，您可在右侧以图片或文字的形式分模块查看每道题目'
                  }
                </p>
              </div>

              {/* 已选择数量提示 */}
              {selectedCount > 0 && (
                <div className="mt-4 text-sm text-gray-600 bg-white px-4 py-2 rounded-lg shadow-sm">
                  已选中 <span className="font-medium text-emerald-600">{selectedCount}</span> 个识别框
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 模式切换 */}
              <div className="relative flex items-center justify-between px-4 py-2 border-b bg-white">
                <div className="flex items-center gap-2">
                  <span data-req-anchor="review-step-view-mode" className="relative inline-flex">
                    {renderRequirementMarker('REVIEW_STEP-006', 'right-0 -top-2', 1)}
                    <button onClick={() => handleModeChange('image')} className={cn("px-3 py-1 rounded text-sm", viewMode === 'image' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600')}>图片模式</button>
                  </span>
                  <button onClick={() => handleModeChange('recognize')} className={cn("px-3 py-1 rounded text-sm", viewMode === 'recognize' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600')}>编辑模式</button>
                </div>
                {viewMode === 'recognize' && <span className="text-xs text-orange-500 bg-orange-50 px-2 py-0.5 rounded">请注意甄别AI识别内容</span>}
              </div>

              {/* 匹配结果提示（第四步显示） */}
              {(workMode === 'same-file' || workMode === 'cross-file') && flowStep === 'review' && (
                <div className="relative px-4 py-2 bg-orange-50 border-b border-orange-200">
                  {!matchBannerCollapsed ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span data-req-anchor="review-step-match-banner" className="relative inline-flex flex-shrink-0">
                          {renderRequirementMarker('REVIEW_STEP-001', 'right-0 -top-3')}
                          <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
                        </span>
                        <span className="text-xs text-orange-700">
                          请检查题目与答案匹配情况：共 <span className="font-medium">{reviewStats.parentCount}</span> 道题目，已匹配答案 <span className="font-medium text-emerald-600">{reviewStats.matchedAnswerCount}</span> 题，待匹配答案 <span className="font-medium text-orange-500">{reviewStats.pendingAnswerCount}</span> 题
                          {reviewStats.pendingSubCount > 0 && (
                            <>，待补子题 <span className="font-medium text-orange-500">{reviewStats.pendingSubCount}</span> 个</>
                          )}
                          <span className="text-orange-600">（待匹配答案的题目，可在左侧框选答案/解析手动关联题目）</span>
                        </span>
                      </div>
                      <button
                        onClick={() => setMatchBannerCollapsed(true)}
                        className="p-0.5 hover:bg-orange-100 rounded text-orange-400 hover:text-orange-600 flex-shrink-0"
                        title="收起"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setMatchBannerCollapsed(false)}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-700"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      <span>共 {reviewStats.parentCount} 道题目，已匹配 {reviewStats.matchedAnswerCount} 题，待匹配 {reviewStats.pendingAnswerCount} 题{reviewStats.pendingSubCount > 0 ? `，待补子题 ${reviewStats.pendingSubCount} 个` : ''}</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {/* 题目列表 */}
              <div
                ref={questionListRef}
                className="flex-1 overflow-y-auto p-3 relative"
              >
                {isModeChanging && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                    <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                  </div>
                )}
                
                <div className="space-y-3">
                  {questions.map((question, questionIndex) => (
                    <div
                      key={question.id}
                      id={`question-card-${question.id}`}
                      data-question-id={question.id}
                      className={cn(
                        "relative bg-white rounded-lg shadow-sm overflow-hidden transition-all",
                        highlightedQuestionId === question.id && "ring-2 ring-blue-500 shadow-md",
                        highlightedQuestionIds.has(question.id) && "ring-2 ring-yellow-400 bg-yellow-50",
                        reRecognizingIds.has(question.id) && "opacity-40 pointer-events-none",
                        flashNewIds.has(question.id) && "ring-2 ring-emerald-400 shadow-lg shadow-emerald-200 animate-pulse",
                        flashUpdateIds.has(question.id) && "ring-2 ring-blue-400 shadow-lg shadow-blue-200 animate-pulse"
                      )}
                    >
                      {reRecognizingIds.has(question.id) && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/30">
                          <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500 flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />识别中...
                          </span>
                        </div>
                      )}
                      {/* 题目头部 */}
                      <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                        <div className="flex items-center gap-2">
                          {/* 可编辑的题号 / 未关联答案标签 */}
                          <span
                            data-req-anchor={
                              questionIndex === 0
                                ? workMode === 'questions-only'
                                  ? 'review-step-question-card-single'
                                  : 'review-step-question-card-stepwise'
                                : undefined
                            }
                            className={cn(
                              'relative inline-flex items-center',
                              questionIndex === 0 && 'pl-8',
                            )}
                          >
                            {questionIndex === 0 &&
                              renderRequirementMarker(
                                workMode === 'questions-only' ? 'REVIEW_STEP-002' : 'REVIEW_STEP-003',
                                'left-0 -top-2',
                              )}
                            {question.number < 0 ? (
                              <span className="text-sm font-medium text-orange-600">未关联答案</span>
                            ) : editingQuestionId === question.id ? (
                              <input
                                type="number"
                                className="w-12 px-1 py-0.5 text-sm font-medium border border-blue-500 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                                value={question.number}
                                min={1}
                                autoFocus
                                onChange={(e) => {
                                  const newNumber = parseInt(e.target.value) || 1;
                                  handleUpdateNumber(question.id, newNumber);
                                }}
                                onBlur={() => setEditingQuestionId(null)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    setEditingQuestionId(null);
                                  }
                                }}
                              />
                            ) : (
                              <span 
                                className="text-sm font-medium cursor-pointer hover:text-blue-600 hover:underline"
                                onClick={() => handleLocateBoxByQuestion(question)}
                                onDoubleClick={() => setEditingQuestionId(question.id)}
                                title="点击定位到切图区域，双击编辑题号"
                              >
                                第 {question.number} 题
                              </span>
                            )}
                          </span>
                          {/* 答案匹配失败提示 */}
                          {answerMatchFailedForQuestionIds.has(String(question.id)) && (
                            <span className="text-xs text-red-500 font-medium">匹配失败，请您手动调整答案解析</span>
                          )}
                          {workMode !== 'questions-only' && (
                            <>
                              {/* 答案解析匹配状态标签 */}
                              {(() => {
                                const info = getQuestionMatchInfo(question);
                                return (
                                  <>
                                    {info.subTotal > 0 && info.pendingSubCount > 0 && (
                                      <span className={cn(
                                        "text-xs px-1.5 py-0.5 rounded border",
                                        "bg-orange-50 text-orange-600 border-orange-200"
                                      )}>
                                        {info.pendingSubCount} 个子题待匹配
                                      </span>
                                    )}
                                    {info.needsManualSplit && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                        答案解析待人工拆分
                                      </span>
                                    )}
                                    {info.missingLabel ? (
                                      <span className={cn(
                                        "text-xs px-1.5 py-0.5 rounded border",
                                        info.missingAnswer && info.missingAnalysis
                                          ? "bg-red-50 text-red-600 border-red-200"
                                          : info.missingAnswer
                                            ? "bg-orange-50 text-orange-600 border-orange-200"
                                            : "bg-amber-50 text-amber-700 border-amber-200"
                                      )}>
                                        {info.missingLabel}
                                      </span>
                                    ) : info.pendingSubCount === 0 && !info.needsManualSplit ? (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
                                        答案解析已匹配
                                      </span>
                                    ) : null}
                                  </>
                                );
                              })()}
                              {question.answerSource === 'extracted' && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">从解析提取</span>
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          <div
                            data-req-anchor={question.id === firstQuestionWithCardActionsId ? questionCardReorderAnchorId : undefined}
                            className="relative flex items-center gap-0.5"
                          >
                            {question.id === firstQuestionWithCardActionsId &&
                              renderRequirementMarker(
                                questionCardReorderRequirementId,
                                '-left-2 -top-3',
                                questionCardReorderDisplayNumber,
                              )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => handleMoveQuestionUp(question.id)}
                                  disabled={questions.findIndex(q => q.id === question.id) === 0}
                                  className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <MoveUp className="w-4 h-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top">上移题目</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => handleMoveQuestionDown(question.id)}
                                  disabled={questions.findIndex(q => q.id === question.id) === questions.length - 1}
                                  className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <MoveDown className="w-4 h-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top">下移题目</TooltipContent>
                            </Tooltip>
                          </div>
                          <div
                            data-req-anchor={question.id === firstQuestionWithCardActionsId ? questionCardDeleteAnchorId : undefined}
                            className="relative inline-flex"
                          >
                            {question.id === firstQuestionWithCardActionsId &&
                              renderRequirementMarker(
                                questionCardDeleteRequirementId,
                                '-right-1 -top-3',
                                questionCardDeleteDisplayNumber,
                              )}
                            <button onClick={() => handleDeleteQuestion(question.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500" title="删除题目">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {/* 题目内容 */}
                      <div className="p-3">
                        {/* 题型选择器行 */}
                        <div className="flex items-center justify-between mb-2">
                          <div
                            data-req-anchor={question.id === firstQuestionWithTypeSelectorId ? 'review-step-question-type-guard' : undefined}
                            className="relative flex items-center gap-2"
                          >
                            {question.id === firstQuestionWithTypeSelectorId &&
                              renderRequirementMarker('REVIEW_STEP-017', 'right-0 -top-3')}
                            <select value={question.questionType} onChange={(e) => handleUpdateQuestionType(question.id, e.target.value)} className="px-2 py-1 text-xs border rounded bg-white">
                              {questionTypes.map(type => (<option key={type} value={type}>{type}</option>))}
                            </select>
                            {/* 填空题填空数控件 */}
                            {isFillBlankType(question.questionType) && (
                              <div className="flex items-center gap-1 text-xs text-gray-600">
                                <span>填空数:</span>
                                <button onClick={() => handleUpdateBlankCount(question.id, question.blankCount - 1)} className="w-5 h-5 flex items-center justify-center rounded border hover:bg-gray-100">-</button>
                                <span className="w-4 text-center font-medium">{question.blankCount}</span>
                                <button onClick={() => handleUpdateBlankCount(question.id, question.blankCount + 1)} className="w-5 h-5 flex items-center justify-center rounded border hover:bg-gray-100">+</button>
                              </div>
                            )}
                            {/* 复合题：添加子题结构按钮 */}
                            {compoundQuestionTypes.includes(question.questionType) && (
                              <button
                                onClick={() => handleAddSubQuestion(question.id)}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-emerald-600 border border-dashed border-emerald-300 rounded hover:bg-emerald-50"
                              >
                                <Plus className="w-3 h-3" /> 子题
                              </button>
                            )}
                            {/* 完形填空：批量选项数控件 */}
                            {question.questionType === '完形填空' && (question.subQuestions || []).length > 0 && (
                              <div className="flex items-center gap-1 text-xs text-gray-600">
                                <span>选项数:</span>
                                <button onClick={() => handleUpdateClozeOptionCount(question.id, ((question.subQuestions?.[0]?.optionCount) || 4) - 1)} className="w-5 h-5 flex items-center justify-center rounded border hover:bg-gray-100">-</button>
                                <span className="w-4 text-center font-medium">{question.subQuestions?.[0]?.optionCount || 4}</span>
                                <button onClick={() => handleUpdateClozeOptionCount(question.id, ((question.subQuestions?.[0]?.optionCount) || 4) + 1)} className="w-5 h-5 flex items-center justify-center rounded border hover:bg-gray-100">+</button>
                              </div>
                            )}
                          </div>
                          {viewMode === 'recognize' && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                              使用图片
                              <Switch
                                checked={question.showRecognizedContent}
                                onCheckedChange={() => handleToggleRecognizedContent(question.id)}
                                className="scale-75"
                              />
                            </div>
                          )}
                        </div>

                        {/* 复合题：子题结构标记（紧凑行，紧跟题型选择器） */}
                        {compoundQuestionTypes.includes(question.questionType) && (question.subQuestions || []).length > 0 && (
                          <div
                            data-req-anchor={question.id === firstQuestionWithSubQuestionsId ? 'review-step-subquestion' : undefined}
                            className="relative mb-2 flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-gray-50 rounded border"
                          >
                            {question.id === firstQuestionWithSubQuestionsId &&
                              renderRequirementMarker('REVIEW_STEP-004', 'right-1 -top-2')}
                            {(question.subQuestions || []).map((sub, subIndex) => (
                              <div key={sub.id} className="flex items-center gap-1 group">
                                <span className="text-xs font-medium text-gray-700">{SUB_NUMBERS[subIndex] || `${subIndex + 1}`}</span>
                                <select
                                  value={sub.questionType}
                                  onChange={(e) => handleUpdateSubQuestionType(question.id, sub.id, e.target.value)}
                                  className="px-1 py-0.5 text-[11px] border rounded bg-white h-5"
                                >
                                  {questionTypes.map(type => (<option key={type} value={type}>{type}</option>))}
                                </select>
                                {isFillBlankType(sub.questionType) && (
                                  <div className="flex items-center gap-0.5 text-[11px] text-gray-500">
                                    <span>空</span>
                                    <button onClick={() => handleUpdateBlankCount(question.id, (sub.blankCount || 1) - 1, true, sub.id)} className="w-3.5 h-3.5 flex items-center justify-center rounded border hover:bg-gray-100 text-[9px]">-</button>
                                    <span className="w-2.5 text-center">{sub.blankCount || 1}</span>
                                    <button onClick={() => handleUpdateBlankCount(question.id, (sub.blankCount || 1) + 1, true, sub.id)} className="w-3.5 h-3.5 flex items-center justify-center rounded border hover:bg-gray-100 text-[9px]">+</button>
                                  </div>
                                )}
                                <button
                                  onClick={() => handleDeleteSubQuestion(question.id, sub.id)}
                                  className="p-0 hover:bg-red-50 rounded text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="移除子题"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 题目图片/文本内容 */}
                        <div className="space-y-2">
                            {viewMode === 'image' || (viewMode === 'recognize' && question.showRecognizedContent) ? (
                          <div
                            data-req-anchor={question.id === firstQuestionWithImageId ? 'review-step-crop' : undefined}
                            className="mb-3 relative group/img"
                          >
                            {question.id === firstQuestionWithImageId &&
                              renderRequirementMarker('REVIEW_STEP-007', 'left-2 top-2')}
                            {question.croppedImageData ? (
                              <>
                                {/* 裁剪模式：显示裁剪编辑器 */}
                                {croppingQuestionId === question.id ? (
                                  cropRegion ? (
                                  <div className="relative w-full rounded border overflow-hidden bg-gray-100" style={{ maxHeight: '450px' }}>
                                    {/* 原图（底层） */}
                                    <img
                                      src={question.croppedImageData}
                                      alt={`第${question.number}题`}
                                      className="block mx-auto"
                                      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                                      draggable={false}
                                      onLoad={(e) => {
                                        const img = e.currentTarget;
                                        handleCropImageLoad(img.clientWidth, img.clientHeight);
                                      }}
                                    />
                                    {/* 遮罩层（暗化非选中区域） */}
                                    <div
                                      className="absolute inset-0 pointer-events-none"
                                      style={{
                                        background: `
                                          linear-gradient(to right,
                                            rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.55) ${cropRegion.x}px,
                                            transparent ${cropRegion.x}px, transparent ${cropRegion.x + cropRegion.width}px,
                                            rgba(0,0,0,0.55) ${cropRegion.x + cropRegion.width}px, rgba(0,0,0,0.55) 100%
                                          ),
                                          linear-gradient(to bottom,
                                            rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.55) ${cropRegion.y}px,
                                            transparent ${cropRegion.y}px, transparent ${cropRegion.y + cropRegion.height}px,
                                            rgba(0,0,0,0.55) ${cropRegion.y + cropRegion.height}px, rgba(0,0,0,0.55) 100%
                                          )
                                        `,
                                        backgroundBlendMode: 'multiply',
                                      }}
                                    />
                                    {/* 裁剪框 */}
                                    <div
                                      className="absolute border-2 border-white shadow-lg cursor-move"
                                      style={{
                                        left: cropRegion.x,
                                        top: cropRegion.y,
                                        width: cropRegion.width,
                                        height: cropRegion.height,
                                        boxSizing: 'border-box',
                                      }}
                                      onMouseDown={(e) => handleCropMouseDown(e, 'move')}
                                    >
                                      {/* 网格线（九宫格参考） */}
                                      <div className="absolute inset-0 pointer-events-none">
                                        <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                                        <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                                        <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                                        <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
                                      </div>
                                      {/* 四角手柄 */}
                                      <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white rounded-full border-2 border-blue-500 cursor-nw-resize" onMouseDown={(e) => handleCropMouseDown(e, 'resize-nw')} />
                                      <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white rounded-full border-2 border-blue-500 cursor-ne-resize" onMouseDown={(e) => handleCropMouseDown(e, 'resize-ne')} />
                                      <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white rounded-full border-2 border-blue-500 cursor-sw-resize" onMouseDown={(e) => handleCropMouseDown(e, 'resize-sw')} />
                                      <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white rounded-full border-2 border-blue-500 cursor-se-resize" onMouseDown={(e) => handleCropMouseDown(e, 'resize-se')} />
                                      {/* 四边中点手柄 */}
                                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-1.5 bg-white rounded-full border border-blue-500 cursor-n-resize" onMouseDown={(e) => handleCropMouseDown(e, 'resize-n')} />
                                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1.5 bg-white rounded-full border border-blue-500 cursor-s-resize" onMouseDown={(e) => handleCropMouseDown(e, 'resize-s')} />
                                      <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 h-4 bg-white rounded-full border border-blue-500 cursor-w-resize" onMouseDown={(e) => handleCropMouseDown(e, 'resize-w')} />
                                      <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1.5 h-4 bg-white rounded-full border border-blue-500 cursor-e-resize" onMouseDown={(e) => handleCropMouseDown(e, 'resize-e')} />
                                    </div>
                                    {/* 操作栏 */}
                                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 text-white text-xs rounded-full px-3 py-1.5 backdrop-blur-sm z-10">
                                      <button onClick={handleCancelCrop} className="flex items-center gap-1 hover:text-gray-300">
                                        取消
                                      </button>
                                      <span className="text-gray-400">|</span>
                                      <button onClick={handleConfirmCrop} className="flex items-center gap-1 hover:text-emerald-300 font-medium">
                                        <Check className="w-3.5 h-3.5" /> 确认裁剪
                                      </button>
                                      {question.userCroppedImageData && (
                                        <>
                                          <span className="text-gray-400">|</span>
                                          <button
                                            onClick={() => { handleRestoreOriginalImage(question.id); setCroppingQuestionId(null); }}
                                            className="flex items-center gap-1 hover:text-orange-300"
                                          >
                                            <RotateCcw className="w-3 h-3" /> 恢复原图
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  /* 裁剪初始化中：显示图片等待尺寸就绪（onLoad 触发后设置 cropRegion） */
                                  <div className="relative w-full rounded border overflow-hidden bg-gray-100" style={{ maxHeight: '450px' }}>
                                    <img
                                      src={question.croppedImageData}
                                      alt={`第${question.number}题`}
                                      className="block mx-auto"
                                      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                                      draggable={false}
                                      onLoad={(e) => {
                                        const img = e.currentTarget;
                                        if (img.clientWidth > 0 && img.clientHeight > 0) {
                                          handleCropImageLoad(img.clientWidth, img.clientHeight);
                                        }
                                      }}
                                    />
                                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs rounded-full px-3 py-1 backdrop-blur-sm">
                                      正在初始化裁剪工具...
                                    </div>
                                  </div>
                                )
                              ) : (
                                  /* 正常模式：显示图片 + 悬停裁剪按钮 */
                                  <>
                                    <div
                                      className="w-full rounded border overflow-auto bg-gray-50 cursor-zoom-in"
                                      style={{ maxHeight: '400px' }}
                                      onClick={() => setPreviewImage(question.userCroppedImageData || question.croppedImageData!)}
                                    >
                                      <img
                                        src={question.userCroppedImageData || question.croppedImageData}
                                        alt={`第${question.number}题`}
                                        className="block mx-auto"
                                        style={{
                                          maxWidth: '100%',
                                          height: 'auto',
                                          objectFit: 'contain'
                                        }}
                                        onLoad={(e) => {
                                          const img = e.currentTarget;
                                          if (img.clientWidth > 0 && img.clientHeight > 0) {
                                            imageSizesRef.current.set(question.id, { width: img.clientWidth, height: img.clientHeight });
                                          }
                                        }}
                                        onError={(e) => {
                                          // 图片加载失败时隐藏图片，显示占位
                                          e.currentTarget.style.display = 'none';
                                        }}
                                      />
                                    </div>
                                    {/* 悬停工具栏 */}
                                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity z-10">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleStartCrop(question.id); }}
                                        className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 shadow-sm whitespace-nowrap"
                                        title="裁剪图片，去掉答案/解析区域"
                                      >
                                        <Scissors className="w-3.5 h-3.5" /> 裁剪
                                      </button>
                                      {question.userCroppedImageData && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleRestoreOriginalImage(question.id); }}
                                          className="flex items-center gap-1 px-2 py-1 bg-gray-600 text-white text-xs rounded-md hover:bg-gray-700 shadow-sm whitespace-nowrap"
                                          title="恢复为原始完整截图"
                                        >
                                          <RotateCcw className="w-3.5 h-3.5" /> 还原
                                        </button>
                                      )}
                                    </div>
                                    {/* 已裁剪标记 */}
                                    {question.userCroppedImageData && (
                                      <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/90 text-white text-[10px] rounded opacity-0 group-hover/img:opacity-100 transition-opacity z-10">
                                        <Check className="w-3 h-3" /> 已裁剪
                                      </div>
                                    )}
                                  </>
                                )}
                              </>
                            ) : (
                              <div className="bg-gray-100 rounded border h-24 flex flex-col items-center justify-center text-gray-400 text-sm gap-1">
                                <ImageOff className="w-5 h-5 opacity-50" />
                                <span>暂无题目图片</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mb-3">
                            <MathEditable
                              value={question.content}
                              onChange={(val) => handleUpdateContent(question.id, val)}
                              className="w-full text-sm text-gray-700 bg-gray-50 p-2 rounded border resize-y min-h-[120px] max-h-[300px] focus:outline-none focus:border-blue-500"
                              placeholder="请输入题目内容"
                            />
                          </div>
                        )}
                        {choiceQuestionTypes.includes(question.questionType) && question.optionCount > 4 && (
                          <div className="mb-3 space-y-1.5">
                            {OPTION_LETTERS.slice(4, question.optionCount).split('').map(letter => (
                              <div key={letter} className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-600 w-4 flex-shrink-0">{letter}.</span>
                                <input
                                  type="text"
                                  value={question.optionContents[letter] || ''}
                                  onChange={(e) => handleUpdateOptionContent(question.id, letter, e.target.value)}
                                  placeholder={`选项${letter}内容`}
                                  className="flex-1 px-2 py-1 border rounded text-sm focus:outline-none focus:border-emerald-500"
                                />
                                <button
                                  onClick={() => handleDeleteOption(question.id, letter)}
                                  className="p-0.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 flex-shrink-0"
                                  title="删除此选项"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 父题答案输入：无子题时常规显示；有子题但答案未能按标记拆分时保留父题区供人工拆分 */}
                        {workMode !== 'questions-only' && (!(compoundQuestionTypes.includes(question.questionType) && (question.subQuestions || []).length > 0) || getQuestionMatchInfo(question).needsManualSplit) && (
                        <div
                          data-req-anchor={question.id === firstQuestionWithParentAnswerClearId ? 'review-step-answer-clear' : undefined}
                          className="relative"
                        >
                        {question.id === firstQuestionWithParentAnswerClearId &&
                          renderRequirementMarker('REVIEW_STEP-018', 'right-1 top-1')}
                        {getQuestionMatchInfo(question).needsManualSplit && (
                          <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                            答案解析待人工拆分：当前内容保留在父题答案/解析区，请核对后拆到对应子题。
                          </div>
                        )}
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <div
                              data-req-anchor={question.id === firstQuestionWithCardActionsId ? 'review-step-answer-link-icon' : undefined}
                              className="relative flex items-center gap-1"
                            >
                              {question.id === firstQuestionWithCardActionsId &&
                                renderRequirementMarker('REVIEW_STEP-005', 'right-0 -top-3')}
                              <label className="text-xs font-medium text-gray-500">【答案】</label>
                              <button
                                type="button"
                                onClick={() => handleDirectedManualLinkEntryClick(question.id, 'answer')}
                                disabled={isProcessing || answerProcessingForQuestionIds.has(question.id)}
                                className={cn(
                                  "p-0.5 rounded text-gray-300 transition-colors",
                                  manualLinkTarget?.questionId === question.id && manualLinkTarget.field === 'answer'
                                    ? "bg-orange-50 text-orange-500"
                                    : "hover:bg-orange-50 hover:text-orange-500",
                                  (isProcessing || answerProcessingForQuestionIds.has(question.id)) && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-gray-300"
                                )}
                                title="框选内容并填入本题答案"
                              >
                                <Link2Icon className="w-3 h-3" />
                              </button>
                            </div>
                            {(question.answer || (question.blankAnswers && question.blankAnswers.some(b => b?.trim()))) && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (isFillBlankType(question.questionType) && question.blankCount > 1) {
                                    Array.from({ length: question.blankCount }, (_, i) => {
                                      handleUpdateBlankAnswer(question.id, i, '');
                                    });
                                  } else {
                                    handleUpdateAnswer(question.id, '');
                                  }
                                }}
                                className="text-[11px] text-gray-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                                title="清空答案"
                              >
                                <Trash2 className="w-3 h-3" /> 清空
                              </button>
                            )}
                          </div>
                          {answerProcessingForQuestionIds.has(question.id) ? (
                            <div className="relative">
                              <input
                                type="text"
                                disabled
                                value=""
                                className="w-full px-3 py-1.5 border rounded text-sm bg-emerald-50/50 border-emerald-300 animate-pulse"
                              />
                              <div className="absolute inset-0 flex items-center gap-2 px-3 pointer-events-none">
                                <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                                <span className="text-sm text-emerald-600">答案识别中...</span>
                              </div>
                            </div>
                          ) : isFillBlankType(question.questionType) && question.blankCount > 1 ? (
                            /* 多空位填空题：每个空位一个输入框 */
                            <div className="space-y-1.5">
                              {Array.from({ length: question.blankCount }, (_, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-500 w-8 flex-shrink-0">空{i + 1}</span>
                                  <div className="relative flex-1">
                                    <input
                                      type="text"
                                      value={question.blankAnswers[i] || ''}
                                      onChange={(e) => handleUpdateBlankAnswer(question.id, i, e.target.value)}
                                      placeholder={`第${i + 1}空答案`}
                                      className="w-full px-3 py-1.5 pr-8 border rounded text-sm focus:outline-none focus:border-emerald-500"
                                    />
                                    {question.blankAnswers?.[i] && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateBlankAnswer(question.id, i, '')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500"
                                        title="点击清空内容"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            /* 单空位填空题或其他题型：单个答案输入框 */
                            <div className="relative">
                              <input
                                type="text"
                                value={question.answer || ''}
                                onChange={(e) => handleUpdateAnswer(question.id, e.target.value)}
                                placeholder="请输入答案"
                                className="w-full px-3 py-1.5 pr-8 border rounded text-sm focus:outline-none focus:border-emerald-500"
                              />
                              {question.answer && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateAnswer(question.id, '')}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500"
                                  title="点击清空内容"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        
                        {/* 解析输入（所有题型都显示） */}
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1">
                              <label className="text-xs font-medium text-gray-500">【解析】</label>
                              <button
                                type="button"
                                onClick={() => handleDirectedManualLinkEntryClick(question.id, 'analysis')}
                                disabled={isProcessing || answerProcessingForQuestionIds.has(question.id)}
                                className={cn(
                                  "p-0.5 rounded text-gray-300 transition-colors",
                                  manualLinkTarget?.questionId === question.id && manualLinkTarget.field === 'analysis'
                                    ? "bg-orange-50 text-orange-500"
                                    : "hover:bg-orange-50 hover:text-orange-500",
                                  (isProcessing || answerProcessingForQuestionIds.has(question.id)) && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-gray-300"
                                )}
                                title="框选内容并填入本题解析"
                              >
                                <Link2Icon className="w-3 h-3" />
                              </button>
                            </div>
                            {question.analysis?.trim() && (
                              <button
                                type="button"
                                onClick={() => handleUpdateAnalysis(question.id, '')}
                                className="text-[11px] text-gray-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                                title="清空解析"
                              >
                                <Trash2 className="w-3 h-3" /> 清空
                              </button>
                            )}
                          </div>
                          {answerProcessingForQuestionIds.has(question.id) ? (
                            <div className="relative">
                              <div className="w-full px-3 py-1.5 border rounded text-sm bg-emerald-50/50 border-emerald-300 animate-pulse min-h-[3rem]" />
                              <div className="absolute inset-0 flex items-center gap-2 px-3 pointer-events-none">
                                <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                                <span className="text-sm text-emerald-600">解析识别中...</span>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              <MathEditable
                                value={question.analysis || ''}
                                onChange={(val) => handleUpdateAnalysis(question.id, val)}
                                placeholder='请输入解析'
                                className="w-full px-3 py-1.5 pr-8 border rounded text-sm resize-y min-h-[3rem] max-h-48 focus:outline-none focus:border-emerald-500"
                              />
                              {question.analysis && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateAnalysis(question.id, '')}
                                  className="absolute right-2 top-2 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500 z-10"
                                  title="点击清空内容"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        </div>
                        )}

                        {/* 复合题：子题答案区（仅当有子题时显示；一步识别模式不显示） */}
                        {workMode !== 'questions-only' && compoundQuestionTypes.includes(question.questionType) && (question.subQuestions || []).length > 0 && (
                          <div className="relative border-t pt-2 mt-1">
                            <div
                              data-req-anchor={!firstQuestionWithParentAnswerClearId && question.id === firstQuestionWithSubAnswerClearId ? 'review-step-answer-clear' : undefined}
                              className="relative"
                            >
                            {!firstQuestionWithParentAnswerClearId && question.id === firstQuestionWithSubAnswerClearId &&
                              renderRequirementMarker('REVIEW_STEP-018', 'right-1 top-0')}
                            <div className="text-xs font-medium text-gray-500 mb-2">子题答案</div>
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {(question.subQuestions || []).map((sub, subIndex) => (
                              <div key={sub.id} className="bg-gray-50 rounded-md px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-700">{SUB_NUMBERS[subIndex] || `${subIndex + 1}`}</span>
                                    <span className="text-xs text-gray-400 px-1 py-0.5 bg-white rounded border">{sub.questionType}</span>
                                    {isFillBlankType(sub.questionType) && (sub.blankCount || 1) > 1 && (
                                      <span className="text-xs text-gray-400">{sub.blankCount}个空</span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSubQuestion(question.id, sub.id)}
                                    className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                                    title="删除该子题"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <div className="space-y-2">
                                  {answerProcessingForQuestionIds.has(question.id) ? (
                                    <div className="relative">
                                      <input
                                        type="text"
                                        disabled
                                        value=""
                                        className="w-full px-3 py-1.5 border rounded text-sm bg-emerald-50/50 border-emerald-300 animate-pulse"
                                      />
                                      <div className="absolute inset-0 flex items-center gap-2 px-3 pointer-events-none">
                                        <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                                        <span className="text-sm text-emerald-600">答案识别中...</span>
                                      </div>
                                    </div>
                                  ) : isFillBlankType(sub.questionType) && (sub.blankCount || 1) > 1 ? (
                                    /* 子题多空位填空 */
                                    <>
                                    <div className="flex items-center justify-between">
                                      <label className="text-xs text-gray-500">答案</label>
                                      {sub.blankAnswers && sub.blankAnswers.some(b => b?.trim()) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            Array.from({ length: sub.blankCount || 1 }, (_, i) => {
                                              handleUpdateBlankAnswer(question.id, i, '', true, sub.id);
                                            });
                                          }}
                                          className="text-[11px] text-gray-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                                          title="清空所有空位答案"
                                        >
                                          <Trash2 className="w-3 h-3" /> 清空
                                        </button>
                                      )}
                                    </div>
                                    {Array.from({ length: sub.blankCount || 1 }, (_, i) => (
                                      <div key={i} className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500 w-8 flex-shrink-0">空{i + 1}</span>
                                        <div className="relative flex-1">
                                          <input
                                            type="text"
                                            value={sub.blankAnswers?.[i] || ''}
                                            onChange={(e) => handleUpdateBlankAnswer(question.id, i, e.target.value, true, sub.id)}
                                            placeholder={`第${i + 1}空答案`}
                                            className="w-full px-2.5 py-1.5 pr-8 border rounded text-sm bg-white focus:outline-none focus:border-emerald-500"
                                          />
                                          {sub.blankAnswers?.[i] && (
                                            <button
                                              type="button"
                                              onClick={() => handleUpdateBlankAnswer(question.id, i, '', true, sub.id)}
                                              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500"
                                              title="点击清空内容"
                                            >
                                              <X className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                    </>
                                  ) : (
                                    /* 子题单答案 */
                                    <div>
                                      <div className="flex items-center justify-between mb-0.5">
                                        <label className="text-xs text-gray-500">答案</label>
                                        {sub.answer?.trim() && (
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateSubAnswer(question.id, sub.id, '')}
                                            className="text-[11px] text-gray-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                                            title="清空答案"
                                          >
                                            <Trash2 className="w-3 h-3" /> 清空
                                          </button>
                                        )}
                                      </div>
                                      <div className="relative">
                                        <input
                                          type="text"
                                          value={sub.answer}
                                          onChange={(e) => handleUpdateSubAnswer(question.id, sub.id, e.target.value)}
                                          placeholder={choiceQuestionTypes.includes(sub.questionType) ? '如 A' : '请输入答案'}
                                          className="w-full px-2.5 py-1.5 pr-8 border rounded text-sm bg-white focus:outline-none focus:border-emerald-500"
                                        />
                                        {sub.answer && (
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateSubAnswer(question.id, sub.id, '')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500"
                                            title="点击清空内容"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  <div>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <label className="text-xs text-gray-500">解析</label>
                                      {!answerProcessingForQuestionIds.has(question.id) && sub.analysis?.trim() && (
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateSubAnalysis(question.id, sub.id, '')}
                                          className="text-[11px] text-gray-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                                          title="清空解析"
                                        >
                                          <Trash2 className="w-3 h-3" /> 清空
                                        </button>
                                      )}
                                    </div>
                                    {answerProcessingForQuestionIds.has(question.id) ? (
                                      <div className="relative">
                                        <div className="w-full px-2.5 py-1.5 border rounded text-sm bg-emerald-50/50 border-emerald-300 animate-pulse min-h-[2rem]" />
                                        <div className="absolute inset-0 flex items-center gap-2 px-3 pointer-events-none">
                                          <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                                          <span className="text-sm text-emerald-600">解析识别中...</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="relative">
                                        <textarea
                                          value={sub.analysis || ''}
                                          onChange={(e) => handleUpdateSubAnalysis(question.id, sub.id, e.target.value)}
                                          placeholder="选填"
                                          rows={2}
                                          className="w-full px-2.5 py-1.5 pr-8 border rounded text-sm bg-white resize-y min-h-[2rem] max-h-32 focus:outline-none focus:border-emerald-500"
                                        />
                                        {sub.analysis && (
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateSubAnalysis(question.id, sub.id, '')}
                                            className="absolute right-2 top-2 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500"
                                            title="点击清空内容"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                            </div>
                            </div>
                          </div>
                        )}

                      </div>
                        </div>
                  </div>
                ))}
                </div>
              </div>


              {/* 未关联答案区（旧版 AnswerMarker 机制，保留兼容）*/}
              {unlinkedAnswerCount > 0 && (
                <div className="border-t bg-orange-50 p-2">
                  <div className="text-xs text-gray-600 mb-1">未关联答案（点击关联到题目）</div>
                  <div className="flex flex-wrap gap-1">
                    {answers.filter(a => a.status === 'unlinked').map(answer => (
                      <button
                        key={answer.id}
                        className="bg-white border border-orange-300 rounded px-2 py-0.5 text-xs hover:bg-orange-100"
                        onClick={() => {
                          const questionId = prompt(`请输入要关联的题目编号(1-${questions.length})`);
                          if (questionId) {
                            const qId = parseInt(questionId);
                            if (qId >= 1 && qId <= questions.length) {
                              handleLinkAnswer(answer, qId);
                            }
                          }
                        }}
                      >
                        答案(第{answer.pageNumber}页)
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {/* ==================== 主工作区结束 ==================== */}
      </>)}

      {/* 框类型选择弹窗（画框结束后弹出）—— 统一弹窗样式 */}
      {pendingBoxTypeSelection && (
        <div
          className="fixed inset-y-0 left-0 bg-black/50 flex items-center justify-center z-[60]"
          style={prdPanelOffsetStyle}
        >
          <div className="bg-white rounded-lg shadow-xl w-[920px] max-w-[94vw]">
            {/* 头部 - 统一：浅绿色背景 + 圆形关闭按钮 */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-emerald-50 rounded-t-lg">
              <div>
                <h3 className="text-base font-semibold text-emerald-700">请选择此框的内容类型</h3>
                <p className="text-xs text-gray-400 mt-0.5">选择后 AI 将按对应模式识别处理</p>
              </div>
              <button
                onClick={() => handleCancelBoxType(pendingBoxTypeSelection)}
                className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600 flex-shrink-0"
                title="取消并删除此框"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* 内容区 - 三种选项卡片（默认选中「仅题干」，点击切换选中，选中态统一 emerald 与弹窗头部和谐） */}
            <div className="px-8 py-6 grid grid-cols-3 gap-5">
              {/* 仅题干 - 默认选中 */}
              <button
                onClick={() => setTempSelectedType('question')}
                className={cn(
                  "group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer",
                  tempSelectedType === 'question'
                    ? "border-emerald-500 bg-emerald-50/70"
                    : "border-gray-200 hover:border-teal-400 hover:bg-teal-50/50"
                )}
              >
                <div className={cn("w-full aspect-[3/4] rounded-lg overflow-hidden border shadow-sm",
                  tempSelectedType === 'question' ? "border-emerald-300 bg-emerald-50/30" : "border-gray-200 bg-white")}>
                  <img src="/box-type-question.jpg" alt="仅题干示例" className="w-full h-full object-contain" />
                </div>
                <span className={cn("text-sm font-bold", tempSelectedType === 'question' ? "text-emerald-600" : "text-gray-800 group-hover:text-teal-600")}>仅题干</span>
                <span className="text-xs text-gray-500 leading-relaxed text-center">只有题目内容<br/>不含答案解析</span>
              </button>

              {/* 仅答案解析 */}
              <button
                onClick={() => { setTempSelectedType('answer'); setPendingAnswerTargetId(questions.length > 0 ? questions[0].id : null); }}
                className={cn(
                  "group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer",
                  tempSelectedType === 'answer'
                    ? "border-emerald-500 bg-emerald-50/70"
                    : "border-gray-200 hover:border-amber-400 hover:bg-amber-50/50"
                )}
              >
                <div className={cn("w-full aspect-[3/4] rounded-lg overflow-hidden border shadow-sm",
                  tempSelectedType === 'answer' ? "border-emerald-300 bg-emerald-50/30" : "border-gray-200 bg-white")}>
                  <img src="/box-type-answer.jpg" alt="仅答案解析示例" className="w-full h-full object-contain" />
                </div>
                <span className={cn("text-sm font-bold", tempSelectedType === 'answer' ? "text-emerald-600" : "text-gray-800 group-hover:text-amber-600")}>仅答案解析</span>
                <span className="text-xs text-gray-500 leading-relaxed text-center">答案、解析、点评等<br/>不含题干内容</span>
              </button>

              {/* 题干(含答案解析) */}
              <button
                onClick={() => setTempSelectedType('full')}
                className={cn(
                  "group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer",
                  tempSelectedType === 'full'
                    ? "border-emerald-500 bg-emerald-50/70"
                    : "border-gray-200 hover:border-lime-400 hover:bg-lime-50/50"
                )}
              >
                <div className={cn("w-full aspect-[3/4] rounded-lg overflow-hidden border shadow-sm",
                  tempSelectedType === 'full' ? "border-emerald-300 bg-emerald-50/30" : "border-gray-200 bg-white")}>
                  <img src="/box-type-both.jpg" alt="完整示例" className="w-full h-full object-contain" />
                </div>
                <span className={cn("text-sm font-bold", tempSelectedType === 'full' ? "text-emerald-600" : "text-gray-800 group-hover:text-lime-600")}>题干+答案解析</span>
                <span className="text-xs text-gray-500 leading-relaxed text-center">完整区域<br/>题目与答案全包含</span>
              </button>
            </div>

            {/* 关联题号区：仅选中「仅答案解析」时显示 */}
            {tempSelectedType === 'answer' && (
              <div className="px-8 pb-5 pt-1">
                <div className="border-t border-dashed border-emerald-200 pt-4">
                  <div className="flex items-center gap-3">
                    <Link2Icon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <label className="text-sm font-medium text-emerald-700 whitespace-nowrap">关联题号</label>
                    {questions.length > 0 ? (
                      <select
                        value={pendingAnswerTargetId ?? ''}
                        onChange={(e) => setPendingAnswerTargetId(parseInt(e.target.value) || null)}
                        className="flex-1 text-sm border border-emerald-300 rounded-lg px-3 pr-10 py-2 text-emerald-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 cursor-pointer shadow-sm appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2310b981%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3e%3cpolyline%20points=%276%209%2012%2015%2018%209%27%3e%3c/polyline%3e%3c/svg%3e')] bg-[length:16px_16px] bg-[position:right_12px_center] bg-no-repeat"
                      >
                        {questions.map(q => {
                          // 判断题目是否已有答案：仅检查主题级别（不含子题）
                          // 子题答案属于拆分后的结果，主题本身视为无答案
                          const hasAnswer = !!(
                            q.answer?.trim() ||
                            (q.blankAnswers && q.blankAnswers.some(b => b?.trim()))
                          );
                          return (
                            <option key={q.id} value={q.id}>
                              第{q.number}题{hasAnswer ? ' (已有答案)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <span className="text-xs text-orange-500 bg-orange-50 px-3 py-2 rounded-lg flex-1">
                        请先识别题目，再框选答案并关联
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2 ml-7">
                    识别完成后，答案将自动填充到所选题目
                  </p>
                </div>
              </div>
            )}

            {/* 底部按钮：取消（删除框） + 确认（保存类型并显示标签） */}
            <div className="flex items-center justify-end gap-3 px-4 py-2.5 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={() => handleCancelBoxType(pendingBoxTypeSelection)}
                className="px-5 py-1.5 text-sm text-gray-500 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleConfirmBoxType(pendingBoxTypeSelection, tempSelectedType)}
                className="px-5 py-1.5 text-sm text-white rounded bg-emerald-500 hover:bg-emerald-600 transition-colors"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 关联题号选择器（第二步画答案框后弹出） */}
      {showAnswerLinkPicker && (
        <div
          className="fixed inset-y-0 left-0 bg-black/50 flex items-center justify-center z-[60]"
          style={prdPanelOffsetStyle}
        >
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-[94vw]">
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-emerald-50 rounded-t-lg">
              <div>
                <h3 className="text-base font-semibold text-emerald-700">请关联题号</h3>
                <p className="text-xs text-gray-400 mt-0.5">为当前框选的答案关联对应的题目</p>
              </div>
              <button
                onClick={() => {
                  // 取消：删除该框
                  if (pendingLinkBoxId) {
                    setQuestionBoxes(prev => prev.filter(b => b.id !== pendingLinkBoxId));
                  }
                  setShowAnswerLinkPicker(false);
                  setPendingLinkBoxId(null);
                  setPendingAnswerTargetId(null);
                }}
                className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600 flex-shrink-0"
                title="取消并删除此框"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* 题目列表 */}
            <div className="px-5 py-4 max-h-[360px] overflow-y-auto">
              {questions.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  暂无已识别的题目，请先完成题目识别
                </div>
              ) : (
                <div className="space-y-1.5">
                  {questions.map(q => {
                    const hasAnswer = !!(
                      q.answer?.trim() ||
                      q.analysis?.trim() ||
                      (q.blankAnswers && q.blankAnswers.some(b => b?.trim()))
                    );
                    const isSelected = pendingAnswerTargetId === q.id;
                    return (
                      <button
                        key={q.id}
                        onClick={() => setPendingAnswerTargetId(q.id)}
                        className={cn(
                          "w-full text-left px-3.5 py-2.5 rounded-lg border transition-all cursor-pointer",
                          isSelected
                            ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
                            : "border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/40"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className={cn("text-sm font-medium", isSelected ? "text-emerald-700" : "text-gray-800")}>
                            第{q.number}题
                          </span>
                          {hasAnswer && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium">
                              已匹配答案
                            </span>
                          )}
                        </div>
                        {/* 题干预览（截取前30字） */}
                        {q.content && (
                          <p className="text-xs text-gray-400 mt-1 truncate pr-12" title={q.content}>
                            {q.content.replace(/\s+/g, ' ').slice(0, 35)}{q.content.length > 35 ? '...' : ''}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {/* 底部按钮 */}
            <div className="flex items-center justify-end gap-3 px-4 py-2.5 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={() => {
                  if (pendingLinkBoxId) {
                    setQuestionBoxes(prev => prev.filter(b => b.id !== pendingLinkBoxId));
                  }
                  setShowAnswerLinkPicker(false);
                  setPendingLinkBoxId(null);
                  setPendingAnswerTargetId(null);
                }}
                className="px-5 py-1.5 text-sm text-gray-500 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  if (!pendingAnswerTargetId) {
                    alert('请选择一个关联题号');
                    return;
                  }
                  const targetQ = questions.find(q => q.id === pendingAnswerTargetId);
                  if (!targetQ) return;
                  const boxToRecognize = questionBoxes.find(b => b.id === pendingLinkBoxId);
                  if (!boxToRecognize) return;

                  const linkedBox = {
                    ...boxToRecognize,
                    type: 'answer' as const,
                    linkedQuestionId: targetQ.id,
                    questionNumber: targetQ.number,
                    isSelected: false,
                  };

                  // 保存关联关系
                  setQuestionBoxes(prev => prev.map(b =>
                    b.id === pendingLinkBoxId ? linkedBox : b
                  ));
                  setShowAnswerLinkPicker(false);
                  setPendingLinkBoxId(null);
                  setPendingAnswerTargetId(null);

                  // 触发答案识别
                  setIsProcessing(true);
                  await processAnswerBoxes([linkedBox]);
                }}
                disabled={!pendingAnswerTargetId}
                className={cn(
                  "px-5 py-1.5 text-sm text-white rounded transition-colors",
                  pendingAnswerTargetId
                    ? "bg-emerald-500 hover:bg-emerald-600"
                    : "bg-gray-300 cursor-not-allowed"
                )}
              >
                关联
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 已有框修改类型弹窗 —— 统一弹窗样式 */}
      {editingBoxTypeId && (() => {
        const box = questionBoxes.find(b => b.id === editingBoxTypeId);
        if (!box) return null;
        const currentTypeLabel = box.type === 'answer' ? '仅答案解析' : box.type === 'full' ? '题干+答案解析' : '仅题干';
        return (
        <div
          className="fixed inset-y-0 left-0 bg-black/50 flex items-center justify-center z-[60]"
          style={prdPanelOffsetStyle}
        >
          <div className="bg-white rounded-lg shadow-xl w-[580px] max-w-[92vw]">
            {/* 头部 */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-emerald-50 rounded-t-lg">
              <div>
                <h3 className="font-medium text-emerald-600">修改框类型</h3>
                <p className="text-xs text-gray-400 mt-0.5">当前：<span className="text-emerald-700 font-medium">{currentTypeLabel}</span></p>
              </div>
              <button
                onClick={handleCancelEditBoxType}
                className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* 内容区（加大尺寸确保示例图清晰可读） */}
            <div className="px-8 py-6 grid grid-cols-3 gap-5">
              <button
                onClick={() => handleConfirmEditBoxType('question')}
                className={cn(
                  "group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer",
                  box.type === 'question'
                    ? "border-emerald-500 bg-emerald-50/70"
                    : "border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/50"
                )}
              >
                <div className={cn("w-full aspect-[3/4] rounded-lg overflow-hidden border shadow-sm",
                  box.type === 'question' ? "border-emerald-300 bg-emerald-50/30" : "border-gray-200 bg-white")}>
                  <img src="/box-type-question.jpg" alt="仅题干示例" className="w-full h-full object-contain" />
                </div>
                <span className={cn("text-sm font-bold", box.type === 'question' ? "text-emerald-600" : "text-gray-800 group-hover:text-emerald-600")}>仅题干</span>
              </button>

              <button
                onClick={() => handleConfirmEditBoxType('answer')}
                className={cn(
                  "group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer",
                  box.type === 'answer'
                    ? "border-orange-500 bg-orange-50/70"
                    : "border-gray-200 hover:border-orange-400 hover:bg-orange-50/50"
                )}
              >
                <div className={cn("w-full aspect-[3/4] rounded-lg overflow-hidden border shadow-sm",
                  box.type === 'answer' ? "border-orange-300 bg-orange-50/30" : "border-gray-200 bg-white")}>
                  <img src="/box-type-answer.jpg" alt="仅答案解析示例" className="w-full h-full object-contain" />
                </div>
                <span className={cn("text-sm font-bold", box.type === 'answer' ? "text-orange-600" : "text-gray-800 group-hover:text-orange-600")}>仅答案解析</span>
              </button>

              <button
                onClick={() => handleConfirmEditBoxType('full')}
                className={cn(
                  "group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer",
                  box.type === 'full'
                    ? "border-emerald-500 bg-emerald-50/70"
                    : "border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/50"
                )}
              >
                <div className={cn("w-full aspect-[3/4] rounded-lg overflow-hidden border shadow-sm",
                  box.type === 'full' ? "border-emerald-300 bg-emerald-50/30" : "border-gray-200 bg-white")}>
                  <img src="/box-type-both.jpg" alt="完整示例" className="w-full h-full object-contain" />
                </div>
                <span className={cn("text-sm font-bold", box.type === 'full' ? "text-emerald-600" : "text-gray-800 group-hover:text-emerald-600")}>题干+答案解析</span>
              </button>
            </div>
            {/* 底部按钮 */}
            <div className="flex items-center justify-end gap-3 px-4 py-2.5 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={handleCancelEditBoxType}
                className="px-5 py-1.5 text-sm text-gray-500 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* 帮助弹窗 */}
      {showHelpDialog && (
        <div className="fixed inset-y-0 left-0 bg-black/50 flex items-center justify-center z-50" style={prdPanelOffsetStyle}>
          <div className="bg-white rounded-xl shadow-xl w-[680px] max-w-[92vw] max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-base font-semibold text-gray-800">操作说明</h3>
              <button onClick={() => setShowHelpDialog(false)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><span className="w-1 h-4 rounded-full bg-emerald-500 inline-block" /> 流程总览</h4>
                <div className="flex items-center gap-2 mb-3">
                  {[{ num: 1, label: '上传资料' },{ num: 2, label: '选择识别方式' },{ num: 3, label: '选择识别内容' },{ num: 4, label: '核对识别结果' },{ num: 5, label: '加入试卷' }].map(({ num, label }, i) => (<Fragment key={num}>{i > 0 && <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />}<div className="flex-1 bg-gray-50 rounded-lg p-3 text-center border border-gray-100 min-w-0"><span className="inline-block w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold leading-6 mb-1.5">{num}</span><p className="text-xs font-medium text-gray-700 leading-tight">{label}</p></div></Fragment>))}
                </div>
                <p className="text-xs text-gray-400">按流程完成上传、识别方式选择、结果校对和手动关联，确认无误后加入试卷。</p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><span className="w-1 h-4 rounded-full bg-emerald-500 inline-block" /> 步骤说明</h4>
                <div className="space-y-2">
                  {[{ num: 1, title: '上传资料', desc: '上传、删除或补充资料，单次最多识别 24 页' },{ num: 2, title: '选择识别方式', desc: '按资料内容选择：仅识别题目 / 题目+答案（同文件） / 题目+答案（不同文件）' },{ num: 3, title: '选择识别内容', desc: '在资料页选择或调整要识别的框，确认后点击「开始识别」。' },{ num: 4, title: '核对识别结果', desc: '右侧核对题干、答案和解析；左侧仍可继续框选新增内容并追加识别，题目+答案模式可手动关联答案。' },{ num: 5, title: '加入试卷', desc: '确认题目和答案无误后，点击右上角「加入试卷」进入试卷编辑页面' }].map(({ num, title, desc }) => (<div key={num} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100"><span className="w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{num}</span><div className="min-w-0"><p className="text-sm font-medium text-gray-700">{title}</p><p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p></div></div>))}
                </div>
              </div>
              <div className="flex items-start gap-2 p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                <Sparkles className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-700 leading-relaxed"><span className="font-medium">小贴士：</span>识别过程中可随时更换资料、修改识别方式或补充资料。</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t bg-gray-50 rounded-b-xl">
              <button onClick={() => setShowHelpDialog(false)} className="w-full py-2.5 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition-colors">我知道了</button>
            </div>
          </div>
        </div>
      )}

      {/* 重新上传确认弹窗 */}
      {showReuploadConfirm && (
        <div
          className="fixed inset-y-0 left-0 bg-black/50 flex items-center justify-center z-[60]"
          style={prdPanelOffsetStyle}
        >
          <div className="bg-white rounded-lg shadow-xl w-[360px] max-w-[90vw]">
            {/* 头部 - 复刻上传弹窗样式：浅绿色背景 + 圆形关闭按钮 */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-emerald-50 rounded-t-lg">
              <h3 className="font-medium text-emerald-600">确认更换资料吗？</h3>
              <button onClick={handleReuploadCancel} className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* 内容区 */}
            <div className="px-6 py-12">
              <p className="text-sm text-gray-600 leading-relaxed">更换资料，将清空当前已有的识别结果。</p>
            </div>
            {/* 底部按钮 - 复刻上传弹窗样式：取消灰色边框 + 确定绿色填充 */}
            <div className="flex items-center justify-end gap-3 px-4 py-2 border-t">
              <button
                onClick={handleReuploadCancel}
                className="px-6 py-2 text-sm text-gray-600 rounded border border-gray-300 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleReuploadConfirm}
                className="px-6 py-2 text-sm bg-emerald-500 text-white rounded hover:bg-emerald-600"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片预览弹窗 */}
      {previewImage && (
        <div 
          className="fixed inset-y-0 left-0 bg-black/80 flex items-center justify-center z-[60] cursor-zoom-out"
          style={prdPanelOffsetStyle}
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] overflow-auto">
            <img 
              src={previewImage} 
              alt="题目预览" 
              className="max-w-full max-h-[90vh] object-contain"
            />
            <button 
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
