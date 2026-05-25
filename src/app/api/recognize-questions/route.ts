/**
 * AI 识别 API
 * 接收图片，调用 Vision Model 识别题目、答案、解析
 * 使用 SSE 流式输出
 * 
 * 支持四种模式：
 * 1. 完整模式：发送整页图片，AI识别所有内容并建立跨页关联
 * 2. 裁剪模式：发送裁剪后的题目图片，AI只识别每个图片的内容
 * 3. 答案匹配模式：发送单张裁剪图，AI只提取答案和解析
 * 4. 全局匹配模式：发送整页图片+已有题目信息，AI从整页定位答案并关联
 */

import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import type { PageImage, RecognizeRequest, QuestionBox } from '@/types/recognition';
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_CROPPED,
  SYSTEM_PROMPT_SMART,
  SYSTEM_PROMPT_ANSWER_ONLY,
  buildUserMessage,
  buildUserMessageCropped,
  parseAIResponse,
  parseCroppedAIResponse,
  parseSmartAIResponse,
  parseAnswerOnlyResponse,
  smartMatchQuestionsAndAnswers,
  generateMatchedQuestions,
  generateAnswerMarkers,
} from '@/lib/ai-recognizer';

// 最大页数限制（与前端 pdf-processor 保持一致）
const MAX_PAGES = 24;

/**
 * 修复 AI 返回的常见 JSON 格式问题
 * AI 模型常返回含非法转义字符、未转义换行、控制字符等的 JSON
 */
