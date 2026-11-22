import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { HttpError, idOf, str } from '../util.js';

/**
 * DATA-05 / MOD-01：STAR 经历素材卡。
 *
 * 一张卡拆成 S/T/A/R + 指标，既能在模板填写时插入简历板块，
 * 也能在优化工作台追加到草稿，还会被面试出题带入 1-2 张作为追问素材。
 * 数据只存本地 SQLite，随备份 v2 导出/导入。
 */
export const experiencesRouter = Router();

function cardRow(id: number) {
  return db.prepare('SELECT * FROM experience_card WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

function parseJobId(value: unknown): number | null {
  if (!value) return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.prepare('SELECT id FROM job WHERE id = ?').get(id) ? id : null;
}

function cardBody(body: Record<string, unknown>) {
  return {
    title: str(body.title, 200).trim(),
    role: str(body.role, 200),
    situation: str(body.situation, 20_000),
    task: str(body.task, 20_000),
    action: str(body.action, 20_000),
    result: str(body.result, 20_000),
    metrics: str(body.metrics, 5000),
    tags: str(body.tags, 500),
    jobId: parseJobId(body.jobId),
  };
}

experiencesRouter.get('/experiences', (req, res) => {
  const q = str(req.query.q, 100).trim();
  const jobId = req.query.jobId ? Number(req.query.jobId) : null;
  const limitRaw = req.query.limit ? Number(req.query.limit) : 200;
  const limit = Number.isInteger(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 200;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (jobId) {
    conds.push('e.job_id = ?');
    params.push(jobId);
  }
  if (q) {
    conds.push('(e.title LIKE ? OR e.action LIKE ? OR e.result LIKE ? OR e.tags LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT e.*, j.title AS job_title
       FROM experience_card e LEFT JOIN job j ON j.id = e.job_id
       ${where} ORDER BY e.updated_at DESC, e.id DESC LIMIT ?`,
    )
    .all(...params, limit);
  res.json({ experiences: rows });
});

experiencesRouter.post('/experiences', (req, res) => {
  const data = cardBody(req.body ?? {});
  if (!data.title) throw new HttpError(400, '请填写素材标题');
  const now = nowIso();
  const info = db
    .prepare(
      'INSERT INTO experience_card (title, role, situation, task, action, result, metrics, tags, job_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      data.title,
      data.role,
      data.situation,
      data.task,
      data.action,
      data.result,
      data.metrics,
      data.tags,
      data.jobId,
      now,
      now,
    );
  res.status(201).json({ experience: cardRow(Number(info.lastInsertRowid)) });
});

experiencesRouter.put('/experiences/:id', (req, res) => {
  const id = idOf(req);
  const existing = cardRow(id);
  if (!existing) throw new HttpError(404, '素材卡不存在');
  const body = req.body ?? {};
  const data = cardBody({
    title: body.title !== undefined ? body.title : existing.title,
    role: body.role !== undefined ? body.role : existing.role,
    situation: body.situation !== undefined ? body.situation : existing.situation,
    task: body.task !== undefined ? body.task : existing.task,
    action: body.action !== undefined ? body.action : existing.action,
    result: body.result !== undefined ? body.result : existing.result,
    metrics: body.metrics !== undefined ? body.metrics : existing.metrics,
    tags: body.tags !== undefined ? body.tags : existing.tags,
    jobId: body.jobId !== undefined ? body.jobId : existing.job_id,
  });
  if (!data.title) throw new HttpError(400, '请填写素材标题');
  db.prepare(
    'UPDATE experience_card SET title = ?, role = ?, situation = ?, task = ?, action = ?, result = ?, metrics = ?, tags = ?, job_id = ?, updated_at = ? WHERE id = ?',
  ).run(
    data.title,
    data.role,
    data.situation,
    data.task,
    data.action,
    data.result,
    data.metrics,
    data.tags,
    data.jobId,
    nowIso(),
    id,
  );
  res.json({ experience: cardRow(id) });
});

experiencesRouter.delete('/experiences/:id', (req, res) => {
  const id = idOf(req);
  db.prepare('DELETE FROM experience_card WHERE id = ?').run(id);
  res.json({ ok: true });
});

/** 面试出题时带入的素材摘要：优先关联当前岗位，其次最近更新。 */
export function experienceSnippet(jobId: number | null, limit = 2): string {
  const rows = db
    .prepare(
      `SELECT title, role, situation, task, action, result, metrics FROM experience_card
       WHERE job_id IS NULL OR job_id = ?
       ORDER BY (job_id = ?) DESC, updated_at DESC, id DESC LIMIT ?`,
    )
    .all(jobId, jobId, limit) as {
    title: string;
    role: string;
    situation: string;
    task: string;
    action: string;
    result: string;
    metrics: string;
  }[];
  if (!rows.length) return '';
  return rows
    .map((r) => {
      const parts = [
        `素材：${r.title}${r.role ? `（${r.role}）` : ''}`,
        r.situation ? `情境：${r.situation}` : '',
        r.task ? `任务：${r.task}` : '',
        r.action ? `行动：${r.action}` : '',
        r.result ? `结果：${r.result}` : '',
        r.metrics ? `指标：${r.metrics}` : '',
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n\n');
}
