import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { buildDocx } from '../docx-export.js';
import { REVIEW_LADDER, RESULT_LABEL, ensureReviewTasks, getTodayPlan, recordReviewResult } from '../review-schedule.js';
import type { ReviewKind, ReviewResult } from '../review-schedule.js';
import { HttpError, ah, idOf, num, sendDocx, str } from '../util.js';

export const reviewRouter = Router();

ensureJobColumn();

/* ---------------- 记忆曲线复习排程 ---------------- */

reviewRouter.get('/review-plan/today', (_req, res) => {
  res.json(getTodayPlan());
});

reviewRouter.post('/review-plan/:kind/:refId/result', (req, res) => {
  const kind = String(req.params.kind);
  if (kind !== 'bank' && kind !== 'review') throw new HttpError(400, '复习类型不正确');
  const refId = Number(req.params.refId);
  if (!Number.isInteger(refId) || refId <= 0) throw new HttpError(400, '题目 ID 不正确');
  const result = String(req.body?.result || '');
  if (result !== 'good' && result !== 'ok' && result !== 'again') throw new HttpError(400, '请选择复习结果');
  let recorded;
  try {
    recorded = recordReviewResult(kind as ReviewKind, refId, result as ReviewResult);
  } catch {
    throw new HttpError(404, '这道题还没有进入复习排程');
  }
  res.json({ ...recorded, resultLabel: RESULT_LABEL[result as ReviewResult], ladder: REVIEW_LADDER });
});

/* ---------------- 复盘记录 ---------------- */

