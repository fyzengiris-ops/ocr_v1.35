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
  Scissors, RotateCcw, Globe, Link2 as Link2Icon, Keyboard, ImageOff
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MathText, MathEditable } from '@/lib/math-render';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { PageNavigator } from '@/components/PageNavigator';
import { processUploadedFile, batchCropImages, cropImage, stitchImagesVertically } from '@/lib/pdf-processor';
import type { PageImage, QuestionBox, RecognizedBlock, RecognitionResult, MatchedQuestion, AnswerMarker } from '@/types/recognition';
import { generateMatchedQuestions, generateAnswerMarkers, extractAnswerFromAnalysis, getValidQuestionTypes } from '@/lib/ai-recognizer';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf-worker/pdf.worker.min.mjs';

// ==================== 工作模式定义 ====================

/** 工作模式：一步识别 vs 分步识别 */
type WorkMode = 'single' | 'stepwise';

/** 分步流程阶段（2步模式） */
type FlowStep =
  | 'select_mode'           // 选择工作模式
  | 'recognize_questions'   // 步骤1：检查框选 & 识别题目
  | 'review';               // 步骤2：匹配答案 & 检查确认

/** 文件角色信息（用于双文件场景） */
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
  onReupload?: () => void; // 重新上传回调，清空当前数据后打开文件选择弹窗
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
  q: { content?: string; answer?: string; analysis?: string; subQuestions?: SubQuestion[] }
): SubQuestion[] {
  // 策略1：优先使用 AI 返回的子题结构
  if (q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
    return q.subQuestions.map((sq, i) => ({
      ...sq,
      id: sq.id || Date.now() + i,
      questionType: sq.questionType || 'single',
      content: formatRecognizedContent(sq.content || ''),
    }));
  }

  // 策略2：前端文本兜底 — 按题干中的子题标记拆分
  const content = q.content || '';
  if (!content.trim()) return [];

  return splitSubQuestionsFromText(content, q.answer || '', q.analysis || '');
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

    // 如果按子题数量拆分失败，尝试按更多序号拆分后取最后 subCount 个
    // 场景：答案包含(1)(2)(3)三个小问，但用户只添加了2个子题(②③)，
    //       此时应该取第(2)(3)部分的答案分配给②③
    if (!answerParts && ansStr) {
      for (let tryCount = subCount + 1; tryCount <= subCount + 5; tryCount++) {
        const tryResult = splitAnswerBySubQuestions(ansStr, tryCount);
        if (tryResult && tryResult.length === tryCount) {
          // 取最后 subCount 个
          answerParts = tryResult.slice(tryCount - subCount);
          break;
        }
      }
    }
    if (!analysisParts && anaStr) {
      for (let tryCount = subCount + 1; tryCount <= subCount + 5; tryCount++) {
        const tryResult = splitAnswerBySubQuestions(anaStr, tryCount);
        if (tryResult && tryResult.length === tryCount) {
          analysisParts = tryResult.slice(tryCount - subCount);
          break;
        }
      }
    }

    // 如果按序号标记拆分失败，使用智能多策略拆分
    // 不再将全部内容塞入第一个子题，而是尝试按段落、换行、均分等方式分发到各子题
    if (!answerParts && !analysisParts && (ansStr || anaStr)) {
      answerParts = smartSplitForSubQuestions(ansStr, subCount);
      analysisParts = smartSplitForSubQuestions(anaStr, subCount);
    } else if (!answerParts && ansStr) {
      answerParts = smartSplitForSubQuestions(ansStr, subCount);
    } else if (!analysisParts && anaStr) {
      analysisParts = smartSplitForSubQuestions(anaStr, subCount);
    }

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
  analysis: string = ''
): SubQuestion[] {
  if (!content) return [];

  // 收集所有子题标记及其位置
  const markers: { index: number; pos: number; num: string; fullMatch: string }[] = [];
  let match: RegExpExecArray | null;
  SUB_Q_MARKERS.lastIndex = 0; // 重置正则

  while ((match = SUB_Q_MARKERS.exec(content)) !== null) {
    const num = match[1] || match[2] || '';
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
      questionType: 'single', // 默认单选题，用户可调整
      content: subContent,
      answer: subAnswer,
      analysis: subAnalysis,
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

  // ===== 策略3：按段落均匀分配（知道总子题数时才有效）=====
  if (!subAnswer && answer && totalMarkers > 1) {
    subAnswer = splitTextEvenly(answer, markerIndex, totalMarkers);
  }
  if (!subAnalysis && analysis && totalMarkers > 1) {
    subAnalysis = splitTextEvenly(analysis, markerIndex, totalMarkers);
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
    new RegExp('\\uFF08(\\d{1,2}\\uFF09\\uFF09[\\s\\u3001.\\u3002,\\uff0c\\uff1a\\uff1a\\)]*', 'g'),
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
      positions.push({ idx: m.index, num: parseInt(m[1], 10) });
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
  onReupload
}: UploadQuestionDialogProps) {
  const router = useRouter();
  // ==================== 状态持久化 key ====================
  const DIALOG_STATE_KEY = 'leke_upload_dialog_state';

  // ==================== 根据学科动态计算有效题型 ====================
  const validQuestionTypes = getValidQuestionTypes(subjectInfo || '');
  const questionTypes = validQuestionTypes;

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
  
  // 重新识别后高亮标记（自动清除）
  const [highlightedQuestionIds, setHighlightedQuestionIds] = useState<Set<number>>(new Set());

  // 答案识别加载状态 & 匹配失败标记
  const [answerProcessingForQuestionIds, setAnswerProcessingForQuestionIds] = useState<Set<number | string>>(new Set());
  const [answerMatchFailedForQuestionIds, setAnswerMatchFailedForQuestionIds] = useState<Set<number | string>>(new Set());

  // 文件角色管理（双文件场景）
  const [fileRoles, setFileRoles] = useState<FileRoleInfo[]>([]);        // 每个文件的角色
  const [showFileRolePanel, setShowFileRolePanel] = useState(false);      // 是否显示文件角色分配面板
  const [activePreviewTab, setActivePreviewTab] = useState<'questions' | 'answers'>('questions'); // 左侧预览区标签

  // ==================== 多页数据 ====================
  const [pageImages, setPageImages] = useState<PageImage[]>([]);

  const [totalPages, setTotalPages] = useState(0);
  const [isPagesLoading, setIsPagesLoading] = useState(true);
  
  // 文件类型信息
  const [fileType, setFileType] = useState<'pdf' | 'image' | 'unknown'>('unknown');
  
  // 画框相关
  const [questionBoxes, setQuestionBoxes] = useState<QuestionBox[]>([]);
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
  const [answers, setAnswers] = useState<AnswerMarker[]>([]);
  const [pendingAnswerTargetId, setPendingAnswerTargetId] = useState<number | null>(null); // 类型弹窗中临时选择的关联题号
  const [showAnswerLinkPicker, setShowAnswerLinkPicker] = useState(false); // 第二步画答案框后的关联题号选择器
  const [pendingLinkBoxId, setPendingLinkBoxId] = useState<string | null>(null); // 待关联的答案框ID
  const [recognitionResult, setRecognitionResult] = useState<RecognitionResult | null>(null);
  
  // 使用 ref 存储最新的 questions，解决闭包问题
  const questionsRef = useRef<Question[]>(questions);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  // UI 状态
  const [viewMode, setViewMode] = useState<'image' | 'recognize'>('image');
  const [isModeChanging, setIsModeChanging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
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
        if (state.flowStep) setFlowStep(state.flowStep);
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

    setIsAutoDetecting(true);
    setAutoDetectProgress('正在调用腾讯云切题服务...');
    setHasAutoDetected(false);

    try {
      const response = await fetch('/api/auto-detect-boxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: newPages }),
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
              isSelected: false,
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
    autoDetectedPageCountRef.current = 0; // 重置切题计数，重新切全部页面
    runAutoDetectBoxes();
  };

  // 腾讯云智能切题：进入 recognize_questions 阶段且页面就绪时自动触发
  useEffect(() => {
    if (
      flowStep === 'recognize_questions' &&
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
      case 'recognize_questions': return flowStage === 'recognizing' ? 'recognizing' : 'cutting';
      case 'review': return 'matched';
      default: return 'cutting';
    }
  }, [flowStep, flowStage]);

  /** 是否允许在左侧画框（步骤1和步骤2都支持） */
  const canDrawBoxes = flowStep === 'recognize_questions' || flowStep === 'review';

  /** 文件角色初始化：当多文件上传时自动设置 */
  useEffect(() => {
    if (uploadedFiles && uploadedFiles.length >= 2 && fileRoles.length === 0 && !workMode) {
      // 多文件且未分配角色时，初始化为未分配状态
      const roles: FileRoleInfo[] = uploadedFiles.map(f => ({
        fileName: f.name,
        role: 'unassigned' as const,
      }));
      setFileRoles(roles);
      // 不自动弹出，等用户选择模式后再处理
    }
  }, [uploadedFiles?.length]);

  /** 选择工作模式后的处理 */
  const handleModeSelect = (mode: WorkMode) => {
    setWorkMode(mode);
    if (mode === 'single') {
      // 一步识别：直接进入题目识别阶段
      setFlowStep('recognize_questions');
      setFlowStage('cutting');
    } else {
      // 分步识别：检查是否需要分配文件角色
      if (uploadedFiles && uploadedFiles.length >= 2) {
        // 多文件：需要先分配角色
        setShowFileRolePanel(true);
      } else {
        // 单文件：直接进入第一步
        setFlowStep('recognize_questions');
        setFlowStage('cutting');
      }
    }
  };

  /** 文件角色分配确认 */
  const handleFileRoleConfirm = () => {
    setShowFileRolePanel(false);
    setFlowStep('recognize_questions');
    setFlowStage('cutting');
  };

  /** 流程步骤切换 */
  const goToStep = (step: FlowStep) => {
    setFlowStep(step);
    switch (step) {
      case 'recognize_questions':
        setFlowStage('cutting');
        // 回退到识别阶段时，重置所有处理状态，确保按钮和操作可用
        setIsProcessing(false);
        setBatchProcessing(false);
        setProcessingMessage('');
        break;
      case 'review':
        setFlowStage('matched');
        // 进入核对阶段时，如果有未匹配答案的题目，定位到第一个
        setTimeout(() => {
          const failedIds = Array.from(answerMatchFailedForQuestionIds);
          if (failedIds.length > 0) {
            const firstEl = document.querySelector(`[data-question-id="${failedIds[0]}"]`) as HTMLElement | null;
            firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            const firstNoAnswer = questions.find(q => q.status === 'no_answer');
            if (firstNoAnswer) {
              const firstEl = document.querySelector(`[data-question-id="${firstNoAnswer.id}"]`) as HTMLElement | null;
              firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }, 200);
        break;
    }
  };

  /** 从步骤2返回步骤1（重新调整框选） */
  const handleBackToQuestions = () => {
    goToStep('recognize_questions');
    setActivePreviewTab('questions');
  };

  /** 返回到录题方式选择（重置流程状态，保留已上传的资料） */
  const handleResetToSelectMode = () => {
    setWorkMode(null);
    setFlowStep('select_mode');
    setFlowStage('cutting');
    // 注意：不清空 pageImages，因为资料仍有效，重新选择模式后可直接复用
    setQuestions([]);
    setActivePreviewTab('questions');
  };

  /** 从步骤1进入步骤2（去匹配答案 & 检查确认） */
  const handleProceedToReview = () => {
    if (questions.length === 0) {
      alert('请先至少识别一道题目');
      return;
    }
    goToStep('review');
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

  // 当前选择统计（只统计未识别的框）
  const selectedCount = questionBoxes.filter(b => b.isSelected).length;
  const matchedCount = questions.filter(q => q.status === 'matched').length;
  const pendingCount = questions.filter(q => q.status === 'pending_confirm').length;
  const noAnswerCount = questions.filter(q => q.status === 'no_answer').length;
  const unlinkedAnswerCount = answers.filter(a => a.status === 'unlinked').length;
  
  // 未识别的框数量
  const unrecognizedCount = questionBoxes.filter(b => !b.recognized).length;

  // 全选/取消全选（只针对未识别的框）
  const handleSelectAll = () => {
    const unrecognizedBoxes = questionBoxes.filter(b => !b.recognized);
    const allSelected = unrecognizedBoxes.length > 0 && unrecognizedBoxes.every(b => b.isSelected);
    setQuestionBoxes(prev => prev.map(b => 
      !b.recognized ? { ...b, isSelected: !allSelected } : b
    ));
  };

  // 鼠标事件处理
  const handleMouseDown = useCallback((e: React.MouseEvent, pageNum: number) => {
    // 允许在可画框阶段画框
    if (!canDrawBoxes) return;
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
  }, [flowStage, canDrawBoxes]);

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
        // 分步模式：按步骤自动设定框类型，跳过类型选择弹窗
        if (workMode === 'stepwise') {
          if (flowStep === 'review') {
            // 第二步：默认答案框，弹出关联题号选择器
            setQuestionBoxes(prev => prev.map(b =>
              b.id === newBoxId ? { ...b, type: 'answer' } : b
            ));
            setPendingAnswerTargetId(null);
            setPendingLinkBoxId(newBoxId);
            setShowAnswerLinkPicker(true);
          }
          // 第一步：默认题干框，无需弹窗（type 已设为 question）
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
	          if (workMode === 'stepwise') {
            if (flowStep === 'review') {
              // 第二步：确保为答案框，弹出关联题号选择器
              setQuestionBoxes(prev => prev.map(b =>
                b.id === boxId ? { ...b, type: 'answer', recognized: false } : b
              ));
              setPendingAnswerTargetId(currentBox?.linkedQuestionId ?? null);
              setPendingLinkBoxId(boxId);
              setShowAnswerLinkPicker(true);
            }
            // 第一步：默认题干框（type 保持 question 即可）
	          }
	      }
    }
	  }
    
    setResizing(null);
    setMoving(null);
  }, [isDrawing, currentBox, resizing, moving]);

  // 删除框
  const handleDeleteBox = (boxId: string) => {
    setQuestionBoxes(prev => prev.filter(b => b.id !== boxId));
    if (selectedBoxId === boxId) setSelectedBoxId(null);
  };

  // 一键清空所有切题框
  const handleClearAllBoxes = () => {
    setQuestionBoxes([]);
    setSelectedBoxId(null);
    setShowClearConfirm(false);
    autoDetectedPageCountRef.current = 0; // 重置切题计数
  };

  // 切换框选中状态
  const handleToggleBox = (boxId: string) => {
    setQuestionBoxes(prev => prev.map(b =>
      b.id === boxId ? { ...b, isSelected: !b.isSelected } : b
    ));
  };

  // 开始调整大小
  const handleResizeStart = (e: React.MouseEvent, boxId: string, direction: string) => {
    e.stopPropagation();
    e.preventDefault();
    const box = questionBoxes.find(b => b.id === boxId);
    setResizing({ boxId, direction, initialW: box?.width ?? 0, initialH: box?.height ?? 0 });
  };

  // 开始移动
  const handleMoveStart = (e: React.MouseEvent, boxId: string) => {
    e.stopPropagation();
    e.preventDefault();

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

  // 处理答案框：裁剪后调用答案提取 API，匹配到已有题目
  const processAnswerBoxes = async (boxes: QuestionBox[]) => {
    setProcessingMessage(`正在裁剪 ${boxes.length} 个答案区域...`);

    // 标记正在处理答案的题目
    const processingIds = new Set<number | string>();
    boxes.forEach(b => {
      if (b.linkedQuestionId) processingIds.add(b.linkedQuestionId);
    });
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
            hasAnswer: !!(q.answer && q.answer.trim().length > 0),
            subQuestions: q.subQuestions?.map(sq => ({
              id: sq.id,
              number: sq.id,
              content: sq.content || '',
              questionType: sq.questionType,
              hasAnswer: !!(sq.answer && sq.answer.trim().length > 0),
            })),
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
                setProcessingMessage(chunk.data.message);
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

                if (preMatched && preMatched.length > 0) {
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
                if (unmatchedAnswers && unmatchedAnswers.length > 0) {
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
                } else {
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
                  setFlowStage('matched');
                  setProcessingMessage('');
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
      setTimeout(() => {
        setIsProcessing(false);
        setFlowStage('matched');
        setProcessingMessage('');
      }, 3000);
    }
  };

  // 批量移入 + AI 识别（按框类型区分：题目框走完整识别，答案框走答案提取）
  const handleBatchMove = async () => {
    // 处理被选中的框（包括未识别和已识别的框）
    // 已识别的框：用户可能调整了范围或想重新识别，先重置为未识别状态再走流程
    const selectedBoxes = questionBoxes.filter(b => b.isSelected);
    if (selectedBoxes.length === 0) return;

    // 将已识别的选中框重置为未识别状态（重新识别）
    const hasRecognizedBoxes = selectedBoxes.some(b => b.recognized);
    if (hasRecognizedBoxes) {
      setQuestionBoxes(prev => prev.map(b =>
        b.isSelected && b.recognized
          ? { ...b, recognized: false, questionNumber: undefined }
          : b
      ));
      // 更新本地引用以使用重置后的状态
      selectedBoxes.forEach(b => { if (b.recognized) { b.recognized = false; b.questionNumber = undefined; } });
    }

    // 按框类型分离：题目框 vs 答案框
    const questionTypeBoxes = selectedBoxes.filter(b => b.type !== 'answer');
    const answerTypeBoxes = selectedBoxes.filter(b => b.type === 'answer');

    // 如果没有题目框也没有答案框，直接返回
    if (questionTypeBoxes.length === 0 && answerTypeBoxes.length === 0) return;

    setIsProcessing(true);
    setFlowStage('recognizing');

    // 根据选中框的类型决定后续流程
    // 核心规则：
    //   - 答案框(type=answer) → 走答案提取模式 → 覆盖已有题目的答案/解析，不新增卡片
    //   - 题干框(type=question)/完整框(type=full) → 走完整识别流程 → 新增/合并题目卡片
    //   - 混合场景 → 分离处理，各走各的路径
    const hasQuestions = questionTypeBoxes.length > 0;
    const hasAnswers = answerTypeBoxes.length > 0;

    // 批量识别+匹配流程：有题目框时启用 batchProcessing，右侧显示进度提示
    if (hasQuestions) {
      setBatchProcessing(true);
    }

    if (hasAnswers && !hasQuestions) {
      // 场景A：纯答案框 → 答案提取模式（覆盖已有题目的答案/解析）
      await processAnswerBoxes(answerTypeBoxes);
      return;
    }

    if (hasQuestions && !hasAnswers) {
      // 场景B：纯题目框 → 完整识别流程（新增/合并题目卡片）
      await recognizeQuestionBoxes(questionTypeBoxes, new Map());
      return;
    }

    // 场景C：混合（既有答案框又有题目框）→ 分离并行处理
    // 答案框走答案提取，题目框走完整识别
    const results = await Promise.allSettled([
      processAnswerBoxes(answerTypeBoxes),
      recognizeQuestionBoxes(questionTypeBoxes, new Map()),
    ]);
    // 检查是否有失败
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.error('混合识别部分失败:', failures.map(f => f.status === 'rejected' ? f.reason : ''));
    }
    return;
  };

  // 题目框完整识别流程（裁剪 → AI识别 → 新增/合并题目卡片）
  // 用于 type=question 或 type=full 的框，会新增或合并题目卡片
  const recognizeQuestionBoxes = async (
    boxes: QuestionBox[],
    existingCroppedImagesMap: Map<string, string>
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
      setProcessingMessage(`正在 AI 识别 ${croppedImages.length} 个题目...`);
      
      // 检查是否有裁剪图片
      if (croppedImages.length === 0) {
        throw new Error('裁剪图片失败，请重试');
      }
      
      console.log('调用 AI 识别，裁剪图片数:', croppedImages.length);

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
                setProcessingMessage(chunk.data.message);
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
                    questionType: q.questionType,
                    showRecognizedContent: q.showRecognizedContent,
                    croppedImageData: croppedImagesMap.get(q.questionBoxId) || q.croppedImageData,
                    optionCount: q.optionCount ?? (choiceQuestionTypes.includes(q.questionType) ? 4 : 0),
                    optionContents: {},
                    subQuestions: recognizeSubQuestions(q),
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
                    
                    if (existingHasContent && (newContentIsShort || newHasAnswer)) {
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
                    next = [...next, ...questionsToAppend];
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

                // 分步模式-题目识别完成后，自动触发全局答案匹配
                if (workMode === 'stepwise' && flowStep === 'recognize_questions') {
                  setTimeout(() => {
                    handleGlobalMatchAnswers(true);
                  }, 100);
                }

                // 根据工作模式决定下一步
                if (workMode === 'single') {
                  // 一步识别：直接进入检查阶段
                  setFlowStep('review');
                  setFlowStage('matched');
                } else if (flowStep === 'recognize_questions') {
                  // 分步模式-题目识别完成：自动跳转到步骤2（匹配 & 确认）
                  setFlowStep('review');
                  setFlowStage('matched');
                } else {
                  // 分步模式-答案匹配完成：进入检查阶段
                  setFlowStep('review');
                  setFlowStage('matched');
                }
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
        // 仍然切换到匹配阶段，保留已有题目
        if (workMode === 'single') {
          setFlowStep('review');
        }
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
        if (workMode === 'single') {
          setFlowStep('review');
        }
        setFlowStage('matched');
      }
    } finally {
      setIsProcessing(false);
      // 仅在成功完成后清除进度信息，报错时保留错误提示
      if (!hasError) {
        setProcessingMessage('');
      }
      // 一步模式识别完成后重置 batchProcessing，避免右侧一直卡在「正在处理中」
      if (workMode === 'single') {
        setBatchProcessing(false);
      }
    }
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
            hasAnswer: !!(q.answer && q.answer.trim().length > 0),
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
                setProcessingMessage(chunk.data.message);
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
      setFlowStage('matched');
      setProcessingMessage('全局匹配完成');
      setTimeout(() => setProcessingMessage(''), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '全局匹配失败';
      console.error('[全局匹配答案失败]', err);
      setProcessingMessage(`全局匹配失败: ${message}`);
      setTimeout(() => {
        setIsProcessing(false);
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
    setQuestions([]);
    setAnswers([]);
    setRecognitionResult(null);
    setFlowStage('cutting');
    setSelectedBoxId(null);
    setPageImages([]);
    setTotalPages(0);
    processedFilesCountRef.current = 0;
    autoDetectedPageCountRef.current = 0; // 重置切题计数
    setHasAutoDetected(false);  // 重置切题标记，重新上传后需再次触发切题
    setIsAutoDetecting(false);
    // 通知父组件打开文件选择弹窗
    if (onReupload) {
      onReupload();
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
        questionType: '单选题',
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
    if (questions.length > 0) {
      // 将数据写入 sessionStorage，供 paper-edit 页面读取
      try {
        const paperData = {
          pageImages: pageImages.map(p => ({
            data: p.imageData,
            sourceFileIndex: p.sourceFileIndex || 0,
            pageNumber: p.pageNumber,
          })),
          questions: questions.map(q => ({
            id: String(q.id),
            number: q.number,
            questionType: q.questionType,
            content: q.content,
            answer: q.answer || '',
            analysis: q.analysis || '',
          })),
          subjectInfo: subjectInfo || '',
        };
        sessionStorage.setItem('paperEditData', JSON.stringify(paperData));
      } catch (e) {
        console.error('[handleAddToPaper] sessionStorage 写入失败:', e);
      }
      onAddToPaper(questions);
    }
  };

  // 加入试卷前保存状态，以便「返回录题」时恢复
  const handleAddToPaperWithSave = () => {
    saveDialogState();
    handleAddToPaper();
  };

  return (
    <div className="fixed inset-0 bg-[#f0f4f7] z-50 flex flex-col">
      {/* ==================== 顶部操作栏 ==================== */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
        <h3 className="text-emerald-600 font-medium">识别作业资料</h3>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowHelpDialog(true)} className="flex items-center gap-1 px-2 py-1 text-sm text-gray-500 hover:text-gray-700">
            <HelpCircle className="w-4 h-4" />操作说明
          </button>
          <button
            onClick={() => {
              // 关闭弹窗时清理持久化状态，回到首页以便用户开始新一轮识别流程
              try {
                sessionStorage.removeItem(DIALOG_STATE_KEY);
                sessionStorage.removeItem('paperEditData');
              } catch { /* ignore */ }
              onClose();
              router.push('/');
            }}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
          >
            关闭
          </button>
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

      {/* ==================== 进度条 ==================== */}
      {(workMode || flowStep === 'select_mode') && (
        <div className="bg-white border-b px-4 py-2">
          <div className="flex items-center gap-1">
            {workMode === 'single' ? (
              // 一步识别模式：4步（带操作提示）
              <div className="flex items-start gap-1">
                {([
                  { label: '资料场景方式选择', hint: '请根据资料选择识别方式' },
                  { step: 'recognize_questions' as FlowStep, label: '框选&识别', hint: '在左侧资料上画框，调整范围后点击「识别题目」' },
                  { step: 'review' as FlowStep, label: '核查题目信息', hint: '检查题目识别结果' },
                  { step: null as FlowStep | null, label: '加入试卷', hint: '确认无误后点击右上角「加入试卷」' },
                ]).map(({ step, label, hint }, idx) => {
                  if (idx === 0) {
                    // 第一步「资料场景方式选择」
                    const isSelectMode = flowStep === 'select_mode';
                    return (
                      <Fragment key={idx}>
                        <div className="flex flex-col gap-0.5">
                          {isSelectMode ? (
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
                              <button
                                onClick={handleResetToSelectMode}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 cursor-pointer hover:bg-gray-200 active:scale-95 transition-all"
                              >
                                <span className="flex items-center gap-1">
                                  <ArrowLeft className="w-3 h-3" />
                                  1. {label}
                                </span>
                              </button>
                              <span className="text-[10px] px-1 leading-tight text-gray-400">{hint}</span>
                            </>
                          )}
                        </div>
                      </Fragment>
                    );
                  }
                  if (!step) {
                    // 第四步「加入试卷」
                    return (
                      <Fragment key={idx}>
                        <ArrowRight className={cn("w-4 h-4 mt-2", flowStep === 'review' ? "text-emerald-500" : "text-gray-300")} />
                        <div className="flex flex-col gap-0.5">
                          <span className={cn("px-3 py-1.5 rounded-lg text-xs font-medium", flowStep === 'review' ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400")}>
                            4. {label}
                          </span>
                          <span className="text-[10px] px-1 leading-tight text-gray-400">{hint}</span>
                        </div>
                      </Fragment>
                    );
                  }
                  const isCurrent = flowStep === step;
                  const isPast = ['recognize_questions', 'review'].indexOf(flowStep) > idx - 1;
                  return (
                    <Fragment key={step}>
                      <ArrowRight className={cn("w-4 h-4 mt-2", isPast ? "text-emerald-500" : "text-gray-300")} />
                      <div className="flex flex-col gap-0.5">
                        <span className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-medium",
                          isCurrent
                            ? "bg-emerald-500 text-white shadow-md shadow-emerald-200 ring-2 ring-emerald-300 cursor-default"
                            : isPast
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-gray-100 text-gray-400"
                        )}>
                          <span className="flex items-center gap-1">
                            {isPast && <Check className="w-3 h-3" />}
                            {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                            {idx + 1}. {label}
                          </span>
                        </span>
                        <span className={cn(
                          "text-[10px] px-1 leading-tight",
                          isCurrent ? "text-gray-500" : isPast ? "text-emerald-600" : "text-gray-400"
                        )}>{hint}</span>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            ) : (
              // 分步识别模式：4步（可点击切换，带操作提示）
              <div className="flex items-start gap-1">
                {([
                  { label: '资料场景方式选择', hint: '请根据资料选择识别方式' },
                  { step: 'recognize_questions' as FlowStep, label: '框选&识别', hint: '在左侧资料上画框，调整范围后点击「识别题目」' },
                  { step: 'review' as FlowStep, label: '核对题目和答案信息', hint: '核对题目和答案识别信息' },
                ]).map(({ step, label, hint }, idx) => {
                  if (idx === 0) {
                    // 第一步「资料场景方式选择」
                    const isSelectMode = flowStep === 'select_mode';
                    return (
                      <Fragment key={idx}>
                        <div className="flex flex-col gap-0.5">
                          {isSelectMode ? (
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
                              <button
                                onClick={handleResetToSelectMode}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 cursor-pointer hover:bg-gray-200 active:scale-95 transition-all"
                              >
                                <span className="flex items-center gap-1">
                                  <ArrowLeft className="w-3 h-3" />
                                  1. {label}
                                </span>
                              </button>
                              <span className="text-[10px] px-1 leading-tight text-gray-400">{hint}</span>
                            </>
                          )}
                        </div>
                      </Fragment>
                    );
                  }
                  const isCurrent = flowStep === step;
                  const isPast = ['recognize_questions', 'review'].indexOf(flowStep) > idx - 1;
                  const canClick = isPast || idx === 1 || (idx === 2 && questions.length > 0);
                  return (
                    <Fragment key={step}>
                      <ArrowRight className={cn("w-4 h-4 mt-2", isPast ? "text-emerald-500" : "text-gray-300")} />
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => { if (canClick && step) goToStep(step); }}
                          disabled={!canClick}
                          title={canClick ? `点击切换到：${label}` : '请先识别至少一道题目'}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                            isCurrent
                              ? "bg-emerald-500 text-white shadow-md shadow-emerald-200 ring-2 ring-emerald-300 cursor-default"
                              : isPast
                                ? "bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200 active:scale-95"
                                : !canClick
                                  ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                                  : "bg-gray-100 text-gray-400 cursor-pointer hover:bg-gray-200 active:scale-95"
                          )}
                        >
                          <span className="flex items-center gap-1">
                            {isPast && <Check className="w-3 h-3" />}
                            {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                            {idx + 1}. {label}
                          </span>
                        </button>
                        <span className={cn(
                          "text-[10px] px-1 leading-tight",
                          isCurrent ? "text-gray-500" : isPast ? "text-emerald-600" : "text-gray-400"
                        )}>{hint}</span>
                      </div>
                    </Fragment>
                  );
                })}
                <ArrowRight className={cn("w-4 h-4 mt-2", flowStep === 'review' ? "text-emerald-500" : "text-gray-300")} />
                <div className="flex flex-col gap-0.5">
                  <span className={cn("px-3 py-1.5 rounded-lg text-xs font-medium", flowStep === 'review' ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400")}>4. 加入试卷</span>
                  <span className="text-[10px] px-1 leading-tight text-gray-400">确认无误后点击右上角「加入试卷」</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 模式选择面板（第一步）==================== */}
      {flowStep === 'select_mode' && (
        <div className="flex-1 overflow-auto p-6 flex flex-col items-center bg-[#f0f4f7]">
          <div className="max-w-5xl w-full flex flex-col h-full">

            <h2 className="text-lg font-medium text-gray-800 mb-2 text-center">请选择识别方式</h2>
            <p className="text-sm text-gray-500 mb-6 text-center">建议根据您的资料内容，选择合适的处理流程</p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* 仅识别题目 */}
              <button
                onClick={() => handleModeSelect('single')}
                className="group p-5 bg-white rounded-xl border-2 border-gray-200 hover:border-emerald-400 hover:shadow-lg transition-all text-left overflow-hidden"
              >
                <div className="flex items-start gap-3 mb-3 h-[52px]">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors shrink-0">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <div className="font-medium text-gray-800 whitespace-nowrap">仅识别题目</div>
                    <div className="text-xs text-gray-400 leading-relaxed">适合只包含题目，不包含答案的资料内容</div>
                  </div>
                </div>
                {/* 示例图 - 固定高度容器 */}
                <div className="rounded-lg overflow-hidden bg-gray-50 border border-gray-100 h-[320px] flex items-center justify-center">
                  <img
                    src="/mode-single-example.jpg"
                    alt="纯题目资料示例：仅包含题目的试卷"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              </button>

              {/* 识别题目和答案 */}
              <button
                onClick={() => handleModeSelect('stepwise')}
                className="group p-5 bg-white rounded-xl border-2 border-gray-200 hover:border-emerald-400 hover:shadow-lg transition-all text-left overflow-hidden"
              >
                <div className="flex items-start gap-3 mb-3 h-[52px]">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center group-hover:bg-purple-100 transition-colors shrink-0">
                    <Layers className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <div className="font-medium text-gray-800 whitespace-nowrap">识别题目和答案</div>
                    <div className="text-xs text-gray-400 leading-relaxed">适合即包含题目，也包含答案或解析的资料内容</div>
                  </div>
                </div>
                {/* 示例图 - 固定高度容器，双图并排 */}
                <div className="grid grid-cols-2 gap-1.5 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 p-1.5 h-[320px]">
                  <img
                    src="/mode-stepwise-example-1.jpg"
                    alt="含答案解析资料示例1"
                    className="w-full h-full object-contain rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <img
                    src="/mode-stepwise-example-2.jpg"
                    alt="含答案解析资料示例2"
                    className="w-full h-full object-contain rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              </button>
            </div>

            {/* 已上传文件信息 */}
            {uploadedFiles && uploadedFiles.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-3 mt-3">
                <div className="text-xs text-gray-500 mb-2">已上传的文件：</div>
                <div className="space-y-1">
                  {uploadedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span>{f.name}</span>
                      <span className="text-xs text-gray-400">({(f.size / 1024).toFixed(1)}KB)</span>
                    </div>
                  ))}
                </div>
                {uploadedFiles.length >= 2 && (
                  <p className="text-xs text-amber-600 mt-2">检测到多个文件，请分别指定文件用途</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 文件角色分配弹窗（双文件场景）==================== */}
      {showFileRolePanel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-[90vw]">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-emerald-50 rounded-t-lg">
              <h3 className="font-medium text-emerald-600">指定文件用途</h3>
              <button onClick={() => setShowFileRolePanel(false)} className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-600 mb-4">检测到您上传了 {uploadedFiles?.length || 0} 个文件，请分别指定用途：</p>
              <div className="space-y-3">
                {fileRoles.map((role, idx) => (
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
                          setFileRoles(prev => prev.map((r, i) => i === idx ? { ...r, role: 'question' as const } : r));
                          // 如果其他文件是 question，自动设为 answer
                          setFileRoles(prev => prev.map((r, i) => 
                            i !== idx && r.role === 'question' ? { ...r, role: 'answer' as const } : r
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
                          setFileRoles(prev => prev.map((r, i) => i === idx ? { ...r, role: 'answer' as const } : r));
                          // 如果其他文件是 answer，自动设为 question
                          setFileRoles(prev => prev.map((r, i) => 
                            i !== idx && r.role === 'answer' ? { ...r, role: 'question' as const } : r
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
                ))}
              </div>

            </div>
            <div className="flex items-center justify-end gap-3 px-4 py-3 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setShowFileRolePanel(false)}
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
      {flowStep !== 'select_mode' && (
      <>

      {/* 匹配结果提示（仅分步模式检查阶段显示） */}
      {workMode === 'stepwise' && flowStep === 'review' ? (flowStage === 'matched' && flowStep === 'review') && (
        <div className="bg-orange-50 border-b border-orange-200">
          {!matchBannerCollapsed ? (
            <div className="py-2 px-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-orange-800">
                  请检查答案匹配情况：共 {questions.length} 题，已匹配答案 {matchedCount} 题，未匹配答案 {pendingCount + noAnswerCount} 题
                </span>
              </div>
              <div className="flex items-center gap-2">
                {unlinkedAnswerCount > 0 && (
                  <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">{unlinkedAnswerCount}个答案未关联</span>
                )}
                <button
                  onClick={() => setMatchBannerCollapsed(true)}
                  className="p-1 hover:bg-orange-100 rounded text-orange-400 hover:text-orange-600"
                  title="收起"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="py-1 px-4 flex items-center justify-between">
              <button
                onClick={() => setMatchBannerCollapsed(false)}
                className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-700"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>共 {questions.length} 题，已匹配 {matchedCount} 题</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* 主内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：资料预览区 */}
        <div className="w-[46%] bg-gray-200 flex flex-col relative">
          {/* ====== 文件标签切换（双文件分步模式）====== */}
          {workMode === 'stepwise' && fileRoles.length >= 2 && fileRoles.some(r => r.role === 'answer') && (
            <div className="flex items-center bg-white border-b">
              {fileRoles.map((role, idx) => {
                const isActive = (activePreviewTab === 'questions' && role.role === 'question') ||
                                 (activePreviewTab === 'answers' && role.role === 'answer');
                const isDisabled = flowStep === 'recognize_questions' && role.role === 'answer';
                return (
                  <button
                    key={idx}
                    disabled={isDisabled}
                    onClick={() => {
                      setActivePreviewTab(role.role === 'question' ? 'questions' : 'answers');
                      // 滚动到该文件的第一页
                      const firstPageIdx = pageImages.findIndex(p => p.sourceFileIndex === idx);
                      if (firstPageIdx !== -1 && containerRef.current) {
                        const targetEl = containerRef.current.querySelector(`[data-page="${firstPageIdx + 1}"]`);
                        if (targetEl) {
                          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }
                    }}
                    className={cn(
                      "flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5",
                      isActive 
                        ? role.role === 'question' 
                          ? "border-emerald-500 text-emerald-600 bg-emerald-50/50"
                          : "border-emerald-500 text-emerald-600 bg-emerald-50/50"
                        : isDisabled
                          ? "border-transparent text-gray-300 cursor-not-allowed"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    )}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate max-w-[120px] cursor-default">{role.fileName}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-max break-all">
                      {role.fileName}
                    </TooltipContent>
                  </Tooltip>
                    <span className={cn(
                      "text-[10px] px-1 py-0.5 rounded",
                      role.role === 'question' ? "bg-emerald-100 text-emerald-600" : "bg-emerald-100 text-emerald-600"
                    )}>
                      {role.role === 'question' ? '题目' : '答案'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 顶部工具栏 - 根据阶段动态变化 */}
          <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
            <div className="flex items-center gap-3">
              {/* 框类型选择器已移至画框结束后弹窗 */}

              {flowStep !== 'review' && (
                <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={questionBoxes.length > 0 && questionBoxes.every(b => b.isSelected)}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-emerald-500 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">全选</span>
                </label>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* 识别题目/答案按钮（根据选中框的类型自动区分） */}
              {(flowStep === 'recognize_questions' || workMode === 'single') && (
                <button
                  onClick={handleBatchMove}
                  disabled={selectedCount === 0 || isProcessing}
                  className={cn(
                    "px-3 py-1 rounded text-sm flex items-center gap-1 whitespace-nowrap",
                    selectedCount > 0 && !isProcessing ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  )}
                >
                  <Sparkles className="w-4 h-4" />
                  识别题目({selectedCount})
                </button>
              )}

	              {/* 全局匹配答案按钮（仅分步模式-识别题目阶段显示，已有答案时隐藏） */}
              {workMode !== 'single' && questions.length > 0 && flowStep === 'recognize_questions' && !questions.some(q => q.answer || q.analysis) && (
                <button
                  onClick={() => handleGlobalMatchAnswers()}
                  disabled={isProcessing}
                  className={cn(
                    "flex items-center gap-1 px-4 py-1.5 text-sm font-medium rounded whitespace-nowrap transition-all",
                    isProcessing
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed border border-gray-300"
                      : "text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 border border-indigo-300"
                  )}
                  title="AI 从整页资料中自动定位答案区域，匹配到已有题目"
                >
                  <Globe className="w-4 h-4" /> 全局匹配答案{isProcessing && ' 中...'}
                </button>
              )}

              {/* 继续上传 */}
              {onContinueUpload && (
                <button
                  onClick={onContinueUpload}
                  className="flex items-center gap-1 px-3 py-1 text-sm text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded whitespace-nowrap"
                  title="继续上传资料"
                >
                  <CloudUpload className="w-4 h-4" />继续上传
                </button>
              )}
              {/* 重新上传（分步模式review阶段隐藏） */}
              {!(workMode === 'stepwise' && flowStep === 'review') && (
                <button onClick={handleReupload} className="flex items-center gap-1 px-3 py-1 text-sm text-gray-600 hover:text-gray-800 whitespace-nowrap">
                  <RefreshCw className="w-4 h-4" />重新上传
                </button>
              )}
            </div>
          </div>

          {/* 多页导航 - 移除，改为滚动查看 */}

          {/* 操作提示 - 根据阶段动态显示 */}
          {flowStep === 'recognize_questions' && (
            <div className="px-4 py-2 bg-gray-50 border-b">
              <p className="text-xs text-gray-500">
                {`在资料上拖拽鼠标框选题目区域（共 ${totalPages} 页，滚动查看所有页面）`}
              </p>
              {/* 分步模式提示 */}

              {/* 腾讯云切题状态栏 */}
              {flowStep === 'recognize_questions' && hasAutoDetected && !isAutoDetecting && (
                <div className={cn(
                  "flex items-center gap-2 mt-1.5 px-3 py-1.5 rounded-lg text-xs",
                  questionBoxes.length > 0
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                    : "bg-amber-50 border border-amber-200 text-amber-700"
                )}>
                  <Sparkles className={cn("w-3.5 h-3.5 flex-shrink-0", questionBoxes.length > 0 ? "text-emerald-500" : "text-amber-500")} />
                  <span className="flex-1">
                    {questionBoxes.filter(b => b.isSelected).length > 0
                      ? `完成 ${questionBoxes.filter(b => b.isSelected).length} 个题目区域切题。如有遗漏或偏差，请手动调整`
                      : autoDetectProgress || '未检测到内容区域'}
                  </span>
                  {questionBoxes.length > 0 && (
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center gap-0.5 px-2 py-0.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded border border-red-200 transition-colors flex-shrink-0"
                      title="删除所有切题框"
                    >
                      <Trash2 className="w-3 h-3" /> 一键清空
                    </button>
                  )}
                </div>
              )}

              {/* 一键清空切题框确认弹窗 */}
              <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
                <AlertDialogContent className="max-w-sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认清空所有切题框？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将删除全部 {questionBoxes.length} 个切题框，此操作不可撤销。
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

            </div>
          )}
          {workMode === 'stepwise' && flowStep === 'review' && (
            <div className="px-4 py-2 bg-gray-50 border-b">
              <p className="text-xs text-emerald-600">
                如答案匹配不准确，支持在左侧资料区手动框选答案、关联题号进行识别
              </p>
            </div>
          )}

          {/* 资料预览区 - 多页滚动显示 */}
          <div
            ref={containerRef}
            className="flex-1 overflow-auto p-4 flex flex-col items-center gap-4"
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
              pageImages.map((pageImage, pageIndex) => {
                const pageNum = pageIndex + 1;
                const pageBoxes = questionBoxes.filter(box =>
                  box.pageNumber === pageNum ||
                  (box.endPageNumber === pageNum && box.endPageHeight) // 跨页框的第二部分
                );
                const pageAnswers = answers.filter(a => a.pageNumber === pageNum);
                
                return (
                  <div
                    key={pageNum}
                    data-page={pageNum}
                    className="relative bg-white shadow-lg"
                    style={{
                      width: displayWidth,
                      transform: `scale(${zoom / 100})`,
                      transformOrigin: 'top center'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, pageNum)}
                  >
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

                    {/* 题目框 - 切图阶段显示可编辑框（识别题目阶段） */}
                    {flowStep === 'recognize_questions' && (
                      <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded z-40 pointer-events-none">
                        本页 {pageBoxes.length} 框 / 共 {questionBoxes.length} 框
                      </div>
                    )}
                    {flowStep === 'recognize_questions' && pageBoxes.map((box) => {
                      const renderStyle = getBoxRenderStyle(box, pageNum);
                      if (!renderStyle) return null;
                      return (
                      <div
                        key={`${box.id}-${pageNum}`}
                        className={cn("question-box absolute transition-colors", box.isSelected ? "border-emerald-500" : "border-gray-400")}
                        style={{
                          left: renderStyle.left,
                          top: renderStyle.top,
                          width: renderStyle.width,
                          height: renderStyle.height,
                          borderWidth: '2px',
                          borderStyle: 'solid',
                          backgroundColor: box.isSelected
                            ? 'rgba(16, 185, 129, 0.1)'
                            : box.type === 'answer'
                              ? 'rgba(249, 115, 22, 0.06)'
                              : 'rgba(16, 185, 129, 0.06)',
                        }}
                      >
                        {/* 只在起始页部分显示选中/删除/调整手柄 */}
                        {!renderStyle.isCrossPagePart || box.pageNumber === pageNum ? (
                          <>
                            {/* 左上角行：勾选按钮 + 类型标签 */}
                            <div className="absolute -top-2 -left-2 flex items-center gap-1 z-20">
                              {/* 勾选按钮 */}
                              <div
                                className={cn("w-5 h-5 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0", box.isSelected ? "bg-emerald-500" : "bg-white border-2 border-gray-400")}
                                onClick={(e) => { e.stopPropagation(); handleToggleBox(box.id); }}
                              >
                                {box.isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                            </div>

                            {/* 移动区域 */}
                            <div className="absolute inset-0 cursor-move" onMouseDown={(e) => handleMoveStart(e, box.id)} />

                            {/* 右上角列：删除按钮 + 待识别标签 */}
                            <div className="absolute -top-2 -right-2 flex flex-col items-center gap-1 z-20">
                              {/* 删除按钮 */}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteBox(box.id); }}
                                className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
                              >
                                <X className="w-3 h-3 text-white" />
                              </button>
                              {/* 待识别标签（删除按钮下方） */}
                              {!box.recognized && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-400 text-yellow-900 whitespace-nowrap shadow-sm">
                                  待识别
                                </span>
                              )}
                            </div>

                            {/* 调整大小手柄 */}
                            <div className="resize-handle absolute -top-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-nw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'nw')} />
                            <div className="resize-handle absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-ne-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'ne')} />
                            <div className="resize-handle absolute -bottom-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-sw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'sw')} />
                            <div className="resize-handle absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-se-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'se')} />
                          </>
                        ) : (
                          /* 跨页第二部分：只显示移动区域 */
                          <div className="absolute inset-0 cursor-move" onMouseDown={(e) => handleMoveStart(e, box.id)} />
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

                    {/* 题目框 - review阶段（支持继续画框+识别答案） */}
                    {flowStep === 'review' && pageBoxes.map((box) => {
                      const renderStyle = getBoxRenderStyle(box, pageNum);
                      if (!renderStyle) return null;
                      const isRecognized = box.recognized;
                      const isQuestion = box.type === 'question';
                      const isAnswer = box.type === 'answer';
                      const isStartPage = box.pageNumber === pageNum;
                      
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
                                        {isQuestion && `第${box.questionNumber || '?'}题`}
                                        {isAnswer && `第${box.questionNumber || '?'}题答案`}
                                        {box.type === 'full' && `第${box.questionNumber || '?'}题`}
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
                                      {workMode !== 'stepwise' && (
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
                          className={cn("question-box absolute transition-colors", box.isSelected ? "border-emerald-500" : "border-gray-400")}
                          style={{
                            left: renderStyle.left,
                            top: renderStyle.top,
                            width: renderStyle.width,
                            height: renderStyle.height,
                            borderWidth: '2px',
                            borderStyle: 'solid',
                            backgroundColor: box.isSelected
                                ? 'rgba(16, 185, 129, 0.1)'
                                : box.type === 'answer'
                                  ? 'rgba(249, 115, 22, 0.06)'
                                  : 'rgba(16, 185, 129, 0.06)',
                          }}
                        >
                          {/* 只在起始页部分显示操作按钮 */}
                          {isStartPage ? (
                            <>
                              {/* 左上角行：勾选按钮 + 类型标签 */}
                              <div className="absolute -top-2 -left-2 flex items-center gap-1 z-20">
                                {/* 勾选按钮 */}
                                <div
                                  className={cn("w-5 h-5 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0", box.isSelected ? "bg-emerald-500" : "bg-white border-2 border-gray-400")}
                                  onClick={(e) => { e.stopPropagation(); handleToggleBox(box.id); }}
                                >
                                  {box.isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                              </div>

                              {/* 移动区域 */}
                              <div className="absolute inset-0 cursor-move" onMouseDown={(e) => handleMoveStart(e, box.id)} />

                              {/* 右上角列：删除按钮 + 待识别标签 */}
                              <div className="absolute -top-2 -right-2 flex flex-col items-center gap-1 z-20">
                                {/* 删除按钮 */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteBox(box.id); }}
                                  className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
                                >
                                  <X className="w-3 h-3 text-white" />
                                </button>
                                {/* 待识别标签（删除按钮下方） */}
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-400 text-yellow-900 whitespace-nowrap shadow-sm">
                                  待识别
                                </span>
                              </div>

                              {/* 调整大小手柄 */}
                              <div className="resize-handle absolute -top-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-nw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'nw')} />
                              <div className="resize-handle absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-ne-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'ne')} />
                              <div className="resize-handle absolute -bottom-1 -left-1 w-3 h-3 bg-emerald-500 rounded cursor-sw-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'sw')} />
                              <div className="resize-handle absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded cursor-se-resize z-10" onMouseDown={(e) => handleResizeStart(e, box.id, 'se')} />
                            </>
                          ) : (
                            /* 跨页第二部分：只显示移动区域 */
                            <div className="absolute inset-0 cursor-move" onMouseDown={(e) => handleMoveStart(e, box.id)} />
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
                    {(flowStep === 'review' || (workMode === 'single' && flowStage === 'matched')) && pageAnswers.map((answer) => {
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

          {/* 缩放控制 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white rounded-lg shadow px-3 py-1.5">
            <button onClick={() => setZoom(Math.max(50, zoom - 10))} className="p-1 hover:bg-gray-100 rounded"><ZoomOut className="w-4 h-4 text-gray-600" /></button>
            <span className="text-xs text-gray-600 w-12 text-center">{zoom}%</span>
            <button onClick={() => setZoom(Math.min(150, zoom + 10))} className="p-1 hover:bg-gray-100 rounded"><ZoomIn className="w-4 h-4 text-gray-600" /></button>
          </div>
        </div>

        {/* 右侧：题目卡片区 */}
        <div className="w-[54%] bg-[#f0f4f7] flex flex-col border-l">
          {batchProcessing ? (
            /* ====== 批量识别/匹配进度提示 ====== */
            <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden">
              <div className="border rounded-lg p-6 max-w-md w-full bg-emerald-50 border-emerald-200 flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                <p className="text-sm font-medium text-emerald-800 text-center">
                  {processingMessage || '正在处理中...'}
                </p>
              </div>
            </div>
          ) : (flowStep === 'recognize_questions' && questions.length === 0 && !isProcessing) ? (
            /* ====== 空状态引导（识别题目阶段）====== */
            <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden">
              <div className="border rounded-lg p-4 max-w-md w-full bg-emerald-50 border-emerald-200">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-sm font-medium text-emerald-800">
                    {workMode === 'stepwise'
                      ? '框选题目后点击「识别题目」，小乐会为您自动识别'
                      : '框选题目后点击「识别题目」，小乐会为您自动识别题目'
                    }
                  </p>
                </div>
                {workMode === 'stepwise' && (
                  <p className="text-xs text-emerald-600">
                    支持：跨页答案识别、从解析中提取答案、答案页分离识别
                  </p>
                )}
              </div>

              {/* 已选择数量提示 */}
              {selectedCount > 0 && (
                <div className="mt-4 text-sm text-gray-600 bg-white px-4 py-2 rounded-lg shadow-sm">
                  已选择 <span className="font-medium text-emerald-600">{selectedCount}</span> 个识别框
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 模式切换 */}
              <div className="flex items-center justify-between px-4 py-2 border-b bg-white">
                <div className="flex items-center gap-2">
                  <button onClick={() => handleModeChange('image')} className={cn("px-3 py-1 rounded text-sm", viewMode === 'image' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600')}>图片模式</button>
                  <button onClick={() => handleModeChange('recognize')} className={cn("px-3 py-1 rounded text-sm", viewMode === 'recognize' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600')}>识别模式</button>
                </div>
                {viewMode === 'recognize' && <span className="text-xs text-orange-500 bg-orange-50 px-2 py-0.5 rounded">请注意甄别AI识别内容</span>}
              </div>

              {/* 题目列表 */}
              <div ref={questionListRef} className="flex-1 overflow-y-auto p-3 relative">
                {isModeChanging && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                    <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                  </div>
                )}
                
                <div className="space-y-3">
                  {questions.map((question) => (
                    <div
                      key={question.id}
                      id={`question-card-${question.id}`}
                      data-question-id={question.id}
                      className={cn(
                        "bg-white rounded-lg shadow-sm overflow-hidden transition-all",
                        highlightedQuestionId === question.id && "ring-2 ring-blue-500 shadow-md",
                        highlightedQuestionIds.has(question.id) && "ring-2 ring-yellow-400 bg-yellow-50"
                      )}
                    >
                      {/* 题目头部 */}
                      <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                        <div className="flex items-center gap-2">
                          {/* 可编辑的题号 / 未关联答案标签 */}
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
                          {/* 答案匹配失败提示 */}
                          {answerMatchFailedForQuestionIds.has(String(question.id)) && (
                            <span className="text-xs text-red-500 font-medium">匹配失败，请您手动调整答案解析</span>
                          )}
                          {workMode !== 'single' && (
                            <>
                              {/* 答案解析匹配状态标签 */}
                              {(() => {
                                // 手动录入后不显示匹配标签
                                if (question.answerSource === 'manual') {
                                  return null;
                                }
                                // 未匹配到答案解析
                                if (answerMatchFailedForQuestionIds.has(String(question.id))) {
                                  return (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                                      未匹配到答案解析，可在左侧框选答案重新识别
                                    </span>
                                  );
                                }
                                // 复合题：检查所有子题的答案和解析
                                if (question.subQuestions && question.subQuestions.length > 0) {
                                  const hasAnswer = question.subQuestions.some(s => {
                                    const ans = s.answer?.trim() || '';
                                    return ans && !/^第\d+空答案$/.test(ans) && ans !== '暂无答案';
                                  });
                                  const hasAnalysis = question.subQuestions.some(s => s.analysis && s.analysis.trim());
                                  if (hasAnswer && hasAnalysis) {
                                    return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">答案解析已匹配</span>;
                                  } else if (hasAnswer) {
                                    return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">答案已匹配</span>;
                                  } else if (hasAnalysis) {
                                    return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">解析已匹配</span>;
                                  }
                                  return null;
                                }
                                // 普通题
                                // 检查答案是否有效（不为空且不是占位符）
                                const answerText = question.answer?.trim() || '';
                                const hasAnswer = answerText && !/^第\d+空答案$/.test(answerText) && answerText !== '暂无答案';
                                const hasAnalysis = question.analysis && question.analysis.trim();
                                if (hasAnswer && hasAnalysis) {
                                  return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">答案解析已匹配</span>;
                                } else if (hasAnswer) {
                                  return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">答案已匹配</span>;
                                } else if (hasAnalysis) {
                                  return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">解析已匹配</span>;
                                }
                                return null;
                              })()}
                              {question.answerSource === 'extracted' && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">从解析提取</span>
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
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
                          <button onClick={() => handleDeleteQuestion(question.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500" title="删除题目">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      {/* 题目内容 */}
                      <div className="p-3">
                        {/* 题型选择器行 */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
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
                                <Plus className="w-3 h-3" /> 子题结构
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
                              <Switch
                                checked={question.showRecognizedContent}
                                onCheckedChange={() => handleToggleRecognizedContent(question.id)}
                                className="scale-75"
                              />
                              使用图片
                            </div>
                          )}
                        </div>

                        {/* 复合题：子题结构标记（紧凑行，紧跟题型选择器） */}
                        {compoundQuestionTypes.includes(question.questionType) && (question.subQuestions || []).length > 0 && (
                          <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-gray-50 rounded border">
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
                            <button
                              onClick={() => handleAddSubQuestion(question.id)}
                              className="flex items-center gap-0.5 px-1 py-0.5 text-[11px] text-emerald-600 border border-dashed border-emerald-300 rounded hover:bg-emerald-50"
                            >
                              <Plus className="w-2.5 h-2.5" /> 添加
                            </button>
                          </div>
                        )}

                        {/* 题目图片/文本内容 */}
                        <div className="space-y-2">
                            {viewMode === 'image' || (viewMode === 'recognize' && question.showRecognizedContent) ? (
                          <div className="mb-3 relative group/img">
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
                                      <button onClick={handleConfirmCrop} className="flex items-center gap-1 hover:text-emerald-300 font-medium">
                                        <Check className="w-3.5 h-3.5" /> 确认裁剪
                                      </button>
                                      <span className="text-gray-400">|</span>
                                      <button onClick={handleCancelCrop} className="flex items-center gap-1 hover:text-gray-300">
                                        取消
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

                        {/* 答案输入（无子题结构时显示；有子题时隐藏，由子题答案区替代；一步识别模式不显示） */}
                        {workMode !== 'single' && !(compoundQuestionTypes.includes(question.questionType) && (question.subQuestions || []).length > 0) && (
                        <>
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-gray-500">【答案】</label>
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
                            <label className="text-xs font-medium text-gray-500">【解析】</label>
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
                        </>
                        )}

                        {/* 复合题：子题答案区（仅当有子题时显示；一步识别模式不显示） */}
                        {workMode !== 'single' && compoundQuestionTypes.includes(question.questionType) && (question.subQuestions || []).length > 0 && (
                          <div className="border-t pt-2 mt-1">
                            <div className="text-xs font-medium text-gray-500 mb-2">子题答案</div>
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {(question.subQuestions || []).map((sub, subIndex) => (
                              <div key={sub.id} className="bg-gray-50 rounded-md px-3 py-2.5">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-sm font-medium text-gray-700">{SUB_NUMBERS[subIndex] || `${subIndex + 1}`}</span>
                                  <span className="text-xs text-gray-400 px-1 py-0.5 bg-white rounded border">{sub.questionType}</span>
                                  {isFillBlankType(sub.questionType) && (sub.blankCount || 1) > 1 && (
                                    <span className="text-xs text-gray-400">{sub.blankCount}个空</span>
                                  )}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-[94vw]">
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b bg-emerald-50 rounded-t-lg">
              <div>
                <h3 className="text-base font-semibold text-emerald-700">请关联题号</h3>
                <p className="text-xs text-gray-400 mt-0.5">选择此答案框对应的题目，提高匹配准确率</p>
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
                  暂无已识别的题目，请先在第一步识别题目
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
                关联并识别
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[400px] max-w-[90vw]">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium">操作说明</h3>
              <button onClick={() => setShowHelpDialog(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 text-sm text-gray-600 space-y-3">
              <div className="flex items-start gap-2">
                <span className="bg-emerald-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">1</span>
                <p>在左侧资料预览区拖拽鼠标框选题目区域（支持多页）</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="bg-emerald-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">2</span>
                <p>点击左上角圆形按钮切换选中状态，或点击右上角X删除</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="bg-emerald-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">3</span>
                <p>点击「批量移入」按钮，系统会自动识别题目、答案、解析</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="bg-emerald-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">4</span>
                <p>在右侧直接编辑答案和解析，点击左侧答案标记可定位到对应题目</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="bg-emerald-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0">5</span>
                <p>点击「加入试卷」完成录入</p>
              </div>
              <div className="bg-blue-50 p-2 rounded mt-2">
                <p className="text-xs text-blue-600">
                  <strong>AI 识别特性：</strong>
                  支持跨页答案识别、答案页分离识别、从解析中自动提取答案
                </p>
              </div>
            </div>
            <div className="p-4 border-t bg-gray-50 rounded-b-lg">
              <button onClick={() => setShowHelpDialog(false)} className="w-full px-4 py-2 bg-emerald-500 text-white rounded hover:bg-emerald-600">我知道了</button>
            </div>
          </div>
        </div>
      )}

      {/* 重新上传确认弹窗 */}
      {showReuploadConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-[360px] max-w-[90vw]">
            {/* 头部 - 复刻上传弹窗样式：浅绿色背景 + 圆形关闭按钮 */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-emerald-50 rounded-t-lg">
              <h3 className="font-medium text-emerald-600">确认重新上传</h3>
              <button onClick={handleReuploadCancel} className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white hover:bg-emerald-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* 内容区 */}
            <div className="px-6 py-12">
              <p className="text-sm text-gray-600 leading-relaxed">重新上传将清空当前识别材料，是否继续？</p>
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
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] cursor-zoom-out"
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
