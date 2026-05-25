/**
 * PDF 处理工具
 * 用于将 PDF 文件转换为图片，支持多页处理
 */

import { pdfjs } from 'react-pdf';
import type { PageImage } from '@/types/recognition';

// 确保在浏览器环境下设置 worker
const setupWorker = () => {
  if (typeof window !== 'undefined') {
    const workerSrc = '/pdf-worker/pdf.worker.min.mjs';
    if (pdfjs.GlobalWorkerOptions.workerSrc !== workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    }
  }
};

/**
 * PDF 处理配置
 */
export interface PDFProcessorConfig {
  scale?: number; // 缩放比例，默认 1.5
  maxWidth?: number; // 最大宽度，默认 1200
  quality?: number; // JPEG 质量，默认 0.8
  maxPages?: number; // 最大页数限制，默认 24
  startPage?: number; // 起始页码（1-based），默认 1，用于从指定页开始渲染
}

/**
 * 处理结果
 */
export interface PDFProcessResult {
  pages: PageImage[];
  totalPages: number;
  processedPages: number;
  isTruncated: boolean;
}

/**
 * 将 PDF 文件转换为图片数组
 * 在浏览器端运行
 */
export async function pdfToImages(
  file: File,
  config: PDFProcessorConfig = {}
): Promise<PDFProcessResult> {
  const { scale = 1.5, maxWidth = 1200, quality = 0.8, maxPages = 24, startPage = 1 } = config;

  // 确保 worker 设置
  setupWorker();

  try {
    // 读取文件为 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // 加载 PDF 文档
    const pdf = await pdfjs.getDocument({
      data: arrayBuffer,
    }).promise;

    const totalPages = pdf.numPages;
    const effectiveStartPage = Math.max(1, Math.min(startPage, totalPages));
    const pagesRemaining = totalPages - effectiveStartPage + 1;
    const pagesToProcess = Math.min(pagesRemaining, maxPages);
    const pages: PageImage[] = [];

    // 逐页处理（从 startPage 开始）
    for (let i = 0; i < pagesToProcess; i++) {
      const pageIndex = effectiveStartPage + i; // PDF 页码（1-based）
      try {
        const page = await pdf.getPage(pageIndex);

        // 计算合适的缩放比例
        const viewport = page.getViewport({ scale: 1 });
        const actualScale = Math.min(scale, maxWidth / viewport.width);
        const scaledViewport = page.getViewport({ scale: actualScale });

        // 创建 canvas
        const canvas = document.createElement('canvas');
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('无法创建 Canvas 上下文');
          continue;
        }

        // 渲染页面到 canvas
        const renderTask = page.render({
          canvasContext: ctx,
          viewport: scaledViewport,
          // @ts-ignore - pdfjs 类型定义可能不完整
          canvas: canvas,
        });
        await renderTask.promise;

        // 转换为 base64 图片
        const imageData = canvas.toDataURL('image/jpeg', quality);

        pages.push({
          pageNumber: pageIndex, // 使用 PDF 中的实际页码
          imageData,
          width: scaledViewport.width,
          height: scaledViewport.height,
        });
      } catch (pageError) {
        console.error(`处理第 ${pageIndex} 页失败:`, pageError);
      }
    }

    return {
      pages,
      totalPages,
      processedPages: pagesToProcess,
      isTruncated: totalPages > maxPages,
    };
  } catch (error) {
    console.error('PDF 转换失败:', error);
    throw new Error('PDF 文件处理失败，请确保文件格式正确');
  }
}

/**
 * 获取 PDF 文件的总页数（不转换图片，仅读取页数）
 */
export async function getPdfPageCount(file: File): Promise<number> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({
      data: arrayBuffer,
    }).promise;
    return pdf.numPages;
  } catch (error) {
    console.error('获取 PDF 页数失败:', error);
    return 0;
  }
}

/**
 * 判断文件是否为 PDF
 */
export function isPdfFile(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();
  return mimeType.includes('pdf') || fileName.endsWith('.pdf');
}

/**
 * 判断文件是否为图片
 */
export function isImageFile(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif'];
  return mimeType.startsWith('image/') || imageExtensions.some(ext => fileName.endsWith(ext));
}

/**
 * 将图片文件转换为 PageImage 格式
 */
export async function imageFileToPageImage(file: File): Promise<PageImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // 创建 canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建 Canvas 上下文'));
        return;
      }

      // 绘制图片到 canvas
      ctx.drawImage(img, 0, 0);

      // 转换为 base64
      const imageData = canvas.toDataURL('image/jpeg', 0.8);

      resolve({
        pageNumber: 1,
        imageData,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * 处理上传的文件（PDF 或图片），统一返回 PageImage 数组
 */
export async function processUploadedFile(
  file: File,
  config: PDFProcessorConfig = {}
): Promise<PDFProcessResult> {
  if (isPdfFile(file)) {
    return pdfToImages(file, config);
  } else if (isImageFile(file)) {
    const pageImage = await imageFileToPageImage(file);
    return {
      pages: [pageImage],
      totalPages: 1,
      processedPages: 1,
      isTruncated: false,
    };
  } else {
    throw new Error('不支持的文件格式，请上传 PDF 或图片文件');
  }
}

/**
 * 裁剪图片指定区域
 */
export function cropImage(
  imageData: string,
  bbox: { x: number; y: number; width: number; height: number },
  originalWidth: number,
  originalHeight: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建 Canvas 上下文'));
        return;
      }

      // bbox 是像素坐标，直接使用
      canvas.width = bbox.width;
      canvas.height = bbox.height;

      ctx.drawImage(
        img,
        bbox.x,
        bbox.y,
        bbox.width,
        bbox.height,
        0,
        0,
        bbox.width,
        bbox.height
      );

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageData;
  });
}

/**
 * 批量裁剪图片
 */
export async function batchCropImages(
  imageData: string,
  boxes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  originalWidth: number,
  originalHeight: number
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageData;
  });

  for (const box of boxes) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    canvas.width = box.width;
    canvas.height = box.height;

    ctx.drawImage(
      img,
      box.x,
      box.y,
      box.width,
      box.height,
      0,
      0,
      box.width,
      box.height
    );

    result.set(box.id, canvas.toDataURL('image/png'));
  }

  return result;
}

/**
 * 垂直拼接两张图片
 * 将两张裁剪后的图片上下拼合为一张，用于跨页框的合并
 */
export async function stitchImagesVertically(
  topImageData: string,
  bottomImageData: string
): Promise<string> {
  const topImg = new Image();
  const bottomImg = new Image();

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      topImg.onload = () => resolve();
      topImg.onerror = () => reject(new Error('顶部图片加载失败'));
      topImg.src = topImageData;
    }),
    new Promise<void>((resolve, reject) => {
      bottomImg.onload = () => resolve();
      bottomImg.onerror = () => reject(new Error('底部图片加载失败'));
      bottomImg.src = bottomImageData;
    }),
  ]);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建canvas上下文');

  // 取两张图片中较大的宽度
  const maxWidth = Math.max(topImg.naturalWidth, bottomImg.naturalWidth);
  canvas.width = maxWidth;
  canvas.height = topImg.naturalHeight + bottomImg.naturalHeight;

  // 绘制顶部图片
  ctx.drawImage(topImg, 0, 0, topImg.naturalWidth, topImg.naturalHeight);
  // 绘制底部图片
  ctx.drawImage(bottomImg, 0, topImg.naturalHeight, bottomImg.naturalWidth, bottomImg.naturalHeight);

  return canvas.toDataURL('image/png');
}
