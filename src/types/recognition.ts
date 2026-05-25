/**
 * AI 识别相关类型定义
 * 用于线下资源转线上作业功能
 */

/**
 * 边界框坐标（相对坐标，0-100 百分比）
 */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 页面图片信息
 */
export interface PageImage {
  pageNumber: number;
  imageData: string; // base64 格式
  width: number;
  height: number;
  sourceFileIndex?: number; // 来源文件索引（多文件上传时）
  sourcePageNumber?: number; // 在来源文件中的原始页码
}

/**
 * 文本块类型
 */
export type BlockType = 'question' | 'answer' | 'analysis' | 'noise';

/**
 * AI 识别的文本块
 */
export interface RecognizedBlock {
  id: string;
  type: BlockType;
  pageNumber: number;
  questionNumber?: number; // 题号（如果有）
  content: string; // 识别出的文本内容
  rawContent?: string; // 原始内容（如 "1.A" 拆分前）
  bbox: BBox;
  matchedAnswerId?: string; // 关联的答案块 ID
  matchedAnalysisId?: string; // 关联的解析块 ID
  extractedAnswer?: string | null; // 从解析中提取的答案
  confidence?: number; // 置信度 0-1
}

/**
 * AI 识别结果
 */
export interface RecognitionResult {
  pages: Array<{
    pageNumber: number;
    width: number;
    height: number;
  }>;
  blocks: RecognizedBlock[];
  warnings?: string[]; // 警告信息
  summary: {
    totalQuestions: number;
    matchedCount: number;
    unmatchedCount: number;
    lowConfidenceCount: number;
  };
}

/**
 * 用户画的题目框
 */
export interface QuestionBox {
  id: string;
  x: number; // 像素坐标
  y: number;
  width: number;
  height: number;
  isSelected: boolean;
  pageNumber: number;
  recognized?: boolean; // 是否已被AI识别
  type?: 'question' | 'answer' | 'full'; // 框类型：仅题干 / 仅答案解析 / 题干(含答案解析)
  questionNumber?: number; // 关联的题号（答案框显示"第X题答案"）
  linkedQuestionId?: number; // 答案框关联的目标题目 ID（选类型时确定，用于自动填充）
  // 跨页框支持：当框跨越两页时，记录第二页的信息
  endPageNumber?: number;   // 跨页框的结束页码
  endPageY?: number;        // 跨页框在结束页的起始Y坐标（通常为0）
  endPageHeight?: number;   // 跨页框在结束页的高度
}

/**
 * 匹配后的题目数据
 */
export interface MatchedQuestion {
  id: number;
  number: number;
  questionBoxId: string;
  questionBox: QuestionBox;
  pageNumber: number;
  
  // 题目内容
  questionContent: string;
  questionType: '单选题' | '多选题' | '判断题' | '填空题' | '问答题' | '解答题' | '计算题' | '材料题';
  optionCount?: number; // 选择题选项数（如4表示ABCD）
  blankCount?: number;  // 填空题的填空数（默认1）
  
  // 答案信息
  answer?: string;
  answerSource: 'direct' | 'extracted' | 'manual';
  answerBlockId?: string;
  answerPageNumber?: number;
  answerConfidence?: number;
  
  // 解析信息
  analysis?: string;
  analysisBlockId?: string;
  analysisPageNumber?: number;
  
  // 状态
  status: 'matched' | 'pending_confirm' | 'no_answer';
  
  // 图片
  croppedImageData?: string;

  // 题目区域坐标（AI识别出的纯题目部分在整页中的 bbox，用于从完整框图中二次裁剪题目图）
  questionBBox?: BBox;

  // 显示控制
  showRecognizedContent: boolean;
}

/**
 * 答案标记（显示在左侧资料区）
 */
export interface AnswerMarker {
  id: string;
  questionId: string | null;
  content: string;
  analysis: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  status: 'linked' | 'unlinked';
  confidence?: number;
}

/**
 * AI 识别请求参数
 */
export interface RecognizeRequest {
  pages: PageImage[];
  userBoxes?: QuestionBox[];
  options?: {
    extractAnswerFromAnalysis?: boolean; // 是否从解析中提取答案
    maxPages?: number; // 最大页数限制
  };
}

/**
 * AI 识别响应（流式）
 */
export interface RecognizeStreamChunk {
  type: 'progress' | 'block' | 'warning' | 'complete' | 'error';
  data: {
    message?: string;
    block?: RecognizedBlock;
    warning?: string;
    result?: RecognitionResult;
    error?: string;
  };
}

/**
 * 坐标转换参数
 */
export interface CoordinateTransform {
  pageWidth: number;
  pageHeight: number;
  displayWidth: number;
  displayHeight: number;
}

/**
 * 将像素坐标转换为百分比坐标
 */
export function pixelToPercent(
  pixel: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number
): BBox {
  return {
    x: (pixel.x / pageWidth) * 100,
    y: (pixel.y / pageHeight) * 100,
    width: (pixel.width / pageWidth) * 100,
    height: (pixel.height / pageHeight) * 100,
  };
}

/**
 * 将百分比坐标转换为像素坐标
 */
export function percentToPixel(
  percent: BBox,
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: (percent.x / 100) * pageWidth,
    y: (percent.y / 100) * pageHeight,
    width: (percent.width / 100) * pageWidth,
    height: (percent.height / 100) * pageHeight,
  };
}

/**
 * 计算两个矩形的 IoU（交并比）
 */
export function calculateIoU(a: BBox, b: BBox): number {
  const xOverlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  const intersection = xOverlap * yOverlap;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * 智能识别的区域类型
 */
export interface SmartRecognizedRegion {
  imageIndex: number;              // 框的索引
  questionNumber: number | null;   // 识别出的题号（可能为null）
  type: 'question' | 'answer';     // 类型
  content: string;                 // 完整文本
  answer?: string;                 // 仅答案框：答案
  analysis?: string;               // 仅答案框：解析
  confidence: number;              // 置信度
}

/**
 * 智能识别结果
 */
export interface SmartRecognitionResult {
  regions: SmartRecognizedRegion[];
  summary: {
    totalRegions: number;
    questionCount: number;
    answerCount: number;
    unmatchedCount: number;
  };
}

/**
 * 未匹配答案
 */
export interface UnmatchedAnswer {
  id: string;
  questionNumber: number | null;   // 识别的题号（可能为null）
  content: string;                 // 完整内容
  answer: string;                  // 答案
  analysis: string;                // 解析
  pageNumber: number;              // 页码
  boxId: string;                   // 框ID
  croppedImageData?: string;       // 答案框图片
  matchedQuestionId?: number;      // 手动关联的题目ID
}
