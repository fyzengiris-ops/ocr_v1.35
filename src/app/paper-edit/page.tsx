'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  ChevronDown,
  Undo2,
  Redo2,
  Bold,
  Underline,
  List,
  Type,
  Minus,
  Bot,
  Sparkles,
  FileText,
  AlignJustify,
  Plus,
  Keyboard,
  CheckCircle2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MathText } from '@/lib/math-render';
import { AIChatPanel } from '@/components/AIChatPanel';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ==================== 类型定义 ====================

interface PaperQuestion {
  id: string;
  number: number | string;
  questionType: string;
  content: string;
  answer: string;
  analysis: string;
  knowledgePoints: string[];
  difficulty: string;
  croppedImageData?: string;
  originalCroppedImageData?: string;
  optionCount?: number;
  optionContents?: Record<string, string>;
  blankCount?: number;
  blankAnswers?: string[];
  subQuestions?: {
    id: string;
    number?: number | string;
    questionType?: string;
    content?: string;
    answer?: string;
    analysis?: string;
    optionCount?: number;
    optionContents?: Record<string, string>;
    blankCount?: number;
    blankAnswers?: string[];
  }[];
}

interface PageImageData {
  data: string;
  fileName: string;
  sourceFileIndex: number;
  pageNumber: number;
}

interface PaperEditData {
  pageImages: PageImageData[];
  questions: PaperQuestion[];
  subjectInfo: string;
}

// ==================== 客观题类型常量 ====================
const OBJECTIVE_QUESTION_TYPES = new Set([
  '单选题', '多选题', '判断题', '完形填空', '阅读理解', '任务型阅读',
]);

// ==================== 快速录入客观题答案（Dialog 按题型分组+选项圆圈） ====================

const OPTION_LABELS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('');
const COMPOUND_TYPES = new Set(['完形填空', '阅读理解', '任务型阅读']);

interface QuestionOptionState {
  id: string;
  subId?: string;
  number: string;
  questionType: string;
  options: { label: string; selected: boolean }[];
}