function tryFixAiJson(raw: string): string {
  let fixed = raw;

  // 1. 移除字符串值中的控制字符（保留 \n \t \r 等合法转义）
  //    AI 常在 analysis 字段中包含原始换行符
  fixed = fixed.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  // 2. 修复常见的非法转义：如 \" 在 JSON 字符串外，或 \ 后跟非转义字符
  //    将孤立的反斜杠（不在合法转义序列中）进行双写
  fixed = fixed.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');

  // 3. 修复未闭合的字符串（AI 有时截断长文本）
  //    检查并截断到最后一个完整的 JSON 对象
  try {
    JSON.parse(fixed);
    return fixed; // 修复成功
  } catch {
    // 4. 更激进的修复：尝试逐个对象解析
    const objPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    const objects = [...fixed.matchAll(objPattern)].map(m => m[0]);
    if (objects.length > 0) {
      const validObjects: any[] = [];
      for (const objStr of objects) {
        try {
          validObjects.push(JSON.parse(objStr));
        } catch {
          // 尝试修复单个对象
          try {
            const cleaned = objStr.replace(/[\x00-\x1f]/g, ' ').replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
            validObjects.push(JSON.parse(cleaned));
          } catch {
            console.warn('[JSON修复] 无法修复对象:', objStr.substring(0, 80));
          }
        }
      }
      if (validObjects.length > 0) {
        return JSON.stringify(validObjects);
      }
    }

    // 5. 最后手段：移除所有可能导致问题的字符后重试
    const aggressive = fixed.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ');
    return aggressive;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RecognizeRequest & { croppedMode?: boolean; subjectInfo?: string; answerOnly?: boolean; globalMatch?: boolean; existingQuestions?: Array<{ id: number; number: number; content: string; questionType: string; hasAnswer: boolean }>; answerMode?: boolean };
    const { pages, userBoxes = [], options = {}, croppedMode = false, subjectInfo, answerOnly = false, globalMatch = false, existingQuestions = [], answerMode = false } = body;

    // 调试日志：打印请求概要
    console.log('[RecognizeAPI] 收到请求:', {
      mode: globalMatch ? 'globalMatch' : croppedMode ? 'cropped' : answerMode ? 'answer' : 'full',
      pagesCount: pages?.length,
      existingQuestionsCount: existingQuestions?.length,
      bodySizeHint: JSON.stringify(body).length,
    });

    // 验证输入
    if (!pages || pages.length === 0) {
      return new Response(
        JSON.stringify({ error: '请提供至少一张图片' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 单次识别模式限制24页；全局匹配模式放宽到96页（支持多次累计上传）
    const isGlobalMatch = body.globalMatch === true;
    const effectiveMaxPages = isGlobalMatch ? 96 : MAX_PAGES;
    if (pages.length > effectiveMaxPages) {
      return new Response(
        JSON.stringify({ error: isGlobalMatch
          ? `全局匹配最多支持 ${effectiveMaxPages} 张图片`
          : `单次上传最多支持 ${MAX_PAGES} 张图片`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 提取请求头
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);

    // 创建 LLM 客户端
    // 优先从环境变量读取 API Key，支持火山引擎 Ark / Coze / OpenAI 等兼容端点
    const llmApiKey = process.env.COZE_CODING_API_KEY || process.env.OPENAI_API_KEY || '';
    const llmBaseUrl = process.env.COZE_CODING_MODEL_BASE_URL || process.env.OPENAI_BASE_URL || '';
    const config = new Config({
      apiKey: llmApiKey,
      modelBaseUrl: llmBaseUrl || undefined,
    });
    const client = new LLMClient(config, customHeaders);

    // 根据模式选择不同的处理逻辑
    if (globalMatch) {
      // 全局匹配模式：AI 从整页定位答案并关联到已有题目
      return handleGlobalMatchMode(client, pages, existingQuestions, customHeaders);
    } else if (answerMode) {
      // 纯答案提取模式：对答案框进行答案提取，传入已有题目用于关联匹配
      return handleSmartMode(client, pages, userBoxes, customHeaders, subjectInfo, undefined, existingQuestions);
    } else if (answerOnly) {
      // 答案匹配模式：只提取答案和解析
      return handleAnswerOnlyMode(client, pages, customHeaders);
    } else if (croppedMode) {
      // 裁剪模式：使用智能识别
      return handleSmartMode(client, pages, userBoxes, customHeaders, subjectInfo);
    } else {
      // 完整模式：原有逻辑
      return handleFullMode(client, pages, userBoxes, customHeaders);
    }
  } catch (error) {
    console.error('API 错误:', error);
    return new Response(
      JSON.stringify({ error: '服务器错误' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 智能识别模式处理
 */
async function handleSmartMode(
  client: LLMClient,
  croppedImages: PageImage[],
  userBoxes: QuestionBox[],
  customHeaders: Record<string, string>,
  subjectInfo?: string,
  validQuestionTypes?: string[],
  existingQuestions?: Array<{ id: number; number: number; content: string; questionType: string; hasAnswer: boolean; subQuestions?: Array<{ id: number; number: number; content: string; questionType: string; hasAnswer: boolean }> }>
) {
  // 构建消息
  const messages = [
    {
      role: 'system' as const,
      content: SYSTEM_PROMPT_SMART,
    },
    {
      role: 'user' as const,
      content: buildUserMessageCropped(croppedImages, subjectInfo, validQuestionTypes),
    },
  ];

  // 创建流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (message: string) => {
        const data = JSON.stringify({ type: 'progress', data: { message } });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const sendComplete = (result: object) => {
        const data = JSON.stringify({ type: 'complete', data: { result } });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const sendError = (error: string) => {
        const data = JSON.stringify({ type: 'error', data: { error } });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const MAX_RETRIES = 2;
      let fullResponse = '';
      let lastError: string = '';

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            sendProgress(`网络异常，正在第${attempt}次重试...`);
          } else {
            sendProgress(`正在智能识别 ${croppedImages.length} 个区域...`);
          }

          // 调用 Vision Model（带超时控制）
          const llmStream = client.stream(messages, {
            model: 'ep-m-20260522100054-r72qh',
            temperature: 0.3,
          });

          fullResponse = '';
          const streamTimeout = 120000; // 120秒超时
          const streamStart = Date.now();

          for await (const chunk of llmStream) {
            // 检查超时
            if (Date.now() - streamStart > streamTimeout) {
              throw new Error('识别超时，请减少框选数量后重试');
            }
            if (chunk.content) {
              fullResponse += chunk.content.toString();
            }
          }

          // 流式读取成功，跳出重试循环
          break;

        } catch (streamError) {
          lastError = streamError instanceof Error ? streamError.message : String(streamError);
          console.error(`智能识别流式调用失败(第${attempt + 1}次):`, lastError);

          // 如果是最后一次重试，发送错误
          if (attempt === MAX_RETRIES) {
            const errorMessage = lastError.includes('network') || lastError.includes('Network')
              ? '网络连接异常，请检查网络后重试'
              : lastError.includes('timeout') || lastError.includes('超时')
                ? '识别超时，请减少框选数量后重试'
                : `识别失败：${lastError}`;
            sendError(errorMessage);
            controller.close();
            return;
          }

          // 等待一段时间再重试（指数退避）
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }

      try {
        sendProgress('正在解析识别结果...');

        // 解析 AI 响应
        const parsedRegions = parseSmartAIResponse(fullResponse);

        if (!parsedRegions || parsedRegions.length === 0) {
          console.error('智能识别解析失败，响应长度:', fullResponse.length);
          
          // 即使解析失败，也将所有框标记为已识别（降级为题目框）
          // 这样左侧框不会停留在待识别状态
          const fallbackBoxTypes = userBoxes.map((box, index) => ({
            boxId: box.id,
            type: 'question' as const,
            questionNumber: index + 1,
          }));
          
          const fallbackQuestions = userBoxes.map((box, index) => ({
            id: index + 1,
            number: index + 1,
            questionBoxId: box.id,
            questionBox: box,
            pageNumber: box.pageNumber,
            questionContent: `第${index + 1}题（AI识别失败，请手动编辑）`,
            questionType: '单选题' as const,
            optionCount: undefined,
            blankCount: undefined,
            answerSource: 'manual' as const,
            status: 'no_answer' as const,
            showRecognizedContent: false,
            croppedImageData: undefined,
          }));
          
          sendComplete({
            recognition: { pages: croppedImages, blocks: [], summary: { totalQuestions: croppedImages.length } },
            matchedQuestions: fallbackQuestions,
            answerMarkers: [],
            unmatchedAnswers: [],
            boxTypes: fallbackBoxTypes,
          });
          
          controller.close();
          return;
        }

        sendProgress('正在关联题目和答案...');

        // 构建裁剪图片Map
        const croppedImagesMap = new Map<string, string>();
        croppedImages.forEach((img, index) => {
          const boxId = userBoxes[index]?.id || `box-${index}`;
          croppedImagesMap.set(boxId, img.imageData);
        });

        // 智能关联匹配（传入已有题目，支持答案框直接关联到已有题目）
        const { questions, unmatchedAnswers, boxTypes, preMatchedAnswers } = smartMatchQuestionsAndAnswers(
          parsedRegions,
          croppedImagesMap,
          userBoxes,
          existingQuestions
        );

        // 发送完成结果
        sendComplete({
          recognition: { pages: croppedImages, blocks: [], summary: { totalQuestions: croppedImages.length } },
          matchedQuestions: questions,
          answerMarkers: [],
          unmatchedAnswers: unmatchedAnswers,
          boxTypes: boxTypes,
          preMatchedAnswers: preMatchedAnswers || [],
        });

        controller.close();
      } catch (parseError) {
        console.error('智能识别解析失败:', parseError);
        sendError(parseError instanceof Error ? parseError.message : '识别结果解析失败，请重试');
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * 答案匹配模式处理（单框重新识别答案）
 */
async function handleAnswerOnlyMode(
  client: LLMClient,
  croppedImages: PageImage[],
  customHeaders: Record<string, string>,
  validQuestionTypes?: string[]
) {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT_ANSWER_ONLY },
    { role: 'user' as const, content: buildUserMessageCropped(croppedImages, undefined, validQuestionTypes) },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', data: { message } })}\n\n`));
      };
      const sendComplete = (result: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', data: { result } })}\n\n`));
      };
      const sendError = (error: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', data: { error } })}\n\n`));
      };

      const MAX_RETRIES = 2;
      let fullResponse = '';
      let lastError: string = '';

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) sendProgress(`网络异常，正在第${attempt}次重试...`);
          else sendProgress('正在识别答案...');

          const llmStream = client.stream(messages, {
            model: 'ep-m-20260522100054-r72qh',
            temperature: 0.3,
          });

          fullResponse = '';
          const streamTimeout = 60000;
          const streamStart = Date.now();

          for await (const chunk of llmStream) {
            if (Date.now() - streamStart > streamTimeout) throw new Error('答案识别超时，请重试');
            if (chunk.content) fullResponse += chunk.content.toString();
          }
          break;
        } catch (streamError) {
          lastError = streamError instanceof Error ? streamError.message : String(streamError);
          if (attempt === MAX_RETRIES) {
            const msg = lastError.includes('network') || lastError.includes('Network')
              ? '网络连接异常' : lastError.includes('timeout') || lastError.includes('超时')
              ? '识别超时' : `识别失败：${lastError}`;
            sendError(msg);
            controller.close();
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }

      try {
        sendProgress('正在解析答案...');
        const result = parseAnswerOnlyResponse(fullResponse);
        if (!result) {
          sendError('AI 返回的答案格式不正确，请重试');
          controller.close();
          return;
        }
        sendComplete(result);
      } catch (e) {
        sendError(e instanceof Error ? e.message : '解析失败');
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

/**
 * 全局匹配模式处理：AI 从整页/多页资料中定位答案区域，自动关联到已有题目
 *
 * 优化策略：
 * 1. 分批发送图片（每批最多6张），避免图片过多导致 AI 注意力分散
 * 2. 两阶段匹配：先定位答案页面，再精确匹配每道题
 * 3. 提供完整题目内容（非截断），让 AI 做语义验证
 * 4. 针对英语试卷优化：答案通常在试卷末尾或每大题之后
 */
async function handleGlobalMatchMode(
  client: LLMClient,
  pages: PageImage[],
  existingQuestions: Array<{ id: number; number: number; content: string; questionType: string; hasAnswer: boolean }>,
  customHeaders: Record<string, string>
) {
  // 过滤出需要匹配的题目（没有答案的）
  const unmatchedQuestions = existingQuestions.filter(q => !q.hasAnswer);
  if (unmatchedQuestions.length === 0) {
    // 所有题目都有答案，直接返回空结果
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', data: { message: '所有题目已有答案，无需匹配' } })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', data: { result: { globalMatches: [], answerBoxes: [] } } })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  // 构建完整题目信息（提供完整内容，不截断，方便 AI 做语义匹配）
  const questionsDetail = unmatchedQuestions.map((q, idx) =>
    `【第${q.number}题】类型:${q.questionType}\n题目内容:${q.content}`
  ).join('\n\n---\n\n');

  // 构建带页码标注的图片列表说明
  const pageListDesc = pages.map((p, i) =>
    `第${i + 1}页${p.sourceFileIndex !== undefined ? `(文件${p.sourceFileIndex + 1})` : ''}`
  ).join('、');

  const systemPrompt = `你是一个专业的试卷答案【提取】专家。注意：你的任务是【从图片中原样提取】已有答案，绝不是【生成】或【推理】答案。

## 核心原则（最高优先级，违反即错误）：
⚠️ 【严禁生成答案】你只能从提供的试卷图片中【识别并提取】已经印在纸上的答案和解析文字。
⚠️ 如果图片中没有某道题的答案或解析（比如该题在资料上就没有给答案），那么该题的 answer 和 analysis 字段必须为空字符串 ""。
⚠️ 绝对禁止根据题目内容自行推理、计算、编写答案或解析。这不是解题任务，这是OCR提取任务。
⚠️ 宁可留空也不能编造。留空是正确行为，编造是严重错误。

## 待匹配的题目（共${unmatchedQuestions.length}道）：
${questionsDetail}

## 图片信息：
共${pages.length}页，依次为：${pageListDesc}

## 答案分布规律参考（仅帮助你定位答案在图中的位置）：
1. 选择题：答案通常以 "1.A 2.B 3.C..." 或表格形式出现在后半部分
2. 填空题/完形填空：答案通常紧跟题目后或在答案汇总区
3. 阅读理解：答案通常在该材料后面或统一在末尾
4. 书面表达/翻译：通常只有评分标准或范文，如果没有则不填
5. 整体规律：答案页通常在试卷后半部分（最后1-3页）

## 匹配规则：
1. 通过题号精确匹配：第N题的答案必须对应图片中的"N."或"第N题"标记
2. 语义验证：答案内容必须与题目类型一致
3. 跨页关联：检查所有页面寻找答案
4. 找不到就留空：如果在所有页面中都找不到某题的答案/解析，answer和analysis都填 ""

## 输出格式（严格 JSON 数组）：
[
  {
    "questionId": 题目ID（数字，必须与输入中的id完全一致）,
    "questionNumber": 题号（数字）,
    "answer": "从图片中提取到的答案原文，找不到则填空字符串",
    "analysis": "从图片中提取到的解析原文，找不到则填空字符串",
    "found": true或false（true表示在图片中找到了答案，false表示图片中没有这道题的答案）
  }
]

注意：
- questionId 必须使用输入中的原始 id 数字
- found=false 时，answer 和 analysis 必须都是空字符串 ""
- 只输出没有答案的题目的匹配结果
- 如果整页都没有任何可识别的答案，返回空数组 []`;

  // 分批发送图片：每批最多6张，避免 token 过多导致精度下降
  const BATCH_SIZE = 6;
  const batches: PageImage[][] = [];
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    batches.push(pages.slice(i, i + BATCH_SIZE));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', data: { message } })}\n\n`));
      };
      const sendComplete = (result: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', data: { result } })}\n\n`));
      };
      const sendError = (error: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', data: { error } })}\n\n`));
      };

      const MAX_RETRIES = 2;
      let fullResponse = '';
      let lastError: string = '';

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) sendProgress(`匹配异常，正在第${attempt}次重试...`);
          else sendProgress(`正在分析${pages.length}页资料，匹配${unmatchedQuestions.length}道题目答案...`);

          // 构建用户消息：文本说明 + 分批图片
          const userContent: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string; detail: 'high' | 'low' } }> = [];

          // 添加文本指令
          userContent.push({
            type: 'text',
            text: `请仔细查看以下${pages.length}页试卷图片。
【重要】你的任务是OCR提取，不是解题推理：
1. 只从图片中提取已经印在纸上的答案和解析文字
2. 如果某道题在所有页面上都找不到答案/解析，该题found填false，answer和analysis留空
3. 绝对不要根据题目内容自己写答案或解析
重点扫描后半部分页面（通常是答案区域）。`,
          });

          // 添加所有页面图片（带页码标注）
          for (let pi = 0; pi < pages.length; pi++) {
            userContent.push({
              type: 'image_url',
              image_url: {
                url: pages[pi].imageData,
                detail: 'high',
              },
            });
          }

          const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userContent },
          ];

          const llmStream = client.stream(messages, {
            model: 'ep-m-20260522100054-r72qh',
            temperature: 0.1,  // 降低温度提高确定性
          });

          fullResponse = '';
          const streamTimeout = 300000; // 全局匹配给更多时间
          const streamStart = Date.now();

          for await (const chunk of llmStream) {
            if (Date.now() - streamStart > streamTimeout) throw new Error('全局匹配超时');
            if (chunk.content) fullResponse += chunk.content.toString();
          }
          break;
        } catch (streamError) {
          lastError = streamError instanceof Error ? streamError.message : String(streamError);
          if (attempt === MAX_RETRIES) {
            const msg = lastError.includes('timeout') || lastError.includes('超时')
              ? '匹配超时，请减少题目数量后重试'
              : `全局匹配失败：${lastError}`;
            sendError(msg);
            controller.close();
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }

      try {
        sendProgress('正在校验匹配结果...');

        // 解析 AI 返回（带多层容错）
        let jsonStr = fullResponse.trim();
        console.log(`[全局匹配] AI返回长度: ${jsonStr.length}, 前200字: ${jsonStr.substring(0, 200)}`);

        // 多层容错提取 JSON 数组
        let rawMatches: any[] = [];
        
        // 策略1: 直接正则匹配 [...]
        const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try { rawMatches = JSON.parse(jsonMatch[0]); } catch(e) {
            console.warn('[全局匹配] 策略1 JSON.parse 失败, 尝试修复...', (e as Error).message);
            rawMatches = JSON.parse(tryFixAiJson(jsonMatch[0]));
          }
        }
        
        // 策略2: 提取 markdown 代码块中的内容
        if (rawMatches.length === 0) {
          const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
          if (codeBlockMatch) {
            const inner = codeBlockMatch[1].trim();
            const innerMatch = inner.match(/\[[\s\S]*\]/);
            if (innerMatch) {
              try { rawMatches = JSON.parse(innerMatch[0]); } catch(e) {
                rawMatches = JSON.parse(tryFixAiJson(innerMatch[0]));
              }
            }
          }
        }
        
        // 策略3: 对整个响应做激进修复后尝试
        if (rawMatches.length === 0) {
          console.warn('[全局匹配] 策略1/2均失败, 尝试策略3(全局修复)...');
          const fixed = tryFixAiJson(jsonStr);
          const fixedMatch = fixed.match(/\[[\s\S]*\]/);
          if (fixedMatch) {
            try { rawMatches = JSON.parse(fixedMatch[0]); } catch(e) {
              // 策略4: 逐对象提取
              console.warn('[全局匹配] 策略3也失败, 尝试策略4(逐对象)...');
              const objRegex = /\{[^{}]*"questionId"[^{}]*\}/g;
              let m;
              while ((m = objRegex.exec(fixed)) !== null) {
                try { rawMatches.push(JSON.parse(m[0])); } catch(_) {}
              }
            }
          }
        }

        if (!Array.isArray(rawMatches) || rawMatches.length === 0) {
          console.error('[全局匹配] 所有策略均失败, 原始响应前500字:', jsonStr.substring(0, 500));
          throw new Error('AI 返回格式不正确，未找到有效的题目答案数据');
        }

        console.log(`[全局匹配] 成功解析 ${rawMatches.length} 条匹配结果`);

        // 严格过滤 + 校验
        const validIds = new Set(unmatchedQuestions.map(q => q.id));
        const validMatches = rawMatches.filter((m: any) => {
          if (!m || typeof m.questionId !== 'number' || !validIds.has(m.questionId)) return false;
          // 如果AI明确标记found=false，说明资料上没有这道题的答案，跳过
          if (m.found === false) {
            console.log(`[全局匹配] 第${m.questionNumber || m.questionId}题: AI标记未找到答案，跳过`);
            return false;
          }
          // 答案为空也跳过（没有找到有效答案）
          if (typeof m.answer !== 'string' || m.answer.trim().length === 0) return false;
          return true;
        }).map((m: any) => ({
          questionId: m.questionId,
          questionNumber: typeof m.questionNumber === 'number' ? m.questionNumber : 0,
          answer: m.answer.trim(),
          analysis: (typeof m.analysis === 'string' ? m.analysis : '').trim(),
        }));

        // 二次校验：检查是否有明显错配（如选择题答案不是选项字母）
        const finalMatches = validMatches.filter((m: any) => {
          const q = unmatchedQuestions.find(uq => uq.id === m.questionId);
          if (!q) return false;

          // 选择题答案应该是单个或多个大写字母
          if ((q.questionType === '单选题' || q.questionType === '多选题')) {
            const answerClean = m.answer.replace(/[\s.,;，；、。]/g, '');
            // 允许 "A", "AB", "A.B.C", "A B C" 等格式
            const isValidChoice = /^[A-Z]+([.·\s][A-Z]+)*$/.test(answerClean) ||
                                  /^[A-Z]$/.test(answerClean);
            if (!isValidChoice && answerClean.length > 10) {
              // 选择题答案太长，可能是把解析当答案了，标记为低置信但保留
              console.warn(`[全局匹配警告] 第${q.number}题(${q.questionType})答案疑似过长: "${m.answer.substring(0,30)}..."`);
            }
          }
          return true;
        });

        sendProgress(`匹配完成：${finalMatches.length}/${unmatchedQuestions.length} 道题目成功匹配`);

        sendComplete({
          globalMatches: finalMatches,
          answerBoxes: [],
        });
      } catch (parseError) {
        console.error('[全局匹配解析失败]', parseError);
        console.error('[全局匹配原始响应]', fullResponse.substring(0, 500));
        sendError(parseError instanceof Error ? parseError.message : '全局匹配结果解析失败');
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

/**
 * 完整模式处理（原有逻辑）
 */
async function handleFullMode(
  client: LLMClient,
  pages: PageImage[],
  userBoxes: QuestionBox[],
  customHeaders: Record<string, string>
) {
  // 构建消息
  const messages = [
    {
      role: 'system' as const,
      content: SYSTEM_PROMPT,
    },
    {
      role: 'user' as const,
      content: buildUserMessage(pages),
    },
  ];

  // 创建流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 发送进度消息
      const sendProgress = (message: string) => {
        const data = JSON.stringify({ type: 'progress', data: { message } });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // 发送完成消息
      const sendComplete = (result: object) => {
        const data = JSON.stringify({ type: 'complete', data: { result } });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // 发送错误消息
      const sendError = (error: string) => {
        const data = JSON.stringify({ type: 'error', data: { error } });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const MAX_RETRIES = 2;
      let fullResponse = '';
      let lastError: string = '';

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            sendProgress(`网络异常，正在第${attempt}次重试...`);
          } else {
            sendProgress(`正在识别 ${pages.length} 页图片...`);
          }

          // 调用 Vision Model（带超时控制）
          const llmStream = client.stream(messages, {
            model: 'ep-m-20260522100054-r72qh',
            temperature: 0.3,
          });

          fullResponse = '';
          const streamTimeout = 120000; // 120秒超时
          const streamStart = Date.now();

          for await (const chunk of llmStream) {
            if (Date.now() - streamStart > streamTimeout) {
              throw new Error('识别超时，请减少页数后重试');
            }
            if (chunk.content) {
              fullResponse += chunk.content.toString();
            }
          }

          break;

        } catch (streamError) {
          lastError = streamError instanceof Error ? streamError.message : String(streamError);
          console.error(`AI识别流式调用失败(第${attempt + 1}次):`, lastError);

          if (attempt === MAX_RETRIES) {
            const errorMessage = lastError.includes('network') || lastError.includes('Network')
              ? '网络连接异常，请检查网络后重试'
              : lastError.includes('timeout') || lastError.includes('超时')
                ? '识别超时，请减少页数后重试'
                : `识别失败：${lastError}`;
            sendError(errorMessage);
            controller.close();
            return;
          }

          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }

      try {
        sendProgress('正在解析识别结果...');

        // 解析 AI 响应
        const recognitionResult = parseAIResponse(fullResponse);

        if (!recognitionResult) {
          console.error('AI 响应解析失败，原始响应长度:', fullResponse.length);
          console.error('原始响应前500字符:', fullResponse.slice(0, 500));
          sendError('AI 返回的数据格式不正确，请重新框选题目后再试');
          controller.close();
          return;
        }

        // 如果有用户画的框，进行匹配
        let matchedQuestions: object[] = [];
        let answerMarkers: object[] = [];

        if (userBoxes.length > 0) {
          sendProgress('正在匹配题目和答案...');

          matchedQuestions = generateMatchedQuestions(
            userBoxes,
            recognitionResult,
            pages
          );

          answerMarkers = generateAnswerMarkers(
            matchedQuestions as any[],
            recognitionResult,
            pages
          );
        }

        // 发送完成结果
        sendComplete({
          recognition: recognitionResult,
          matchedQuestions,
          answerMarkers,
        });

        controller.close();
      } catch (parseError) {
        console.error('AI 识别解析失败:', parseError);
        sendError(parseError instanceof Error ? parseError.message : '识别结果解析失败，请重试');
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
