import { db, nowIso } from './db.js';

/**
 * 复盘 / 题库的间隔重复排程。
 *
 * 依据全部来自数据库里的真实字段：
 * - 上次练习时间（bank_item.last_practiced_at）
 * - 自评星级（review.rating）
 * - 薄弱标记（bank_item.weak）
 * - 创建时间（created_at）
 * 没有任何随机数或写死的「到期名单」。
 *
 * 间隔阶梯（天）：1 / 3 / 7 / 14 / 30。复习结果只做三档判断：
 * - good  记住了：升一档，按新档位间隔
 * - ok    有点模糊：档位不变，按当前档位间隔
 * - again 没记住：重置回第 0 档（1 天）
 */

export const REVIEW_LADDER = [1, 3, 7, 14, 30];

export type ReviewKind = 'bank' | 'review';
export type ReviewResult = 'good' | 'ok' | 'again';

export const RESULT_LABEL: Record<ReviewResult, string> = {
  good: '记住了',
  ok: '有点模糊',
  again: '没记住',
};

function dayOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function today(): string {
  return dayOf(new Date());
}

function dateOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dayOf(d);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return dayOf(new Date(y, m - 1, d + days, 12));
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

function clampStage(n: number): number {
  return Math.max(0, Math.min(REVIEW_LADDER.length - 1, Math.trunc(n)));
}

interface Seed {
  stage: number;
  dueAt: string;
}

/** 题库：薄弱 → 立即到期；练过 → 上次练习 +1 天；没练过 → 入库 +1 天 */
function seedForBank(row: { weak: number; last_practiced_at: string | null; created_at: string }): Seed {
  if (Number(row.weak) === 1) return { stage: 0, dueAt: today() };
  const base = dateOfIso(row.last_practiced_at) || dateOfIso(row.created_at) || today();
  return { stage: 0, dueAt: addDays(base, REVIEW_LADDER[0]) };
}

/** 复盘：自评 1-2 星 → 立即到期；3 星 → +1 天；4 星 → 第 1 档 +3 天；5 星 → 第 2 档 +7 天 */
function seedForReview(row: { rating: number; created_at: string }): Seed {
  const base = dateOfIso(row.created_at) || today();
  const rating = Math.max(1, Math.min(5, Number(row.rating) || 3));
  if (rating <= 2) return { stage: 0, dueAt: today() };
  if (rating === 3) return { stage: 0, dueAt: addDays(base, REVIEW_LADDER[0]) };
  if (rating === 4) return { stage: 1, dueAt: addDays(base, REVIEW_LADDER[1]) };
  return { stage: 2, dueAt: addDays(base, REVIEW_LADDER[2]) };
}

/** 给还没进排程的历史题目补一条任务；已有任务不动。 */
export function ensureReviewTasks(): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO review_task (kind, ref_id, stage, due_at, last_reviewed_at, reps, lapses, updated_at) VALUES (?, ?, ?, ?, NULL, 0, 0, ?)',
  );
  const now = nowIso();
  const banks = db
    .prepare('SELECT id, question, weak, last_practiced_at, created_at FROM bank_item')
    .all() as { id: number; question: string; weak: number; last_practiced_at: string | null; created_at: string }[];
  const bankQuestions = new Set(banks.map((b) => b.question.trim()));
  for (const b of banks) {
    const seed = seedForBank(b);
    insert.run('bank', b.id, seed.stage, seed.dueAt, now);
  }
  const reviews = db.prepare('SELECT id, question, rating, created_at FROM review').all() as {
    id: number;
    question: string;
    rating: number;
    created_at: string;
  }[];
  for (const r of reviews) {
    // 同名题目已进题库时不再重复排期，避免「今日待复习」出现同一道题两次。
    if (bankQuestions.has(r.question.trim())) continue;
    const seed = seedForReview(r);
    insert.run('review', r.id, seed.stage, seed.dueAt, now);
  }
}

export interface ScheduledTask {
  kind: ReviewKind;
  refId: number;
  question: string;
  category: string | null;
  jobTitle: string | null;
  weak: number;
  stage: number;
  dueAt: string;
  lastReviewedAt: string | null;
  reps: number;
  rating: number | null;
  myAnswer: string | null;
  improvement: string | null;
  lastScore: number | null;
  askCount: number | null;
}