function BatchAnswerDialog({
  questions,
  open,
  onOpenChange,
  onApply,
}: {
  questions: PaperQuestion[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (answersMap: Record<string, string>) => void;
}) {
  const [optionStates, setOptionStates] = useState<QuestionOptionState[]>([]);

  // 初始化：按题型分组
  useEffect(() => {
    if (!open || questions.length === 0) return;

    const objectiveQs = questions.filter(q =>
      OBJECTIVE_QUESTION_TYPES.has(q.questionType)
    );

    const states: QuestionOptionState[] = [];

    objectiveQs.forEach(q => {
      const isCompound = COMPOUND_TYPES.has(q.questionType);
      const isJudge = q.questionType === '判断题';
      const defaultCount = isJudge ? 2 : 4;

      if (isCompound && q.subQuestions && q.subQuestions.length > 0) {
        q.subQuestions.forEach((sq, idx) => {
          const subType = sq.questionType || q.questionType;
          const isSubJudge = subType === '判断题';
          states.push({
            id: q.id,
            subId: sq.id,
            number: String(sq.number || `${idx + 1}`),
            questionType: subType,
            options: initOptions(sq.optionCount || q.optionCount || (isSubJudge ? 2 : defaultCount), isSubJudge, sq.answer),
          });
        });
      } else {
        states.push({
          id: q.id,
          number: String(q.number),
          questionType: q.questionType,
          options: initOptions(defaultCount, isJudge, q.answer),
        });
      }
    });

    setOptionStates(states);
  }, [open, questions]);

  function initOptions(count: number, isJudge: boolean, existingAnswer?: string) {
    return Array.from({ length: count }, (_, i) => ({
      label: isJudge ? (i === 0 ? '√' : '×') : OPTION_LABELS[i],
      selected: existingAnswer
        ? (isJudge ? (i === 0 ? existingAnswer.includes('√') || existingAnswer === 'A' || existingAnswer === '正确' : false)
            : existingAnswer.toUpperCase().includes(OPTION_LABELS[i]))
        : false,
    }));
  }

  function toggleSelect(stateIdx: number, optIdx: number) {
    setOptionStates(prev => {
      const next = [...prev];
      const s = { ...next[stateIdx] };
      const q = questions.find(q => q.id === s.id);
      const isMulti = q?.questionType === '多选题';

      if (isMulti) {
        // 多选：切换单个选项
        s.options = s.options.map((o, i) => i === optIdx ? { ...o, selected: !o.selected } : o);
      } else {
        // 单选/判断：选中一个，取消其他
        s.options = s.options.map((o, i) => ({ ...o, selected: i === optIdx }));
      }
      next[stateIdx] = s;
      return next;
    });
  }

  function addOption(stateIdx: number) {
    setOptionStates(prev => {
      const next = [...prev];
      const s = { ...next[stateIdx] };
      const currentLen = s.options.length;
      const isJudge = s.questionType === '判断题';
      const maxLen = isJudge ? 2 : OPTION_LABELS.length;
      if (currentLen >= maxLen) return prev;
      s.options = [...s.options, { label: isJudge ? '' : OPTION_LABELS[currentLen], selected: false }];
      next[stateIdx] = s;
      return next;
    });
  }

  function removeOption(stateIdx: number) {
    setOptionStates(prev => {
      const next = [...prev];
      const s = { ...next[stateIdx] };
      const minOpt = s.questionType === '判断题' ? 2 : 3;
      if (s.options.length <= minOpt) return prev;
      // 如果删除的是被选中的选项，清除选中
      const lastSelected = s.options[s.options.length - 1].selected;
      s.options = s.options.slice(0, -1);
      if (lastSelected) s.options = s.options.map(o => ({ ...o, selected: false }));
      next[stateIdx] = s;
      return next;
    });
  }

  function handleConfirm() {
    const answersMap: Record<string, string> = {};
    optionStates.forEach(s => {
      const selectedLabels = s.options.filter(o => o.selected).map(o => o.label);
      if (selectedLabels.length > 0) {
        const key = s.subId ? `${s.id}__${s.subId}` : s.id;
        answersMap[key] = selectedLabels.join('');
      }
    });
    onApply(answersMap);
    onOpenChange(false);
  }

  // 按题型分组
  const grouped = optionStates.reduce<Record<string, QuestionOptionState[]>>((acc, s) => {
    const type = s.questionType;
    if (!acc[type]) acc[type] = [];
    acc[type].push(s);
    return acc;
  }, {});

  const typeOrder = ['单选题', '多选题', '判断题', '完形填空', '阅读理解', '任务型阅读'];
  const sortedTypes = Object.keys(grouped).sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b));

  return (
    <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-[60] ${open ? '' : 'hidden'}`}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">快速录入选择题答案</h3>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {sortedTypes.length === 0 && (
            <div className="text-center text-sm text-gray-400 py-8">暂无客观题</div>
          )}

          {sortedTypes.map(type => {
            const items = grouped[type];
            const isCompound = COMPOUND_TYPES.has(type);

            // 复合题型：按父级题目分组
            let compoundGroups: { parentNum: string; items: QuestionOptionState[] }[] = [];
            if (isCompound) {
              const parentMap = new Map<string, QuestionOptionState[]>();
              items.forEach(item => {
                const key = item.id;
                if (!parentMap.has(key)) parentMap.set(key, []);
                parentMap.get(key)!.push(item);
              });
              compoundGroups = Array.from(parentMap.entries()).map(([id, subItems]) => ({
                parentNum: String(questions.find(q => q.id === id)?.number || ''),
                items: subItems,
              }));
            }

            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600">
                    <CheckCircle2 size={12} strokeWidth={3} />
                  </span>
                  <span className="text-sm font-semibold text-gray-800">{type}</span>
                  <span className="text-xs text-gray-400">（共 {items.length} 道）</span>
                </div>

                {!isCompound ? (
                  // 普通题型：平铺展示
                  <div className="space-y-1.5 pl-7">
                    {items.map((item, idx) => (
                      <QuestionOptionRow
                        key={item.subId || item.id}
                        item={item}
                        index={idx}
                        onToggle={toggleSelect}
                        onAdd={() => addOption(optionStates.indexOf(item))}
                        onRemove={() => removeOption(optionStates.indexOf(item))}
                      />
                    ))}
                  </div>
                ) : (
                  // 复合题型：显示父级标题 + 子题列表
                  <div className="space-y-3 pl-7">
                    {compoundGroups.map((group, gIdx) => (
                      <div key={gIdx}>
                        <div className="text-xs font-medium text-gray-500 mb-1.5 pl-1">
                          {type}{gIdx + 1}（{group.items.length} 小题）
                        </div>
                        <div className="space-y-1.5 pl-3">
                          {group.items.map((item, idx) => (
                            <QuestionOptionRow
                              key={item.subId || item.id}
                              item={item}
                              index={idx}
                              onToggle={toggleSelect}
                              onAdd={() => addOption(optionStates.indexOf(item))}
                              onRemove={() => removeOption(optionStates.indexOf(item))}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="px-5 py-2 text-sm text-white bg-emerald-500 hover:bg-emerald-600 rounded-md transition-colors"
          >
            确认保存
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionOptionRow({
  item,
  index,
  onToggle,
  onAdd,
  onRemove,
}: {
  item: QuestionOptionState;
  index: number;
  onToggle: (stateIdx: number, optIdx: number) => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const isJudge = item.questionType === '判断题';
  const minOpt = isJudge ? 2 : 3;

  return (
    <div className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded px-1 -mx-1 group">
      <span className="text-sm text-gray-600 w-14 shrink-0">{item.number}题</span>
      <div className="flex items-center gap-2">
        {item.options.map((opt, oIdx) => (
          <button
            key={opt.label}
            onClick={() => onToggle(index, oIdx)}
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-all',
              opt.selected
                ? 'bg-emerald-500 text-white ring-2 ring-emerald-300'
                : 'bg-white text-gray-600 border border-gray-300 hover:border-emerald-400 hover:text-emerald-600'
            )}
            title={`选项 ${opt.label}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 transition-colors text-sm font-bold"
          title="添加选项"
        >+</button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          disabled={item.options.length <= minOpt}
          className={cn(
            'w-6 h-6 flex items-center justify-center rounded transition-colors text-sm font-bold',
            item.options.length <= minOpt
              ? 'text-gray-200 cursor-not-allowed'
              : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
          )}
          title="删除选项"
        >−</button>
      </div>

    </div>
  );
}

