/**
 * 浏览器本地 PDF 处理：优先抽文本层，文字过少则渲染成图片。
 * 电子简历的原文不会离开浏览器；只有扫描件才会以图片形式发给服务端视觉模型。
 */

export interface ImagePayload {
  mimeType: string;
  base64: string;
}

export interface PdfParseResult {
  mode: 'text' | 'image';
  pages: number;
  chars: number;
  text?: string;
  images?: ImagePayload[];
}

const TEXT_THRESHOLD = 200; // 去掉空白后的字符数
const MAX_PAGES = 3;
const RENDER_SCALE = 1.2;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function parsePdf(file: File): Promise<PdfParseResult> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const pageTexts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    const text = pageTexts
      .join('\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const chars = text.replace(/\s/g, '').length;

    if (chars >= TEXT_THRESHOLD) {
      return { mode: 'text', pages: doc.numPages, chars, text };
    }

    // 文本层为空或过少：按扫描件处理，渲染成 PNG 再交给视觉模型
    const images: ImagePayload[] = [];
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建画布，请更换浏览器重试');
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      images.push({ mimeType: 'image/png', base64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    }
    return { mode: 'image', pages: doc.numPages, chars, images };
  } finally {
    try {
      await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      /* 释放失败不影响解析结果 */
    }
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function imageFileToPayload(file: File): Promise<ImagePayload> {
  // 大图先等比缩到长边 1400px 再转 JPEG，既控制体积也降低视觉模型耗时
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const maxEdge = Math.max(bitmap.width, bitmap.height);
      if (maxEdge > 1400 || file.size > 1.5 * 1024 * 1024) {
        const scale = Math.min(1, 1400 / maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          bitmap.close();
          return { mimeType: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
        }
      }
      bitmap.close();
    } catch {
      /* 缩图失败就按原图上传 */
    }
  }
  return { mimeType: file.type, base64: arrayBufferToBase64(await file.arrayBuffer()) };
}

export function dataUrlOf(image: ImagePayload): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}
