import { db, nowIso } from './db.js';

/**
 * AI 异步任务持久化。
 *
 * 只解决「实例重启 / 重新部署后任务状态丢失」这一个问题：
 * - 任务状态落 ai_job 表，重启后仍可继续轮询；
 * - 仍按单实例设计，不承诺多实例共享或跨实例调度；
 * - 10 分钟过期，过期任务读接口返回不存在。
 */

export type AiJobStatus = 'pending' | 'done' | 'error';

export interface AiJobError {
  code: string;
  message: string;
  detail?: string;
}

export interface AiJob<T = unknown> {
  id: string;
  kind: string;
  status: AiJobStatus;
  payload: unknown;
  result: T | null;
  error: AiJobError | null;
  createdAt: string;
  expiresAt: string;
}

const JOB_TTL_MS = 10 * 60 * 1000;

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function sweepExpired(): void {
  db.prepare('DELETE FROM ai_job WHERE expires_at < ?').run(nowIso());
}

export function createAiJob(id: string, kind: string, payload: unknown): void {
  sweepExpired();
  const now = Date.now();
  db.prepare(
    'INSERT INTO ai_job (id, kind, status, payload_json, result_json, error_json, created_at, expires_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)',
  ).run(
    id,
    kind,
    'pending',
    JSON.stringify(payload ?? null),
    new Date(now).toISOString(),
    new Date(now + JOB_TTL_MS).toISOString(),
  );
}

export function getAiJob<T = unknown>(id: string): AiJob<T> | undefined {
  const row = db.prepare('SELECT * FROM ai_job WHERE id = ?').get(id) as
    | {
        id: string;
        kind: string;
        status: AiJobStatus;
        payload_json: string | null;
        result_json: string | null;
        error_json: string | null;
        created_at: string;
        expires_at: string;
      }
    | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM ai_job WHERE id = ?').run(id);
    return undefined;
  }
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    payload: parseJson(row.payload_json, null),
    result: parseJson<T | null>(row.result_json, null),
    error: parseJson<AiJobError | null>(row.error_json, null),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function finishAiJob(id: string, result: unknown): void {
  db.prepare("UPDATE ai_job SET status = 'done', result_json = ? WHERE id = ? AND status = 'pending'").run(
    JSON.stringify(result ?? null),
    id,
  );
}

export function failAiJob(id: string, error: AiJobError): void {
  db.prepare("UPDATE ai_job SET status = 'error', error_json = ? WHERE id = ? AND status = 'pending'").run(
    JSON.stringify(error),
    id,
  );
}

/** 同一类任务是否仍在进行；kind 用业务前缀区分（如 interview:12:answer）。 */
export function hasPendingAiJob(kind: string): boolean {
  const row = db
    .prepare("SELECT 1 AS n FROM ai_job WHERE kind = ? AND status = 'pending' AND expires_at > ? LIMIT 1")
    .get(kind, nowIso()) as { n: number } | undefined;
  return !!row;
}
