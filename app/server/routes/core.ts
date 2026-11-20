import { Router } from 'express';
import { db, getSetting, nowIso, setSetting } from '../db.js';
import { TEMPLATES } from '../templates.js';
import { buildDocx } from '../docx-export.js';
import { HttpError, ah, idOf, sendDocx, str } from '../util.js';
import { env, hasApiKey } from '../env.js';

export const coreRouter = Router();

coreRouter.get('/health', (_req, res) => {
  const row = db.prepare('SELECT COUNT(*) AS n FROM resume').get() as { n: number };
  res.json({
    ok: true,
    time: nowIso(),
    model: env.zhipuModel,
    aiConfigured: hasApiKey(),
    sharedDemo: env.sharedDemo,
    resumes: row.n,
  });
});

coreRouter.get('/templates', (_req, res) => {
  res.json({ templates: TEMPLATES });
});

coreRouter.get('/profile', (_req, res) => {
  const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  res.json({ profile });
});

coreRouter.put('/profile', (req, res) => {
  const body = req.body ?? {};
  db.prepare(
    'UPDATE profile SET nickname = ?, school = ?, major = ?, grade = ?, updated_at = ? WHERE id = 1',
  ).run(str(body.nickname, 40), str(body.school, 80), str(body.major, 80), str(body.grade, 40), nowIso());
  const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  res.json({ profile });
});

/* ---------------- 简历 ---------------- */

function resumeRow(id: number) {
  return db.prepare('SELECT * FROM resume WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

coreRouter.get('/resumes', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, j.title AS job_title,
        (SELECT COUNT(*) FROM jd_analysis a WHERE a.resume_id = r.id) AS analysis_count,
        (SELECT COUNT(*) FROM interview i WHERE i.resume_id = r.id) AS interview_count
       FROM resume r LEFT JOIN job j ON j.id = r.job_id
       ORDER BY r.updated_at DESC`,
    )
    .all();
  res.json({ resumes: rows });
});

coreRouter.get(
  '/resumes/:id/docx',
  ah(async (req, res) => {
    const id = idOf(req);
    const row = db.prepare('SELECT title, content FROM resume WHERE id = ?').get(id) as
      | { title: string; content: string }
      | undefined;
    if (!row) throw new HttpError(404, '简历不存在');
    if (!row.content.trim()) throw new HttpError(400, '简历内容为空，无法导出');
    const buffer = await buildDocx(row.title || '简历', row.content);
    sendDocx(res, `${row.title || '简历'}.docx`, buffer);
  }),
);

coreRouter.post('/resumes', (req, res) => {
  const body = req.body ?? {};
  const title = str(body.title, 80).trim();
  const content = str(body.content, 40000);
  if (!title) throw new HttpError(400, '请填写简历标题');
  if (content.trim().length < 20) throw new HttpError(400, '简历内容太短（至少 20 字）');
  const jobId = body.jobId ? Number(body.jobId) : null;
  const now = nowIso();
  const info = db
    .prepare(
      'INSERT INTO resume (title, content, job_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(title, content, jobId, str(body.source, 20) || 'manual', now, now);
  if (body.makeActive !== false) setSetting('active_resume_id', String(info.lastInsertRowid));
  res.status(201).json({ resume: resumeRow(Number(info.lastInsertRowid)) });
});

coreRouter.put('/resumes/:id', (req, res) => {
  const id = idOf(req);
  const existing = resumeRow(id);
  if (!existing) throw new HttpError(404, '简历不存在');
  const body = req.body ?? {};
  const title = body.title !== undefined ? str(body.title, 80).trim() : String(existing.title);
  const content = body.content !== undefined ? str(body.content, 40000) : String(existing.content);
  if (!title) throw new HttpError(400, '请填写简历标题');
  const jobId = body.jobId === undefined ? (existing.job_id as number | null) : body.jobId ? Number(body.jobId) : null;
  db.prepare('UPDATE resume SET title = ?, content = ?, job_id = ?, updated_at = ? WHERE id = ?').run(
    title,
    content,
    jobId,
    nowIso(),
    id,
  );
  res.json({ resume: resumeRow(id) });
});

coreRouter.delete('/resumes/:id', (req, res) => {
  const id = idOf(req);
  db.prepare('DELETE FROM resume WHERE id = ?').run(id);
  if (getSetting('active_resume_id') === String(id)) setSetting('active_resume_id', '');
  res.json({ ok: true });
});

/* ---------------- 目标岗位 ---------------- */

function jobRow(id: number) {
  return db.prepare('SELECT * FROM job WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

coreRouter.get('/jobs', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT j.*,
        (SELECT COUNT(*) FROM resume r WHERE r.job_id = j.id) AS resume_count,
        (SELECT COUNT(*) FROM interview i WHERE i.job_id = j.id) AS interview_count
       FROM job j ORDER BY j.updated_at DESC`,
    )
    .all();
  res.json({ jobs: rows });
});

