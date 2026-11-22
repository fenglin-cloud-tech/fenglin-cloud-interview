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
  next_action_at: string | null;
  next_action_note: string;
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
  const nextActionAt = b.nextActionAt ? dateOf(b.nextActionAt) : null;
  const nextActionNote = str(b.nextActionNote, 500);
  let jobId: number | null = null;
  if (b.jobId !== null && b.jobId !== undefined && b.jobId !== '') {
    jobId = Number(b.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) throw new HttpError(400, '目标岗位不合法');
    if (!db.prepare('SELECT id FROM job WHERE id = ?').get(jobId)) throw new HttpError(404, '目标岗位不存在');
  }
  return { company, title, appliedOn, stage, note, nextActionAt, nextActionNote, jobId };
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
  const stageLog = (
    db
      .prepare(
        `SELECT id, application_id, from_stage, to_stage, note, changed_at
         FROM application_stage_log WHERE application_id = ? ORDER BY changed_at ASC, id ASC`,
      )
      .all(app.id) as {
      id: number;
      application_id: number;
      from_stage: Stage | null;
      to_stage: Stage;
      note: string;
      changed_at: string;
    }[]
  ).map((l) => ({
    id: l.id,
    applicationId: l.application_id,
    fromStage: l.from_stage,
    toStage: l.to_stage,
    note: l.note,
    changedAt: l.changed_at,
  }));
  return {
    id: app.id,
    company: app.company,
    title: app.title,
    jobId: app.job_id,
    jobTitle: app.job_title || null,
    appliedOn: app.applied_on,
    stage: app.stage,
    note: app.note,
    nextActionAt: app.next_action_at || null,
    nextActionNote: app.next_action_note || '',
    createdAt: app.created_at,
    updatedAt: app.updated_at,
    stageLog,
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

applicationsRouter.get('/applications/calendar', (req, res) => {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const now = new Date();
  const defFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const defTo = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  const from = String(req.query.from || defFrom);
  const to = String(req.query.to || defTo);
  if (!dateRe.test(from) || !dateRe.test(to) || from > to) {
    throw new HttpError(400, '日期范围不正确，格式应为 YYYY-MM-DD');
  }

  type Event = {
    date: string;
    type: 'applied' | 'followup' | 'deadline' | 'stage';
    applicationId?: number;
    jobId?: number;
    company?: string;
    title?: string;
    stage?: Stage;
    fromStage?: Stage | null;
    toStage?: Stage;
    note?: string;
  };
  const events: Event[] = [];

  const applied = db
    .prepare('SELECT id, company, title, stage, applied_on FROM application WHERE applied_on BETWEEN ? AND ?')
    .all(from, to) as { id: number; company: string; title: string; stage: Stage; applied_on: string }[];
  for (const a of applied) {
    events.push({
      date: a.applied_on,
      type: 'applied',
      applicationId: a.id,
      company: a.company,
      title: a.title,
      stage: a.stage,
    });
  }

  const followups = db
    .prepare(
      `SELECT id, company, title, stage, next_action_at, next_action_note FROM application
       WHERE next_action_at IS NOT NULL AND next_action_at BETWEEN ? AND ?
         AND stage NOT IN ('offer', 'rejected', 'withdrawn')`,
    )
    .all(from, to) as {
    id: number;
    company: string;
    title: string;
    stage: Stage;
    next_action_at: string;
    next_action_note: string;
  }[];
  for (const a of followups) {
    events.push({
      date: a.next_action_at,
      type: 'followup',
      applicationId: a.id,
      company: a.company,
      title: a.title,
      stage: a.stage,
      note: a.next_action_note,
    });
  }

  const deadlines = db
    .prepare(
      `SELECT j.id, j.title, j.company, j.deadline, MIN(a.id) AS application_id
       FROM job j JOIN application a ON a.job_id = j.id
       WHERE j.deadline IS NOT NULL AND j.deadline BETWEEN ? AND ?
       GROUP BY j.id, j.title, j.company, j.deadline`,
    )
    .all(from, to) as {
    id: number;
    title: string;
    company: string;
    deadline: string;
    application_id: number;
  }[];
  for (const j of deadlines) {
    events.push({
      date: j.deadline,
      type: 'deadline',
      jobId: j.id,
      applicationId: j.application_id,
      company: j.company,
      title: j.title,
    });
  }

  const logs = db
    .prepare(
      `SELECT l.application_id, l.from_stage, l.to_stage, l.note, l.changed_at,
              a.company, a.title
       FROM application_stage_log l JOIN application a ON a.id = l.application_id
       WHERE substr(l.changed_at, 1, 10) BETWEEN ? AND ?`,
    )
    .all(from, to) as {
    application_id: number;
    from_stage: Stage | null;
    to_stage: Stage;
    note: string;
    changed_at: string;
    company: string;
    title: string;
  }[];
  for (const l of logs) {
    events.push({
      date: l.changed_at.slice(0, 10),
      type: 'stage',
      applicationId: l.application_id,
      company: l.company,
      title: l.title,
      fromStage: l.from_stage,
      toStage: l.to_stage,
      note: l.note,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  res.json({ from, to, events });
});

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
        `SELECT i.id, i.started_at, i.ended_at, i.overall_score, i.mode, i.status, i.job_id
         FROM interview i ORDER BY i.started_at DESC LIMIT 100`,
      )
      .all() as {
      id: number;
      started_at: string;
      ended_at: string | null;
      overall_score: number | null;
      mode: string;
      status: string;
      job_id: number | null;
    }[];
    const reviews = db
      .prepare('SELECT id, question, rating, created_at, job_id FROM review ORDER BY created_at DESC LIMIT 100')
      .all() as { id: number; question: string; rating: number; created_at: string; job_id: number | null }[];
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
        `INSERT INTO application (company, title, job_id, applied_on, stage, note, next_action_at, next_action_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.company,
        p.title,
        p.jobId,
        p.appliedOn,
        p.stage,
        p.note,
        p.nextActionAt,
        p.nextActionNote,
        now,
        now,
      );
    db.prepare(
      'INSERT INTO application_stage_log (application_id, from_stage, to_stage, note, changed_at) VALUES (?, NULL, ?, ?, ?)',
    ).run(r.lastInsertRowid, p.stage, '创建投递', now);
    res.json({ application: detailOf(appById(r.lastInsertRowid)) });
  }),
);

applicationsRouter.put(
  '/applications/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const before = appById(id);
    const p = parseBody(req.body);
    const now = nowIso();
    db.prepare(
      `UPDATE application SET company = ?, title = ?, job_id = ?, applied_on = ?, stage = ?, note = ?,
       next_action_at = ?, next_action_note = ?, updated_at = ? WHERE id = ?`,
    ).run(
      p.company,
      p.title,
      p.jobId,
      p.appliedOn,
      p.stage,
      p.note,
      p.nextActionAt,
      p.nextActionNote,
      now,
      id,
    );
    // 只有阶段真正变化才追加历史，避免每次编辑都写一条噪音。
    if (before.stage !== p.stage) {
      db.prepare(
        'INSERT INTO application_stage_log (application_id, from_stage, to_stage, note, changed_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, before.stage, p.stage, '', now);
    }
    res.json({ application: detailOf(appById(id)) });
  }),
);

applicationsRouter.delete(
  '/applications/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    appById(id);
    db.prepare('DELETE FROM application_stage_log WHERE application_id = ?').run(id);
    db.prepare('DELETE FROM application_link WHERE application_id = ?').run(id);
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