reviewRouter.get('/reviews', (req, res) => {
  const q = str(req.query.q, 100).trim();
  const jobId = req.query.jobId ? Number(req.query.jobId) : null;
  const rating = req.query.rating ? Number(req.query.rating) : null;
  const tag = str(req.query.tag, 40).trim();
  const from = str(req.query.from, 10).trim();
  const to = str(req.query.to, 10).trim();
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const limitRaw = req.query.limit ? Number(req.query.limit) : 50;
  const limit = Number.isInteger(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (q) {
    conds.push('(rv.question LIKE ? OR rv.improvement LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (jobId) {
    conds.push('rv.job_id = ?');
    params.push(jobId);
  }
  if (rating && rating >= 1 && rating <= 5) {
    conds.push('rv.rating = ?');
    params.push(rating);
  }
  if (tag) {
    conds.push('rv.tags LIKE ?');
    params.push(`%${tag}%`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conds.push('rv.created_at >= ?');
    params.push(`${from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conds.push('rv.created_at <= ?');
    params.push(`${to}T23:59:59.999Z`);
  }
  if (cursor) {
    conds.push('rv.id < ?');
    params.push(cursor);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT rv.*, j.title AS job_title
       FROM review rv LEFT JOIN job j ON j.id = rv.job_id
       ${where}
       ORDER BY rv.id DESC LIMIT ?`,
    )
    .all(...params, limit);
  const nextCursor = rows.length === limit ? (rows[rows.length - 1] as { id: number }).id : null;
  res.json({ reviews: rows, nextCursor });
});

/** 兼容旧库：review 表按需补 job_id 列 */
function ensureJobColumn(): void {
  const cols = db.prepare('PRAGMA table_info(review)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'job_id')) {
    db.exec('ALTER TABLE review ADD COLUMN job_id INTEGER');
  }
}

reviewRouter.post('/reviews', (req, res) => {
  const body = req.body ?? {};
  const question = str(body.question, 500).trim();
  if (!question) throw new HttpError(400, '请填写题目');
  const info = db
    .prepare(
      'INSERT INTO review (interview_id, bank_id, job_id, question, my_answer, performance, improvement, rating, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      body.interviewId ? Number(body.interviewId) : null,
      body.bankId ? Number(body.bankId) : null,
      body.jobId ? Number(body.jobId) : null,
      question,
      str(body.myAnswer, 6000),
      str(body.performance, 4000),
      str(body.improvement, 4000),
      Math.max(1, Math.min(5, num(body.rating, 3))),
      str(body.tags, 200),
      nowIso(),
    );
  res.status(201).json({ review: db.prepare('SELECT * FROM review WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

reviewRouter.put('/reviews/:id', (req, res) => {
  const id = idOf(req);
  const existing = db.prepare('SELECT * FROM review WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new HttpError(404, '复盘记录不存在');
  const body = req.body ?? {};
  db.prepare(
    'UPDATE review SET question = ?, job_id = ?, my_answer = ?, performance = ?, improvement = ?, rating = ?, tags = ? WHERE id = ?',
  ).run(
    body.question !== undefined ? str(body.question, 500).trim() : String(existing.question),
    body.jobId !== undefined ? (body.jobId ? Number(body.jobId) : null) : (existing.job_id as number | null),
    body.myAnswer !== undefined ? str(body.myAnswer, 6000) : String(existing.my_answer),
    body.performance !== undefined ? str(body.performance, 4000) : String(existing.performance),
    body.improvement !== undefined ? str(body.improvement, 4000) : String(existing.improvement),
    body.rating !== undefined ? Math.max(1, Math.min(5, num(body.rating, 3))) : Number(existing.rating),
    body.tags !== undefined ? str(body.tags, 200) : String(existing.tags),
    id,
  );
  res.json({ review: db.prepare('SELECT * FROM review WHERE id = ?').get(id) });
});

reviewRouter.delete('/reviews/:id', (req, res) => {
  const id = idOf(req);
  db.prepare("DELETE FROM application_link WHERE kind = 'review' AND ref_id = ?").run(id);
  db.prepare('DELETE FROM review WHERE id = ?').run(id);
  db.prepare("DELETE FROM review_task WHERE kind = 'review' AND ref_id = ?").run(id);
  res.json({ ok: true });
});

function reviewRows(): Record<string, unknown>[] {
  return db
    .prepare('SELECT rv.*, j.title AS job_title FROM review rv LEFT JOIN job j ON j.id = rv.job_id ORDER BY rv.id DESC')
    .all() as Record<string, unknown>[];
}

function reviewMarkdown(rows: Record<string, unknown>[]): string {
  const lines = ['# 丰麟云面 · 复盘记录导出', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
  if (!rows.length) lines.push('（暂无复盘记录）');
  rows.forEach((r, i) => {
    lines.push(
      `## ${i + 1}. ${String(r.question)}`,
      `- 时间：${new Date(String(r.created_at)).toLocaleString('zh-CN')}`,
      `- 关联岗位：${r.job_title || '未关联'}`,
      `- 自评：${'★'.repeat(Number(r.rating))}${'☆'.repeat(5 - Number(r.rating))}`,
      `- 标签：${r.tags || '无'}`,
      '',
      '**我的回答**',
      '',
      String(r.my_answer || '（未填写）'),
      '',
      '**实际表现**',
      '',
      String(r.performance || '（未填写）'),
      '',
      '**改进点**',
      '',
      String(r.improvement || '（未填写）'),
      '',
    );
  });
  return lines.join('\n');
}

reviewRouter.get('/reviews/export', (_req, res) => {
  const rows = reviewRows();
  res.json({ markdown: reviewMarkdown(rows), count: rows.length });
});

reviewRouter.get(
  '/reviews/export/docx',
  ah(async (_req, res) => {
    const rows = reviewRows();
    const buffer = await buildDocx('复盘记录', reviewMarkdown(rows));
    sendDocx(res, `复盘记录-${new Date().toISOString().slice(0, 10)}.docx`, buffer);
  }),
);

/* ---------------- 个人题库 ---------------- */

reviewRouter.get('/bank', (req, res) => {
  const category = str(req.query.category, 40).trim();
  const onlyWeak = req.query.weak === '1';
  const jobId = req.query.jobId ? Number(req.query.jobId) : null;
  const q = str(req.query.q, 100).trim();
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const limitRaw = req.query.limit ? Number(req.query.limit) : 50;
  const limit = Number.isInteger(limitRaw) ? Math.min(300, Math.max(1, limitRaw)) : 50;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (category) {
    conds.push('b.category = ?');
    params.push(category);
  }
  if (onlyWeak) conds.push('b.weak = 1');
  if (jobId) {
    conds.push('b.job_id = ?');
    params.push(jobId);
  }
  if (q) {
    conds.push('b.question LIKE ?');
    params.push(`%${q}%`);
  }
  if (cursor) {
    conds.push('b.id < ?');
    params.push(cursor);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  ensureReviewTasks();
  const items = db
    .prepare(
      `SELECT b.*, t.due_at AS next_review_at, t.stage AS review_stage
       FROM bank_item b
       LEFT JOIN review_task t ON t.kind = 'bank' AND t.ref_id = b.id
       ${where} ORDER BY b.weak DESC, b.id DESC LIMIT ?`,
    )
    .all(...params, limit);
  const nextCursor = items.length === limit ? (items[items.length - 1] as { id: number }).id : null;
  const facet = db.prepare('SELECT category, COUNT(*) AS n FROM bank_item GROUP BY category').all() as {
    category: string;
    n: number;
  }[];
  const totals = db
    .prepare('SELECT COUNT(*) AS total, SUM(weak) AS weakCount, SUM(ask_count) AS asks FROM bank_item')
    .get() as { total: number; weakCount: number | null; asks: number | null };
  res.json({
    items,
    nextCursor,
    facets: facet,
    totals: { total: totals.total, weak: totals.weakCount ?? 0, asks: totals.asks ?? 0 },
  });
});

reviewRouter.post('/bank', (req, res) => {
  const body = req.body ?? {};
  const question = str(body.question, 500).trim();
  if (!question) throw new HttpError(400, '请填写题目');
  const dup = db.prepare('SELECT id FROM bank_item WHERE question = ?').get(question) as { id: number } | undefined;
  if (dup) throw new HttpError(409, '题库里已经有这道题了');
  const info = db
    .prepare(
      'INSERT INTO bank_item (question, category, job_id, source, weak, ask_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    )
    .run(
      question,
      str(body.category, 40) || '专业',
      body.jobId ? Number(body.jobId) : null,
      str(body.source, 20) || 'manual',
      body.weak ? 1 : 0,
      nowIso(),
    );
  res.status(201).json({ item: db.prepare('SELECT * FROM bank_item WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

reviewRouter.patch('/bank/:id', (req, res) => {
  const id = idOf(req);
  const existing = db.prepare('SELECT * FROM bank_item WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new HttpError(404, '题目不存在');
  const body = req.body ?? {};
  if (body.weak !== undefined) {
    db.prepare('UPDATE bank_item SET weak = ? WHERE id = ?').run(body.weak ? 1 : 0, id);
  }
  if (body.category !== undefined) {
    db.prepare('UPDATE bank_item SET category = ? WHERE id = ?').run(str(body.category, 40), id);
  }
  if (body.question !== undefined) {
    const q = str(body.question, 500).trim();
    if (q) db.prepare('UPDATE bank_item SET question = ? WHERE id = ?').run(q, id);
  }
  if (body.jobId !== undefined) {
    db.prepare('UPDATE bank_item SET job_id = ? WHERE id = ?').run(body.jobId ? Number(body.jobId) : null, id);
  }
  res.json({ item: db.prepare('SELECT * FROM bank_item WHERE id = ?').get(id) });
});

reviewRouter.delete('/bank/:id', (req, res) => {
  const id = idOf(req);
  db.prepare('DELETE FROM bank_item WHERE id = ?').run(id);
  db.prepare("DELETE FROM review_task WHERE kind = 'bank' AND ref_id = ?").run(id);
  res.json({ ok: true });
});

/* 从一场面试一键生成复盘草稿（题目 + 我的回答 + 反馈要点） */
reviewRouter.post(
  '/reviews/from-interview/:id',
  ah(async (req, res) => {
    const interviewId = idOf(req);
    // FUNC-13：可选把追问也沉淀成复盘；默认只取主问题，保持旧行为。
    const includeFollowups = req.body?.includeFollowups === true;
    const turns = db
      .prepare(
        `SELECT * FROM interview_turn WHERE interview_id = ? AND answer IS NOT NULL ${
          includeFollowups ? '' : 'AND depth = 0'
        } ORDER BY seq ASC`,
      )
      .all(interviewId) as {
      question: string;
      answer: string;
      feedback_json: string | null;
      score: number | null;
      depth: number;
    }[];
    if (!turns.length) throw new HttpError(400, '这场面试还没有作答记录');
    const iv = db.prepare('SELECT job_id FROM interview WHERE id = ?').get(interviewId) as
      | { job_id: number | null }
      | undefined;
    const exists = db.prepare('SELECT COUNT(*) AS n FROM review WHERE interview_id = ?').get(interviewId) as { n: number };
    if (exists.n > 0) throw new HttpError(409, '这场面试已经生成过复盘了');
    const insert = db.prepare(
      'INSERT INTO review (interview_id, job_id, question, my_answer, performance, improvement, rating, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let created = 0;
    for (const t of turns) {
      let fb: { issues?: string[]; summary?: string } = {};
      try {
        fb = t.feedback_json ? JSON.parse(t.feedback_json) : {};
      } catch {
        fb = {};
      }
      const score = t.score ?? 0;
      insert.run(
        interviewId,
        iv?.job_id ?? null,
        t.question,
        t.answer,
        `得分 ${score}。${fb.summary || ''}`,
        (fb.issues || []).slice(0, 2).join('；') || '补充可量化的结果。',
        score >= 85 ? 5 : score >= 70 ? 4 : score >= 55 ? 3 : 2,
        t.depth > 0 ? '模拟面试·追问' : '模拟面试',
        nowIso(),
      );
      created += 1;
    }
    res.status(201).json({ created });
  }),
);
