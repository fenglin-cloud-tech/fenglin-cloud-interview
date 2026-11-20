import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  status: number;
  code: string;
  detail?: string;
  constructor(status: number, message: string, code = 'BAD_REQUEST', detail?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function str(v: unknown, max = 20000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function idOf(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '无效的 ID');
  return id;
}

/** 以附件形式返回 docx；中文文件名走 RFC 5987 的 filename*，不依赖响应头编码。 */
export function sendDocx(res: Response, filename: string, data: Buffer): void {
  const safe = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'export.docx';
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`);
  res.setHeader('Content-Length', String(data.length));
  res.send(data);
}