// ==================== 主组件 ====================
export default function PaperEditPage() {
  const router = useRouter();
  const [paperData, setPaperData] = useState<PaperEditData | null>(null);
  const [questions, setQuestions] = useState<PaperQuestion[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(130);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [showBatchAnswer, setShowBatchAnswer] = useState(false);

  // 从 sessionStorage 读取数据
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('paperEditData');
      if (raw) {
        const data: PaperEditData = JSON.parse(raw);
        setPaperData(data);
        // 自动连续编号：主题号 1/2/3…，子题 1.1/1.2/2.1…
        const renumbered = (data.questions || []).map((q, idx) => {
          const mainNum = idx + 1;
          return {
            ...q,
            number: mainNum,
            knowledgePoints: q.knowledgePoints || [],
            difficulty: q.difficulty || '容易',
            blankAnswers: q.blankAnswers || [],
            subQuestions: q.subQuestions?.map((sq, sIdx) => ({
              ...sq,
              number: `${mainNum}.${sIdx + 1}`,
              blankAnswers: sq.blankAnswers || [],
            })),
          };
        });
        setQuestions(renumbered);
      }
    } catch (e) {
      console.error('[paper-edit] sessionStorage 数据解析失败:', e);
    }
  }, []);

  const totalPages = paperData?.pageImages?.length || 0;
  const currentImage = totalPages > 0 ? paperData!.pageImages[currentPage - 1] : null;

  const handleBatchApply = (answersMap: Record<string, string>) => {
    setQuestions(prev =>
      prev.map(q => {
        const parentAnswer = answersMap[q.id];
        const next: PaperQuestion = parentAnswer !== undefined ? { ...q, answer: parentAnswer } : { ...q };
        if (q.subQuestions?.length) {
          next.subQuestions = q.subQuestions.map(sq => {
            const subAnswer = answersMap[`${q.id}__${sq.id}`];
            return subAnswer !== undefined ? { ...sq, answer: subAnswer } : sq;
          });
        }
        return next;
      })
    );
  };

  const handleBatchApplyInline = (answersMap: Record<string, string>) => {
    handleBatchApply(answersMap);
    setShowBatchAnswer(false);
  };

  const handleAIButtonClick = (_action: string) => {
    // AI小乐动作回调（可后续扩展）
  };

  // 按题型分组显示
  const groupedQuestions = questions.reduce<Record<string, PaperQuestion[]>>((acc, q) => {
    const type = q.questionType || '未分类';
    if (!acc[type]) acc[type] = [];
    acc[type].push(q);
    return acc;
  }, {});

  return (
    <div className="h-screen flex flex-col bg-[#f5f6f7] overflow-hidden">
      {/* ==================== 顶部导航栏 ==================== */}
      <header className="bg-white border-b border-gray-200 flex-shrink-0">
        <div className="h-12 px-5 flex items-center justify-between">
          {/* Logo区 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-teal-500">
                <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor" opacity="0.9" />
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-lg font-bold text-teal-500 tracking-tight">乐课网</span>
            </div>
            <span className="text-xs text-gray-400 ml-1">让教育简单又有效</span>
          </div>

          {/* 右侧 */}
          <div className="flex items-center gap-5">
            <button className="relative flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800">
              <Bell className="w-4.5 h-4.5" />
              <span>消息</span>
              <span className="min-w-[18px] h-[18px] bg-red-500 text-white text-[11px] font-medium rounded-full flex items-center justify-center px-1">
                45
              </span>
            </button>
            <button className="flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900">
              <span>黄英</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* 工具栏 */}
        <div className="h-11 px-5 flex items-center justify-between border-t border-gray-100">
          {/* 左侧工具按钮 */}
          <div className="flex items-center gap-0.5">
            <button className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded" title="撤销">
              <Undo2 className="w-4 h-4" />
            </button>
            <button className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded" title="重做">
              <Redo2 className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-gray-200 mx-1" />

            <button className="w-8 h-8 flex items-center justify-center text-gray-700 hover:bg-gray-100 rounded font-bold text-sm" title="粗体">
              B
            </button>
            <button className="w-8 h-8 flex items-center justify-center text-gray-700 hover:bg-gray-100 rounded font-bold text-sm underline decoration-1 underline-offset-2" title="下划线">
              U
            </button>
            <button className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded" title="列表">
              <List className="w-4 h-4" />
            </button>
            <button className="w-8 h-8 flex items-center justify-center text-gray-700 hover:bg-gray-100 rounded font-serif text-sm" title="字体">
              A
            </button>
            <button className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded" title="下划线">
              <Minus className="w-5 h-4" />
            </button>
          </div>

          {/* 右侧操作按钮 */}
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
              <Sparkles className="w-3.5 h-3.5 text-orange-500" />
              AI批量补充
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
              <Bot className="w-3.5 h-3.5 text-purple-500" />
              AI批改设置
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
              <FileText className="w-3.5 h-3.5 text-blue-500" />
              试卷结构
            </button>
            {/* 批量设置答案按钮 */}
            {questions.length > 0 && (
              <div className="group relative">
                <button
                  onClick={() => setShowBatchAnswer(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-emerald-700 border border-emerald-300 rounded hover:bg-emerald-50 bg-emerald-50/50 transition-colors"
                >
                  <Keyboard className="w-3.5 h-3.5 text-emerald-500" />
                  批量设置答案
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-medium px-1 rounded">
                    NEW
                  </span>
                </button>
                {/* 悬浮提示 */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-xs text-white bg-gray-800 rounded whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  批量设置选择题答案
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                </div>
              </div>
            )}
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50">
              导出
            </button>
          </div>
        </div>
      </header>

      {/* ==================== 主内容三栏布局 ==================== */}
      <div className="flex flex-1 overflow-hidden">
        {/* ====== 左侧：资料原图面板（真实图片） ====== */}
        <div className="w-[420px] border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
          {/* 面板头部 — 去掉「原图」文案，只保留继续上传和菜单 */}
          <div className="h-11 px-4 flex items-center justify-between border-b border-gray-100">
            <button className="px-2.5 py-1 text-xs text-teal-600 border border-teal-200 rounded hover:bg-teal-50">
              继续上传
            </button>
            <button className="p-1 text-gray-400 hover:text-gray-600">
              <AlignJustify className="w-4 h-4" />
            </button>
          </div>

          {/* 图片预览区域 */}
          <div className="flex-1 overflow-auto p-3 bg-gray-50 flex items-start justify-center">
            {currentImage ? (
              <img
                src={currentImage.data}
                alt={`第${currentImage.pageNumber}页`}
                style={{ maxWidth: '100%', transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
                className="shadow-sm rounded border border-gray-200"
              />
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full text-gray-400">
                <FileText className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-xs">暂无资料图片</p>
                <p className="text-[11px] mt-1 text-gray-300">请先在识别作业资料页面添加题目</p>
              </div>
            )}
          </div>

          {/* 底部分页器 */}
          {totalPages > 0 && (
            <div className="h-11 px-4 flex items-center justify-between border-t border-gray-200 bg-white flex-shrink-0">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-30 text-xs"
              >
                &lt;
              </button>
              <span className="text-xs text-gray-600">
                {currentPage}/{totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-30 text-xs"
              >
                &gt;
              </button>
              <div className="flex items-center gap-1.5 ml-2">
                <button
                  onClick={() => setZoom(z => Math.max(50, z - 10))}
                  className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-50 text-xs"
                >
                  ⊖
                </button>
                <span className="text-xs text-gray-600">{zoom}%</span>
                <button
                  onClick={() => setZoom(z => Math.min(200, z + 10))}
                  className="w-7 h-7 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-50 text-xs"
                >
                  ⊕
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ====== 中间：试卷展示区（只读在线文档风格） ====== */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-6 px-6">

            {/* 最近保存时间 */}
            <div className="text-right mb-2">
              <span className="text-xs text-gray-400">最近保存 15:35</span>
            </div>

            {/* 试卷标题 */}
            <div className="text-center mb-6">
              <h1 className="text-xl font-bold text-gray-900 mb-1">
                {paperData?.subjectInfo || ''}{questions.length > 0 ? '试卷' : ''}
              </h1>
            </div>

            {/* 无数据提示 */}
            {questions.length === 0 && (
              <div className="bg-white rounded-lg border border-dashed border-gray-300 p-16 text-center">
                <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm mb-1">暂无试卷内容</p>
                <p className="text-gray-400 text-xs">请先在「识别作业资料」页面识别题目后点击「加入试卷」</p>
              </div>
            )}

            {/* 按题型分组渲染题目 */}
            {Object.entries(groupedQuestions).map(([type, typeQuestions]) => (
              <div key={type} className="mb-6">
                {/* 题型标题 */}
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 rounded-t-lg">
                  <h2 className="text-sm font-semibold text-gray-800">
                    {type}
                    <span className="text-gray-500 font-normal ml-2">
                      （共 {typeQuestions.length} 小题）
                    </span>
                  </h2>
                </div>

                {/* 题目列表 */}
                <div className="bg-white rounded-b-lg border border-gray-200 shadow-sm divide-y divide-gray-100">
                  {typeQuestions.map((q) => (
                    <div key={q.id} className="px-5 py-5">
                      {/* 题干 */}
                      <div className="mb-3 text-sm text-gray-800 leading-relaxed">
                        <MathText text={q.content} />
                      </div>

                      {/* 答案区 */}
                      <div className="mb-2.5 flex items-center justify-between group">
                        <div className="flex items-start gap-1.5">
                          <span className="text-sm text-gray-800 font-medium">【答案】</span>
                          {q.answer?.trim() ? (
                            <span className="text-sm text-gray-900 font-medium">{q.answer}</span>
                          ) : (
                            <span className="text-sm text-gray-400 italic">请输入</span>
                          )}
                        </div>
                        <button className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 border border-gray-200 rounded-md hover:text-orange-500 hover:border-orange-300 hover:bg-orange-50/50 transition-colors opacity-0 group-hover:opacity-100">
                          <Sparkles className="w-3 h-3" />
                          AI解析
                        </button>
                      </div>

                      {/* 解析区 */}
                      <div className="mb-2.5 flex items-start justify-between group">
                        <div className="flex items-start gap-1.5 min-w-0 flex-1">
                          <span className="text-sm text-gray-800 font-medium flex-shrink-0">【解析】</span>
                          {q.analysis?.trim() ? (
                            <div className="text-sm text-gray-700 leading-relaxed min-w-0">
                              <MathText text={q.analysis} />
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400 italic">请输入</span>
                          )}
                        </div>
                        <button className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 border border-gray-200 rounded-md hover:text-orange-500 hover:border-orange-300 hover:bg-orange-50/50 transition-colors flex-shrink-0 ml-3 opacity-0 group-hover:opacity-100">
                          <Sparkles className="w-3 h-3" />
                          AI解析
                        </button>
                      </div>

                      {q.subQuestions && q.subQuestions.length > 0 && (
                        <div className="mb-3 space-y-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2.5">
                          {q.subQuestions.map((sq, idx) => {
                            const subAnswer = sq.blankAnswers?.some(Boolean)
                              ? sq.blankAnswers.map((item, answerIdx) => `空${answerIdx + 1}：${item || '请输入'}`).join('；')
                              : sq.answer || '';
                            return (
                              <div key={sq.id} className="rounded bg-white px-3 py-2 border border-gray-100">
                                <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
                                  <span className="font-medium text-gray-700">{sq.number || `${q.number}.${idx + 1}`}</span>
                                  {sq.questionType && <span>{sq.questionType}</span>}
                                </div>
                                {sq.content?.trim() && (
                                  <div className="mb-1.5 text-sm text-gray-800 leading-relaxed">
                                    <MathText text={sq.content} />
                                  </div>
                                )}
                                <div className="mb-1 flex items-start gap-1.5">
                                  <span className="text-sm text-gray-800 font-medium">【答案】</span>
                                  {subAnswer.trim() ? (
                                    <span className="text-sm text-gray-900 font-medium">{subAnswer}</span>
                                  ) : (
                                    <span className="text-sm text-gray-400 italic">请输入</span>
                                  )}
                                </div>
                                <div className="flex items-start gap-1.5">
                                  <span className="text-sm text-gray-800 font-medium">【解析】</span>
                                  {sq.analysis?.trim() ? (
                                    <div className="text-sm text-gray-700 leading-relaxed">
                                      <MathText text={sq.analysis} />
                                    </div>
                                  ) : (
                                    <span className="text-sm text-gray-400 italic">请输入</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* 知识点 */}
                      <div className="mb-2.5 flex items-center justify-between group">
                        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                          <span className="text-sm text-gray-800 font-medium flex-shrink-0">【知识点】</span>
                          {q.knowledgePoints && q.knowledgePoints.length > 0 ? (
                            <>
                              {q.knowledgePoints.map((kp, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-gray-700 bg-gray-100 border border-gray-200 rounded"
                                >
                                  {kp}
                                  <button className="text-gray-400 hover:text-red-500 transition-colors leading-none">
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                              <button className="inline-flex items-center justify-center w-5 h-5 text-gray-400 border border-dashed border-gray-300 rounded hover:border-teal-400 hover:text-teal-600 transition-colors">
                                <Plus className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <button className="inline-flex items-center justify-center w-5 h-5 text-gray-400 border border-dashed border-gray-300 rounded hover:border-teal-400 hover:text-teal-600 transition-colors">
                              <Plus className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <button className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 border border-gray-200 rounded-md hover:text-orange-500 hover:border-orange-300 hover:bg-orange-50/50 transition-colors flex-shrink-0 ml-3 opacity-0 group-hover:opacity-100">
                          <Sparkles className="w-3 h-3" />
                          AI生成
                        </button>
                      </div>

                      {/* 难度 */}
                      <div className="flex items-center justify-between group">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-gray-800 font-medium">【难度】</span>
                          <select
                            defaultValue={q.difficulty || '容易'}
                            className="text-sm text-gray-700 bg-transparent border-none outline-none cursor-pointer pr-4 appearance-none"
                          >
                            <option value="容易">容易</option>
                            <option value="较易">较易</option>
                            <option value="中等">中等</option>
                            <option value="较难">较难</option>
                            <option value="困难">困难</option>
                          </select>
                          <ChevronDown className="w-3.5 h-3.5 text-gray-400 -ml-5 pointer-events-none" />
                        </div>
                        <button className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 border border-gray-200 rounded-md hover:text-orange-500 hover:border-orange-300 hover:bg-orange-50/50 transition-colors opacity-0 group-hover:opacity-100">
                          <Sparkles className="w-3 h-3" />
                          AI生成
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ====== 右下角：AI小乐悬浮助手 ====== */}
        {!showAIPanel && (
          <button
            onClick={() => setShowAIPanel(true)}
            className="fixed bottom-6 right-6 z-50"
          >
            <div className="relative">
              <div className="w-14 h-14 rounded-full overflow-hidden shadow-lg cursor-pointer hover:ring-2 hover:ring-emerald-400 transition-all">
                <Image
                  src="/ai-mascot.jpg"
                  alt="AI小乐"
                  width={56}
                  height={56}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -top-10 right-0 bg-white rounded-lg shadow-lg px-3 py-2 whitespace-nowrap">
                <span className="text-sm text-gray-600">Hi, 我是AI小乐!</span>
                <div className="absolute bottom-0 right-4 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white transform translate-y-full"></div>
              </div>
            </div>
          </button>
        )}

        {showAIPanel && (
          <AIChatPanel
            onClose={() => setShowAIPanel(false)}
            onActionClick={handleAIButtonClick}
            uploadedFile={null}
          />
        )}
      </div>

      {/* ==================== 底部操作栏 ==================== */}
      <div className="bg-white border-t border-gray-200 py-3.5 px-6 flex items-center justify-center gap-3 flex-shrink-0">
        <button
          onClick={() => {
            sessionStorage.removeItem('leke_upload_dialog_open');
            router.push('/homework');
          }}
          className="px-6 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded border border-transparent"
        >
          取消
        </button>
        <button
          onClick={() => router.push('/homework')}
          className="px-6 py-2 text-sm text-teal-600 hover:bg-teal-50 rounded border border-teal-300"
        >
          返回录题
        </button>
        <button className="px-6 py-2 text-sm text-teal-600 hover:bg-teal-50 rounded border border-teal-300">
          保存至资源库
        </button>
        <button className="px-6 py-2 text-sm text-white bg-teal-500 hover:bg-teal-600 rounded shadow-sm">
          保存并添加至作业
        </button>
      </div>

      {/* 快速录入客观题答案弹窗 */}
      <BatchAnswerDialog
        questions={questions}
        open={showBatchAnswer}
        onOpenChange={setShowBatchAnswer}
        onApply={handleBatchApplyInline}
      />
    </div>
  );
}
