/**
 * 腾讯云智能切题服务 API
 * 使用腾讯云 OCR 文字识别服务的 QuestionSplitOCR 接口，自动识别资料中的题目区域
 *
 * 腾讯云文档：https://cloud.tencent.com/document/product/866/115930
 * 服务端点：ocr.tencentcloudapi.com
 * 接口名称：QuestionSplitOCR（智能切题）
 * 版本：2018-11-19
 *
 * 签名方式：使用腾讯云官方 Node.js SDK (tencentcloud-sdk-nodejs-ocr)
 * 手写签名算法与 SDK 存在细微差异（payload 序列化、content-type 等），
 * 直接使用 SDK 可确保签名 100% 兼容
 */

import { NextRequest } from 'next/server';
import * as OcrSDK from 'tencentcloud-sdk-nodejs-ocr';

// ==================== 腾讯云配置 ====================
// 产品866 = 教育智能(EduSmart)，但切题接口实际在 OCR 服务中
// 文档: https://cloud.tencent.com/document/product/866/115930
const TENCENT_CONFIG = {
  secretId: process.env.TENCENT_SECRET_ID || '',
  secretKey: process.env.TENCENT_SECRET_KEY || '',
  region: 'ap-guangzhou' as const,
};

// 最大页数限制
const MAX_PAGES = 24;

/**
 * 创建腾讯云 OCR 客户端（懒加载，避免模块加载时环境变量未就绪）
 */
function getOcrClient() {
  const Client = OcrSDK.ocr.v20181119.Client;
  return new Client({
    credential: {
      secretId: TENCENT_CONFIG.secretId,
      secretKey: TENCENT_CONFIG.secretKey,
    },
    region: TENCENT_CONFIG.region,
  });
}

/**
 * 调用腾讯云 QuestionSplitOCR 切题接口
 */
async function callTencentCloudAPI(
  payload: { ImageBase64: string; IsPdf: boolean; EnableImageCrop?: boolean },
): Promise<Record<string, unknown>> {
  const client = getOcrClient();
  const result = await client.QuestionSplitOCR(payload);
  return result as unknown as Record<string, unknown>;
}

// ==================== 类型定义 ====================