type TaskRow = {
  kind: ReviewKind;
  ref_id: number;
  stage: number;
  due_at: string;
  last_reviewed_at: string | null;
  reps: number;
  question: string;
  category?: string | null;
  weak?: number | null;
  last_score?: number | null;
  ask_count?: number | null;
  job_title?: string | null;
  rating?: number | null;
  my_answer?: string | null;
  improvement?: string | null;
};

function allTasks(): ScheduledTask[] {
  ensureReviewTasks();
  const bankRows = db
    .prepare(
      `SELECT t.kind, t.ref_id, t.stage, t.due_at, t.last_reviewed_at, t.reps,
              b.question, b.category, b.weak, b.last_score, b.ask_count, j.title AS job_title
       FROM review_task t
       JOIN bank_item b ON t.kind = 'bank' AND b.id = t.ref_id
       LEFT JOIN job j ON j.id = b.job_id`,
    )
    .all() as TaskRow[];
  const reviewRows = db
    .prepare(
      `SELECT t.kind, t.ref_id, t.stage, t.due_at, t.last_reviewed_at, t.reps,
              r.question, r.rating, r.my_answer, r.improvement, j.title AS job_title
       FROM review_task t
       JOIN review r ON t.kind = 'review' AND r.id = t.ref_id
       LEFT JOIN job j ON j.id = r.job_id`,
    )
    .all() as TaskRow[];
  const bankQuestions = new Set(bankRows.map((r) => r.question.trim()));
  const rows = [...bankRows, ...reviewRows.filter((r) => !bankQuestions.has(r.question.trim()))];
  return rows.map((r) => ({
    kind: r.kind,
    refId: r.ref_id,
    question: r.question,
    category: r.category ?? null,
    jobTitle: r.job_title ?? null,
    weak: Number(r.weak ?? 0),
    stage: Number(r.stage),
    dueAt: r.due_at,
    lastReviewedAt: r.last_reviewed_at,
    reps: Number(r.reps),
    rating: r.rating != null ? Number(r.rating) : null,
    myAnswer: r.my_answer ?? null,
    improvement: r.improvement ?? null,
    lastScore: r.last_score != null ? Number(r.last_score) : null,
    askCount: r.ask_count != null ? Number(r.ask_count) : null,
  }));
}

export interface DueTask extends ScheduledTask {
  overdueDays: number;
}

export interface TodayPlan {
  today: string;
  dueCount: number;
  overdueCount: number;
  scheduled: number;
  nextDueAt: string | null;
  ladder: number[];
  tasks: DueTask[];
}

export function getTodayPlan(): TodayPlan {
  const todayStr = today();
  const tasks = allTasks();
  const due = tasks
    .filter((t) => t.dueAt <= todayStr)
    .sort((a, b) => (a.dueAt === b.dueAt ? a.refId - b.refId : a.dueAt < b.dueAt ? -1 : 1));
  const future = tasks.filter((t) => t.dueAt > todayStr).map((t) => t.dueAt).sort();
  return {
    today: todayStr,
    dueCount: due.length,
    overdueCount: due.filter((t) => t.dueAt < todayStr).length,
    scheduled: tasks.length,
    nextDueAt: future[0] ?? null,
    ladder: REVIEW_LADDER,
    tasks: due.map((t) => ({ ...t, overdueDays: Math.max(0, daysBetween(t.dueAt, todayStr)) })),
  };
}

export interface RecordedResult {
  kind: ReviewKind;
  refId: number;
  result: ReviewResult;
  stage: number;
  intervalDays: number;
  dueAt: string;
  nextDueAt: string;
}

export function recordReviewResult(kind: ReviewKind, refId: number, result: ReviewResult): RecordedResult {
  ensureReviewTasks();
  const task = db.prepare('SELECT stage FROM review_task WHERE kind = ? AND ref_id = ?').get(kind, refId) as
    | { stage: number }
    | undefined;
  if (!task) throw new Error('这道题还没有进入复习排程');
  const current = clampStage(task.stage);
  const nextStage = result === 'good' ? clampStage(current + 1) : result === 'again' ? 0 : current;
  const intervalDays = REVIEW_LADDER[nextStage];
  const dueAt = addDays(today(), intervalDays);
  const now = nowIso();
  db.prepare(
    'UPDATE review_task SET stage = ?, due_at = ?, last_reviewed_at = ?, reps = reps + 1, lapses = lapses + ?, updated_at = ? WHERE kind = ? AND ref_id = ?',
  ).run(nextStage, dueAt, now, result === 'again' ? 1 : 0, now, kind, refId);
  return { kind, refId, result, stage: nextStage, intervalDays, dueAt, nextDueAt: dueAt };
}
