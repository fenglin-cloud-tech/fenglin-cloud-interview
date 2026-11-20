import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { HttpError, ah, str } from '../util.js';

/**
 * 投递追踪：只记录“实际投出去的申请”，与目标岗位（JD 沉淀）区分开。
 * 关联面试/复盘使用独立 application_link 表，不给既有表加列，避免迁移。
 */
export const applicationsRouter = Router();

const STAGES = ['applied', 'written', 'interview1', 'interview2', 'hr', 'offer', 'rejected', 'withdrawn'] as const;
type Stage = (typeof STAGES)[number];

interface ApplicationRow {
  id: number;
  company: string;
  title: string;
  job_id: number | null;
  applied_on: string;
  stage: Stage;
  note: string;
  created_at: string;
  updated_at: string;
  job_title?: string | null;
}

function stageOf(v: unknown): Stage {
  if (typeof v !== 'string' || !STAGES.includes(v as Stage)) {
    throw new HttpError(400, '投递阶段不合法');
  }
  return v as Stage;
}

function dateOf(v: unknown): string {
  const s = str(v, 10).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, '投递日期格式应为 YYYY-MM-DD');
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new HttpError(400, '投递日期不是有效日期');
  }
  return s;
}

function parseBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const company = str(b.company, 120).trim();
  const title = str(b.title, 160).trim();
  if (!company) throw new HttpError(400, '请填写公司名称');
  if (!title) throw new HttpError(400, '请填写岗位名称');
  const appliedOn = dateOf(b.appliedOn);
  const stage = stageOf(b.stage);
  const note = str(b.note, 5000);
  let jobId: number | null = null;
  if (b.jobId !== null && b.jobId !== undefined && b.jobId !== '') {
    jobId = Number(b.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) throw new HttpError(400, '目标岗位不合法');
    if (!db.prepare('SELECT id FROM job WHERE id = ?').get(jobId)) throw new HttpError(404, '目标岗位不存在');
  }
  return { company, title, appliedOn, stage, note, jobId };
}

function appById(id: number): ApplicationRow & { job_title: string | null } {
  const row = db
    .prepare(
      `SELECT a.*, j.title AS job_title FROM application a
       LEFT JOIN job j ON j.id = a.job_id WHERE a.id = ?`,
    )
    .get(id) as (ApplicationRow & { job_title: string | null }) | undefined;
  if (!row) throw new HttpError(404, '投递记录不存在');
  return row;
}

function linkRows(appId: number) {
  return db
    .prepare('SELECT kind, ref_id FROM application_link WHERE application_id = ? ORDER BY created_at DESC')
    .all(appId) as { kind: 'interview' | 'review'; ref_id: number }[];
}

function detailOf(app: ApplicationRow & { job_title?: string | null }) {
  const links = linkRows(app.id);
  const interviewIds = links.filter((l) => l.kind === 'interview').map((l) => l.ref_id);
  const reviewIds = links.filter((l) => l.kind === 'review').map((l) => l.ref_id);
  const interviews = interviewIds.length
    ? (db
        .prepare(
          `SELECT id, started_at, ended_at, overall_score, mode, status FROM interview
           WHERE id IN (${interviewIds.map(() => '?').join(',')}) ORDER BY started_at DESC`,
        )
        .all(...interviewIds) as {
        id: number;
        started_at: string;
        ended_at: string | null;
        overall_score: number | null;
        mode: string;
        status: string;
      }[])
    : [];
  const reviews = reviewIds.length
    ? (db
        .prepare(
          `SELECT id, question, rating, created_at FROM review
           WHERE id IN (${reviewIds.map(() => '?').join(',')}) ORDER BY created_at DESC`,
        )
        .all(...reviewIds) as { id: number; question: string; rating: number; created_at: string }[])
    : [];
  return {
    id: app.id,
    company: app.company,
    title: app.title,
    jobId: app.job_id,
    jobTitle: app.job_title || null,
    appliedOn: app.applied_on,
    stage: app.stage,
    note: app.note,
    createdAt: app.created_at,
    updatedAt: app.updated_at,
    links: { interviews, reviews },
  };
}

