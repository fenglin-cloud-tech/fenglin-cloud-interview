import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { HttpError, idOf, str } from '../util.js';

/**
 * DATA-08：训练任务数据层。
 *
 * P2 只落库与提供最小 CRUD，供 FUNC-12 清理与后续 P3「7 天计划」使用；
 * 这里不生成计划、不做服务端定时任务，全部由客户端按打开页面时读取。
 */
export const trainingRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown, label: string, required = false): string {
  const text = str(value, 10).trim();
  if (!text) {
    if (required) throw new HttpError(400, `${label}不能为空`);
    return '';
  }
  if (!DATE_RE.test(text)) throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  return text;
}

trainingRouter.get('/training-tasks', (req, res) => {
  const date = parseDate(req.query.date, '日期');
  const from = parseDate(req.query.from, '开始日期');
  const to = parseDate(req.query.to, '结束日期');
  const status = str(req.query.status, 20).trim();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (date) {
    conds.push('plan_date = ?');
    params.push(date);
  }
  if (from) {
    conds.push('plan_date >= ?');
    params.push(from);
  }
  if (to) {
    conds.push('plan_date <= ?');
    params.push(to);
  }
  if (status) {
    conds.push('status = ?');
    params.push(status);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM training_task ${where} ORDER BY plan_date ASC, id ASC LIMIT 500`)
    .all(...params);
  res.json({ tasks: rows });
});

trainingRouter.post('/training-tasks', (req, res) => {
  const body = req.body ?? {};
  const planDate = parseDate(body.planDate, '计划日期', true);
  const kind = str(body.kind, 40).trim() || 'custom';
  const title = str(body.title, 300).trim();
  if (!title) throw new HttpError(400, '请填写任务标题');
  const refId = body.refId ? Number(body.refId) : null;
  const info = db
    .prepare(
      'INSERT INTO training_task (plan_date, kind, ref_id, title, status, done_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    )
    .run(planDate, kind, Number.isInteger(refId) && refId! > 0 ? refId : null, title, 'todo', nowIso());
  res.status(201).json({ task: db.prepare('SELECT * FROM training_task WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

trainingRouter.patch('/training-tasks/:id', (req, res) => {
  const id = idOf(req);
  const existing = db.prepare('SELECT * FROM training_task WHERE id = ?').get(id) as
    | { title: string; status: string; done_at: string | null }
    | undefined;
  if (!existing) throw new HttpError(404, '训练任务不存在');
  const body = req.body ?? {};
  const status = body.status !== undefined ? str(body.status, 20).trim() : existing.status;
  if (!['todo', 'doing', 'done', 'skipped'].includes(status)) {
    throw new HttpError(400, '任务状态不合法');
  }
  const title = body.title !== undefined ? str(body.title, 300).trim() || existing.title : existing.title;
  const doneAt = status === 'done' ? existing.done_at || nowIso() : null;
  db.prepare('UPDATE training_task SET title = ?, status = ?, done_at = ? WHERE id = ?').run(title, status, doneAt, id);
  res.json({ task: db.prepare('SELECT * FROM training_task WHERE id = ?').get(id) });
});

trainingRouter.delete('/training-tasks/:id', (req, res) => {
  const id = idOf(req);
  db.prepare('DELETE FROM training_task WHERE id = ?').run(id);
  res.json({ ok: true });
});