coreRouter.post('/jobs', (req, res) => {
  const body = req.body ?? {};
  const title = str(body.title, 80).trim();
  if (!title) throw new HttpError(400, '请填写岗位名称');
  const now = nowIso();
  const info = db
    .prepare('INSERT INTO job (title, company, jd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(title, str(body.company, 80), str(body.jd, 20000), now, now);
  if (body.makeActive !== false) setSetting('active_job_id', String(info.lastInsertRowid));
  res.status(201).json({ job: jobRow(Number(info.lastInsertRowid)) });
});

coreRouter.put('/jobs/:id', (req, res) => {
  const id = idOf(req);
  const existing = jobRow(id);
  if (!existing) throw new HttpError(404, '岗位不存在');
  const body = req.body ?? {};
  db.prepare('UPDATE job SET title = ?, company = ?, jd = ?, updated_at = ? WHERE id = ?').run(
    body.title !== undefined ? str(body.title, 80).trim() : String(existing.title),
    body.company !== undefined ? str(body.company, 80) : String(existing.company),
    body.jd !== undefined ? str(body.jd, 20000) : String(existing.jd),
    nowIso(),
    id,
  );
  res.json({ job: jobRow(id) });
});

coreRouter.delete('/jobs/:id', (req, res) => {
  const id = idOf(req);
  db.prepare('UPDATE resume SET job_id = NULL WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM job WHERE id = ?').run(id);
  if (getSetting('active_job_id') === String(id)) setSetting('active_job_id', '');
  res.json({ ok: true });
});

/* ---------------- 当前上下文 ---------------- */

coreRouter.get('/state', (_req, res) => {
  res.json({
    activeResumeId: Number(getSetting('active_resume_id') || 0) || null,
    activeJobId: Number(getSetting('active_job_id') || 0) || null,
  });
});

coreRouter.put('/state', (req, res) => {
  const body = req.body ?? {};
  if (body.activeResumeId !== undefined) setSetting('active_resume_id', String(body.activeResumeId ?? ''));
  if (body.activeJobId !== undefined) setSetting('active_job_id', String(body.activeJobId ?? ''));
  res.json({
    activeResumeId: Number(getSetting('active_resume_id') || 0) || null,
    activeJobId: Number(getSetting('active_job_id') || 0) || null,
  });
});

/* ---------------- 首页数据 ---------------- */

coreRouter.get(
  '/dashboard',
  ah(async (_req, res) => {
    const counts = {
      resumes: (db.prepare('SELECT COUNT(*) AS n FROM resume').get() as { n: number }).n,
      jobs: (db.prepare('SELECT COUNT(*) AS n FROM job').get() as { n: number }).n,
      interviews: (db.prepare('SELECT COUNT(*) AS n FROM interview').get() as { n: number }).n,
      finished: (db.prepare("SELECT COUNT(*) AS n FROM interview WHERE status = 'finished'").get() as { n: number }).n,
      bank: (db.prepare('SELECT COUNT(*) AS n FROM bank_item').get() as { n: number }).n,
      weak: (db.prepare('SELECT COUNT(*) AS n FROM bank_item WHERE weak = 1').get() as { n: number }).n,
      reviews: (db.prepare('SELECT COUNT(*) AS n FROM review').get() as { n: number }).n,
      analyses: (db.prepare('SELECT COUNT(*) AS n FROM jd_analysis').get() as { n: number }).n,
    };
    const recent = db
      .prepare(
        `SELECT i.id, i.status, i.round_key, i.started_at, i.overall_score, j.title AS job_title,
                (SELECT COUNT(*) FROM interview_turn t WHERE t.interview_id = i.id AND t.answer IS NOT NULL) AS answered
         FROM interview i LEFT JOIN job j ON j.id = i.job_id
         ORDER BY i.id DESC LIMIT 5`,
      )
      .all();
    res.json({
      counts,
      recent,
      activeResumeId: Number(getSetting('active_resume_id') || 0) || null,
      activeJobId: Number(getSetting('active_job_id') || 0) || null,
      aiConfigured: hasApiKey(),
    });
  }),
);