applicationsRouter.get(
  '/applications',
  ah(async (_req, res) => {
    const rows = db
      .prepare(
        `SELECT a.*, j.title AS job_title FROM application a
         LEFT JOIN job j ON j.id = a.job_id
         ORDER BY a.applied_on DESC, a.id DESC`,
      )
      .all() as (ApplicationRow & { job_title: string | null })[];
    res.json({ applications: rows.map(detailOf) });
  }),
);

applicationsRouter.get(
  '/applications/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const app = appById(id);
    const linked = new Map<string, number>();
    for (const l of db.prepare('SELECT kind, ref_id, application_id FROM application_link').all() as {
      kind: string;
      ref_id: number;
      application_id: number;
    }[]) {
      linked.set(`${l.kind}:${l.ref_id}`, l.application_id);
    }
    const interviews = db
      .prepare(
        `SELECT i.id, i.started_at, i.ended_at, i.overall_score, i.mode, i.status
         FROM interview i ORDER BY i.started_at DESC LIMIT 100`,
      )
      .all() as { id: number; started_at: string; ended_at: string | null; overall_score: number | null }[];
    const reviews = db
      .prepare('SELECT id, question, rating, created_at FROM review ORDER BY created_at DESC LIMIT 100')
      .all() as { id: number; question: string; rating: number; created_at: string }[];
    res.json({
      application: detailOf(app),
      options: {
        interviews: interviews.map((i) => ({ ...i, linkedApplicationId: linked.get(`interview:${i.id}`) ?? null })),
        reviews: reviews.map((r) => ({ ...r, linkedApplicationId: linked.get(`review:${r.id}`) ?? null })),
      },
    });
  }),
);

applicationsRouter.post(
  '/applications',
  ah(async (req, res) => {
    const p = parseBody(req.body);
    const now = nowIso();
    const r = db
      .prepare(
        `INSERT INTO application (company, title, job_id, applied_on, stage, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.company, p.title, p.jobId, p.appliedOn, p.stage, p.note, now, now);
    res.json({ application: detailOf(appById(r.lastInsertRowid)) });
  }),
);

applicationsRouter.put(
  '/applications/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    appById(id);
    const p = parseBody(req.body);
    db.prepare(
      `UPDATE application SET company = ?, title = ?, job_id = ?, applied_on = ?, stage = ?, note = ?, updated_at = ?
       WHERE id = ?`,
    ).run(p.company, p.title, p.jobId, p.appliedOn, p.stage, p.note, nowIso(), id);
    res.json({ application: detailOf(appById(id)) });
  }),
);

applicationsRouter.delete(
  '/applications/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    appById(id);
    db.prepare('DELETE FROM application WHERE id = ?').run(id);
    res.json({ ok: true });
  }),
);

applicationsRouter.post(
  '/applications/:id/links',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    appById(id);
    const kind = req.body?.kind;
    const refId = Number(req.body?.refId);
    if ((kind !== 'interview' && kind !== 'review') || !Number.isInteger(refId) || refId < 1) {
      throw new HttpError(400, '关联对象不合法');
    }
    const table = kind === 'interview' ? 'interview' : 'review';
    if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(refId)) {
      throw new HttpError(404, '要关联的记录不存在');
    }
    const existing = db
      .prepare('SELECT application_id FROM application_link WHERE kind = ? AND ref_id = ?')
      .get(kind, refId) as { application_id: number } | undefined;
    if (existing && existing.application_id !== id) {
      throw new HttpError(409, '这条记录已经关联到其他投递，请先解除原关联');
    }
    db.prepare(
      'INSERT OR IGNORE INTO application_link (application_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, kind, refId, nowIso());
    res.json({ application: detailOf(appById(id)) });
  }),
);

applicationsRouter.delete(
  '/applications/:id/links/:kind/:refId',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    appById(id);
    const kind = req.params.kind;
    const refId = Number(req.params.refId);
    if (kind !== 'interview' && kind !== 'review') throw new HttpError(400, '关联类型不合法');
    db.prepare('DELETE FROM application_link WHERE application_id = ? AND kind = ? AND ref_id = ?').run(id, kind, refId);
    res.json({ application: detailOf(appById(id)) });
  }),
);