interface DetectedBox {
  pageNumber: number;
  type: 'question' | 'answer' | 'full';
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

/** Element 坐标结构（腾讯云返回的文本块坐标） */
interface OCRElement {
  Text?: string;
  /** 像素坐标（旧格式，部分接口可能返回） */
  X?: number;
  Y?: number;
  Width?: number;
  Height?: number;
  /** 坐标信息（QuestionSplitOCR 实际返回格式） */
  Coord?: Array<{
    LeftTop?: { X?: number; Y?: number };
    RightTop?: { X?: number; Y?: number };
    LeftBottom?: { X?: number; Y?: number };
    RightBottom?: { X?: number; Y?: number };
  }>;
}

/** ResultList 中的一道题的结构化内容 */
interface ResultList {
  Question?: Array<OCRElement>;
  Option?: Array<OCRElement>;
  Figure?: Array<OCRElement>;
  Table?: Array<OCRElement>;
  Answer?: Array<OCRElement>;
  Parse?: Array<OCRElement>;
  /** 题目区域整体坐标（QuestionSplitOCR 返回） */
  Coord?: Array<{
    LeftTop?: { X?: number; Y?: number };
    RightTop?: { X?: number; Y?: number };
    LeftBottom?: { X?: number; Y?: number };
    RightBottom?: { X?: number; Y?: number };
  }>;
}

/** QuestionSplitOCR 返回的单道题信息 */
interface QuestionInfo {
  Width?: number;   // 题目区域宽度（像素）
  Height?: number;  // 题目区域高度（像素）
  OrgWidth?: number;
  OrgHeight?: number;
  Angle?: number;   // 旋转角度
  ResultList?: Array<ResultList>;
}

// ==================== 切题核心逻辑 ====================

/**
 * 从 ResultList 中计算题目边界框
 * 腾讯云 QuestionSplitOCR 返回两种坐标格式：
 * 1. ResultList[].Coord — 题目区域整体四角坐标（优先使用）
 * 2. 各字段元素(Question/Option等)的Coord — 各文本块坐标
 */
function calculateBoundingBoxFromElements(
  resultList: ResultList[],
): { x: number; y: number; width: number; height: number } | null {
  // 策略1：优先使用 ResultList 级别的 Coord（整体题目区域坐标）
  for (const rl of resultList) {
    if (!rl.Coord || rl.Coord.length === 0) continue;
    const coord = rl.Coord[0];
    const lt = coord.LeftTop, rb = coord.RightBottom;
    if (lt?.X !== undefined && lt?.Y !== undefined && rb?.X !== undefined && rb?.Y !== undefined) {
      return {
        x: lt.X,
        y: lt.Y,
        width: rb.X - lt.X,
        height: rb.Y - lt.Y,
      };
    }
  }

  // 策略2：从各字段元素的 Coord 中聚合
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let foundAny = false;

  const allFields: Array<Array<OCRElement> | undefined> = [
    ...resultList.flatMap(r => [r.Question, r.Option, r.Figure, r.Table, r.Answer, r.Parse]),
  ];

  for (const field of allFields) {
    if (!field) continue;
    for (const el of field) {
      // 优先用 Coord 格式
      if (el.Coord && el.Coord.length > 0) {
        const c = el.Coord[0];
        if (c.LeftTop?.X !== undefined && c.LeftTop?.Y !== undefined) {
          minX = Math.min(minX, c.LeftTop.X);
          minY = Math.min(minY, c.LeftTop.Y);
        }
        if (c.RightBottom?.X !== undefined && c.RightBottom?.Y !== undefined) {
          maxX = Math.max(maxX, c.RightBottom.X);
          maxY = Math.max(maxY, c.RightBottom.Y);
          foundAny = true;
        }
      }
      // 兼容旧格式 X/Y/Width/Height
      else if (el.X !== undefined && el.Y !== undefined && el.Width !== undefined && el.Height !== undefined) {
        minX = Math.min(minX, el.X);
        minY = Math.min(minY, el.Y);
        maxX = Math.max(maxX, el.X + el.Width);
        maxY = Math.max(maxY, el.Y + el.Height);
        foundAny = true;
      }
    }
  }

  if (!foundAny || !isFinite(minX)) return null;

  const padding = 4;
  return {
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * 对单页图片调用腾讯云 QuestionSplitOCR 切题接口
 * 返回该页检测到的题目框列表（像素坐标）
 */
async function cutSinglePage(
  imageDataBase64: string,
  pageIndex: number,
): Promise<DetectedBox[]> {
  try {
    // 去掉 data:image/xxx;base64, 前缀
    const cleanBase64 = imageDataBase64.replace(/^data:[^;]+;base64,/, '');

    // QuestionSplitOCR 请求参数（注意：不需要 AppId，这是 OCR 服务不是教育智能服务）
    console.log(`[TencentCut] 第${pageIndex + 1}页: 调用 QuestionSplitOCR...`);

    const result = await callTencentCloudAPI({
      ImageBase64: cleanBase64,
      IsPdf: false,
      EnableImageCrop: true,
    });

    // QuestionSplitOCR 返回格式: { QuestionInfo: [...] }
    const questionInfoList = (result.QuestionInfo || (result.Data as Record<string, unknown>)?.QuestionInfo || []) as Array<Record<string, unknown>>;

    if (!Array.isArray(questionInfoList) || questionInfoList.length === 0) {
      console.log(`[TencentCut] 第${pageIndex + 1}页: 未检测到题目`);
      return [];
    }

    const boxes: DetectedBox[] = [];

    for (let i = 0; i < questionInfoList.length; i++) {
      const qi = questionInfoList[i] as unknown as QuestionInfo;

      // 方案C：统一标记为 question（题干框）
      // 腾讯云切的每个框是一道完整题目区域，默认当题干处理
      // 答案在步骤2通过全局匹配或手动画框补充

      let box: { x: number; y: number; width: number; height: number };

      if (qi.ResultList && qi.ResultList.length > 0) {
        // 从内部元素坐标计算边界框
        const calculated = calculateBoundingBoxFromElements(qi.ResultList);
        if (calculated) {
          box = calculated;
        } else if (qi.Width && qi.Height) {
          // 兜底：用 Width/Height 但无法确定 x,y，跳过
          console.warn(`[TencentCut] 第${pageIndex + 1}页第${i + 1}题: 无法确定位置`);
          continue;
        } else {
          continue;
        }
      } else if (qi.Width && qi.Height) {
        // 没有 ResultList 但有尺寸信息，无法定位，跳过
        continue;
      } else {
        continue;
      }

      if (box.width > 5 && box.height > 5) {
        boxes.push({
          pageNumber: pageIndex + 1,
          type: 'question', // 方案C：统一标记为题干框
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          confidence: 0.9,
        });
      }
    }

    console.log(`[TencentCut] 第${pageIndex + 1}页: 检测到 ${boxes.length} 个题目框`);

    return boxes;

  } catch (error) {
    console.error(`[TencentCut] 第${pageIndex + 1}页切题失败:`, error);
    return []; // 单页失败不影响其他页
  }
}

// ==================== API 路由处理 ====================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pages }: { pages: Array<{ pageNumber: number; imageData: string; width: number; height: number }> } = body;

    if (!pages || pages.length === 0) {
      return Response.json({ error: '请提供至少一张图片' }, { status: 400 });
    }

    if (pages.length > MAX_PAGES) {
      return Response.json({ error: `最多支持 ${MAX_PAGES} 张图片` }, { status: 400 });
    }

    // 校验腾讯云配置
    if (!TENCENT_CONFIG.secretId || !TENCENT_CONFIG.secretKey) {
      return Response.json(
        { error: '腾讯云切题服务未配置，请联系管理员设置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY' },
        { status: 500 },
      );
    }

    // SSE 流式响应
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

        try {
          sendProgress(`正在调用腾讯云切题服务(OCR)，共 ${pages.length} 页...`);

          const allBoxes: DetectedBox[] = [];

          // 逐页调用（并发控制：最多3个并发）
          const CONCURRENCY = 3;
          for (let i = 0; i < pages.length; i += CONCURRENCY) {
            const batch = pages.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
              batch.map((page, idx) => cutSinglePage(page.imageData, i + idx)),
            );

            for (let j = 0; j < results.length; j++) {
              const result = results[j];
              if (result.status === 'fulfilled') {
                allBoxes.push(...result.value);
              }
            }

            sendProgress(`已处理 ${Math.min(i + CONCURRENCY, pages.length)}/${pages.length} 页...`);
          }

          // 将像素坐标转换为百分比坐标
          const percentageBoxes = allBoxes.map((box) => {
            const pageInfo = pages[box.pageNumber - 1];
            const imgWidth = pageInfo?.width || 595;
            const imgHeight = pageInfo?.height || 842;

            return {
              ...box,
              x: (box.x / imgWidth) * 100,
              y: (box.y / imgHeight) * 100,
              width: (box.width / imgWidth) * 100,
              height: (box.height / imgHeight) * 100,
            };
          });

          sendProgress(`切题完成！共发现 ${percentageBoxes.length} 个题目区域`);

          setTimeout(() => {
            sendComplete({ boxes: percentageBoxes, total: percentageBoxes.length });
            controller.close();
          }, 300);

        } catch (error) {
          console.error('[TencentCut] 切题流程失败:', error);
          const msg = error instanceof Error ? error.message : String(error);
          sendError(msg.includes('腾讯云') ? msg : `切题失败：${msg}`);
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

  } catch (error) {
    console.error('[TencentCut] API 入口错误:', error);
    return Response.json(
      { error: '服务器内部错误' },
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
