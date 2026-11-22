import { Router } from 'express';
import { db, getSetting, nowIso, parseJson, setSetting } from '../db.js';
import { TEMPLATES } from '../templates.js';
import { buildDocx } from '../docx-export.js';
import { ensureReviewTasks } from '../review-schedule.js';
import { HttpError, ah, idOf, sendDocx, str } from '../util.js';
import { env, hasApiKey } from '../env.js';
import { fetchJdFromUrl } from '../jd-fetch.js';
import { diffLines } from '../diff.js';

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

coreRouter.get('/resumes/:id/diff/:otherId', (req, res) => {
  const a = resumeRow(idOf(req));
  const otherId = Number(req.params.otherId);
  if (!Number.isInteger(otherId) || otherId <= 0) throw new HttpError(400, '对比版本不正确');
  const b = resumeRow(otherId);
  if (!a || !b) throw new HttpError(404, '简历版本不存在');
  if (a.id === b.id) throw new HttpError(400, '请选择两个不同的简历版本');
  const lines = diffLines(String(a.content ?? ''), String(b.content ?? ''));
  res.json({
    a: { id: a.id, title: a.title, updated_at: a.updated_at },
    b: { id: b.id, title: b.title, updated_at: b.updated_at },
    lines,
    added: lines.filter((l) => l.type === 'add').length,
    removed: lines.filter((l) => l.type === 'del').length,
  });
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
  const parentId = body.parentId ? Number(body.parentId) : null;
  if (parentId && !db.prepare('SELECT id FROM resume WHERE id = ?').get(parentId)) {
    throw new HttpError(404, '父版本简历不存在');
  }
  const now = nowIso();
  const info = db
    .prepare(
      'INSERT INTO resume (title, content, job_id, parent_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(title, content, jobId, parentId, str(body.source, 20) || 'manual', now, now);
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

const JOB_STATUS = ['open', 'paused', 'closed'];

function jobPriority(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(2, Math.max(0, Math.round(n)));
}

function jobStatus(value: unknown, fallback: string): string {
  const status = str(value, 20).trim() || fallback;
  if (!JOB_STATUS.includes(status)) throw new HttpError(400, '岗位状态不合法');
  return status;
}

coreRouter.post('/jobs', (req, res) => {
  const body = req.body ?? {};
  const title = str(body.title, 80).trim();
  if (!title) throw new HttpError(400, '请填写岗位名称');
  const now = nowIso();
  const info = db
    .prepare(
      'INSERT INTO job (title, company, jd, location, salary_range, deadline, priority, source_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      title,
      str(body.company, 80),
      str(body.jd, 20000),
      str(body.location, 200),
      str(body.salaryRange, 100),
      str(body.deadline, 40).trim() || null,
      jobPriority(body.priority, 0),
      str(body.sourceUrl, 2000),
      jobStatus(body.status, 'open'),
      now,
      now,
    );
  if (body.makeActive !== false) setSetting('active_job_id', String(info.lastInsertRowid));
  res.status(201).json({ job: jobRow(Number(info.lastInsertRowid)) });
});

coreRouter.put('/jobs/:id', (req, res) => {
  const id = idOf(req);
  const existing = jobRow(id);
  if (!existing) throw new HttpError(404, '岗位不存在');
  const body = req.body ?? {};
  db.prepare(
    'UPDATE job SET title = ?, company = ?, jd = ?, location = ?, salary_range = ?, deadline = ?, priority = ?, source_url = ?, status = ?, updated_at = ? WHERE id = ?',
  ).run(
    body.title !== undefined ? str(body.title, 80).trim() : String(existing.title),
    body.company !== undefined ? str(body.company, 80) : String(existing.company),
    body.jd !== undefined ? str(body.jd, 20000) : String(existing.jd),
    body.location !== undefined ? str(body.location, 200) : String(existing.location),
    body.salaryRange !== undefined ? str(body.salaryRange, 100) : String(existing.salary_range),
    body.deadline !== undefined ? str(body.deadline, 40).trim() || null : (existing.deadline as string | null),
    body.priority !== undefined ? jobPriority(body.priority, Number(existing.priority)) : Number(existing.priority),
    body.sourceUrl !== undefined ? str(body.sourceUrl, 2000) : String(existing.source_url),
    body.status !== undefined ? jobStatus(body.status, String(existing.status)) : String(existing.status),
    nowIso(),
    id,
  );
  res.json({ job: jobRow(id) });
});

coreRouter.post(
  '/jobs/fetch-jd',
  ah(async (req, res) => {
    const url = str(req.body?.url, 2000).trim();
    if (!url) {
      res.json({ ok: false, code: 'URL_INVALID', message: '请先粘贴招聘页面链接' });
      return;
    }
    try {
      const result = await fetchJdFromUrl(url);
      res.json({ ok: true, ...result });
    } catch (e) {
      // 抓取失败属于可预期的业务结果，用 200 + ok:false 返回，避免浏览器控制台出现网络错误噪音。
      if (e instanceof HttpError) {
        res.json({ ok: false, code: e.code, message: e.message });
        return;
      }
      throw e;
    }
  }),
);

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

/* ---------------- 启动聚合：首屏 5 个请求合并为 1 个 ---------------- */

coreRouter.get('/bootstrap', (_req, res) => {
  const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  const resumes = db
    .prepare(
      `SELECT r.*, j.title AS job_title,
        (SELECT COUNT(*) FROM jd_analysis a WHERE a.resume_id = r.id) AS analysis_count,
        (SELECT COUNT(*) FROM interview i WHERE i.resume_id = r.id) AS interview_count
       FROM resume r LEFT JOIN job j ON j.id = r.job_id
       ORDER BY r.updated_at DESC`,
    )
    .all();
  const jobs = db
    .prepare(
      `SELECT j.*,
        (SELECT COUNT(*) FROM resume r WHERE r.job_id = j.id) AS resume_count,
        (SELECT COUNT(*) FROM interview i WHERE i.job_id = j.id) AS interview_count
       FROM job j ORDER BY j.updated_at DESC`,
    )
    .all();
  res.json({
    profile,
    resumes,
    jobs,
    activeResumeId: Number(getSetting('active_resume_id') || 0) || null,
    activeJobId: Number(getSetting('active_job_id') || 0) || null,
    aiConfigured: hasApiKey(),
    sharedDemo: env.sharedDemo,
    model: env.zhipuModel,
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
    // 今日跟进：只取尚未结束的投递，按跟进日期升序；日期是本地 YYYY-MM-DD。
    const todayStr = new Date().toLocaleDateString('sv-SE');
    const followUps = db
      .prepare(
        `SELECT id, company, title, stage, next_action_at, next_action_note
         FROM application
         WHERE next_action_at IS NOT NULL AND next_action_at <= ?
           AND stage NOT IN ('offer', 'rejected', 'withdrawn')
         ORDER BY next_action_at ASC, id ASC LIMIT 20`,
      )
      .all(todayStr);
    res.json({
      counts,
      recent,
      followUps,
      activeResumeId: Number(getSetting('active_resume_id') || 0) || null,
      activeJobId: Number(getSetting('active_job_id') || 0) || null,
      aiConfigured: hasApiKey(),
    });
  }),
);

/* ---------------- 能力成长：只聚合既有评分，不新增表 ---------------- */

interface GrowthDims {
  structure: number;
  content: number;
  expression: number;
}

interface GrowthPoint {
  id: number;
  jobId: number | null;
  jobTitle: string;
  startedAt: string;
  score: number;
  dims: GrowthDims | null;
}

function meanDims(list: GrowthDims[]): GrowthDims | null {
  if (!list.length) return null;
  const sum = list.reduce(
    (acc, d) => ({
      structure: acc.structure + d.structure,
      content: acc.content + d.content,
      expression: acc.expression + d.expression,
    }),
    { structure: 0, content: 0, expression: 0 },
  );
  return {
    structure: Math.round(sum.structure / list.length),
    content: Math.round(sum.content / list.length),
    expression: Math.round(sum.expression / list.length),
  };
}

/**
 * 三维对比口径：把该分组内带三维评分的面试按时间排序，前一半为「早期」、后一半为「近期」。
 * 只有 1 场时不制造对比，只返回近期一侧。
 */
function radarOf(points: GrowthPoint[]) {
  const withDims = points.filter((p) => p.dims) as (GrowthPoint & { dims: GrowthDims })[];
  if (!withDims.length) return { early: null, recent: null };
  if (withDims.length === 1) {
    return {
      early: null,
      recent: { label: '最近 1 场', n: 1, dims: withDims[0].dims },
    };
  }
  const half = Math.floor(withDims.length / 2);
  const early = withDims.slice(0, half);
  const recent = withDims.slice(half);
  return {
    early: { label: `前 ${early.length} 场`, n: early.length, dims: meanDims(early.map((p) => p.dims)) },
    recent: { label: `最近 ${recent.length} 场`, n: recent.length, dims: meanDims(recent.map((p) => p.dims)) },
  };
}

/**
 * 成长聚合进程内缓存。
 * key 取「已完成面试 / 逐题反馈 / 岗位标题」的最大版本标记：
 * 面试结束、反馈写入、岗位改名都会让 key 变化，从而自动失效。
 */
type GrowthData = ReturnType<typeof buildGrowth>;
let growthCache: { key: string; data: GrowthData } | null = null;

function growthCacheKey(): string {
  const iv = db
    .prepare(
      "SELECT COUNT(*) AS n, MAX(id) AS maxId, MAX(ended_at) AS maxEnded, MAX(overall_score) AS maxScore FROM interview WHERE status = 'finished'",
    )
    .get() as { n: number; maxId: number | null; maxEnded: string | null; maxScore: number | null };
  const turns = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(t.id) AS maxTurn FROM interview_turn t
       JOIN interview i ON i.id = t.interview_id
       WHERE i.status = 'finished' AND t.answer IS NOT NULL AND t.feedback_json IS NOT NULL`,
    )
    .get() as { n: number; maxTurn: number | null };
  const jobs = db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS maxUpdated FROM job').get() as {
    n: number;
    maxUpdated: string | null;
  };
  return `${iv.n}|${iv.maxId ?? ''}|${iv.maxEnded ?? ''}|${iv.maxScore ?? ''}|${turns.n}|${turns.maxTurn ?? ''}|${jobs.n}|${jobs.maxUpdated ?? ''}`;
}

function buildGrowthCached(): GrowthData {
  const key = growthCacheKey();
  if (growthCache && growthCache.key === key) return growthCache.data;
  const data = buildGrowth();
  growthCache = { key, data };
  return data;
}

coreRouter.get('/stats/growth', (_req, res) => {
  res.json(buildGrowthCached());
});

function buildGrowth() {
  const rows = db
    .prepare(
      `SELECT i.id, i.job_id, i.started_at, i.overall_score, j.title AS job_title
       FROM interview i LEFT JOIN job j ON j.id = i.job_id
       WHERE i.status = 'finished' AND i.overall_score IS NOT NULL
       ORDER BY i.started_at ASC, i.id ASC`,
    )
    .all() as {
    id: number;
    job_id: number | null;
    started_at: string;
    overall_score: number;
    job_title: string | null;
  }[];

  const turnRows = db
    .prepare(
      `SELECT t.interview_id, t.feedback_json FROM interview_turn t
       JOIN interview i ON i.id = t.interview_id
       WHERE i.status = 'finished' AND t.answer IS NOT NULL AND t.feedback_json IS NOT NULL`,
    )
    .all() as { interview_id: number; feedback_json: string }[];

  const dimsByInterview = new Map<number, GrowthDims[]>();
  for (const t of turnRows) {
    const fb = parseJson<{ scores?: Partial<GrowthDims> } | null>(t.feedback_json, null);
    const s = fb?.scores;
    if (!s) continue;
    const { structure, content, expression } = s;
    if (typeof structure !== 'number' || typeof content !== 'number' || typeof expression !== 'number') continue;
    const arr = dimsByInterview.get(t.interview_id) || [];
    arr.push({ structure, content, expression });
    dimsByInterview.set(t.interview_id, arr);
  }

  const points: GrowthPoint[] = rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    jobTitle: r.job_title || '',
    startedAt: r.started_at,
    score: Math.round(r.overall_score),
    dims: meanDims(dimsByInterview.get(r.id) || []),
  }));

  const buckets = new Map<string, { jobId: number | null; label: string; points: GrowthPoint[] }>();
  buckets.set('all', { jobId: null, label: '全部岗位', points: [...points] });
  for (const p of points) {
    const key = p.jobId ? `job-${p.jobId}` : 'nojob';
    const bucket = buckets.get(key) || {
      jobId: p.jobId,
      label: p.jobId ? p.jobTitle || '未命名岗位' : '未关联岗位',
      points: [],
    };
    bucket.points.push(p);
    buckets.set(key, bucket);
  }

  const groups = [...buckets.entries()].map(([key, b]) => ({
    key,
    jobId: b.jobId,
    label: b.label,
    count: b.points.length,
    points: b.points,
    radar: radarOf(b.points),
  }));
  groups.sort((a, b) => (a.key === 'all' ? -1 : b.key === 'all' ? 1 : b.count - a.count));

  return { totalFinished: points.length, groups, generatedAt: nowIso() };
}

/* ---------------- 求职档案：聚合既有真实数据，不补造 ---------------- */

coreRouter.get('/dossier', (_req, res) => {
  ensureReviewTasks();
  const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get() as Record<string, unknown>;
  const activeResumeId = Number(getSetting('active_resume_id') || 0) || null;
  const activeJobId = Number(getSetting('active_job_id') || 0) || null;

  const resume = (activeResumeId
    ? db.prepare('SELECT id, title, content, job_id, updated_at FROM resume WHERE id = ?').get(activeResumeId)
    : db.prepare('SELECT id, title, content, job_id, updated_at FROM resume ORDER BY updated_at DESC LIMIT 1').get()) as
    | { id: number; title: string; content: string; job_id: number | null; updated_at: string }
    | undefined;

  const job = (activeJobId
    ? db.prepare('SELECT id, title, company, jd FROM job WHERE id = ?').get(activeJobId)
    : resume?.job_id
      ? db.prepare('SELECT id, title, company, jd FROM job WHERE id = ?').get(resume.job_id)
      : db.prepare('SELECT id, title, company, jd FROM job ORDER BY updated_at DESC LIMIT 1').get()) as
    | { id: number; title: string; company: string; jd: string }
    | undefined;

  const matchRow = (resume
    ? db.prepare('SELECT * FROM jd_analysis WHERE resume_id = ? ORDER BY id DESC LIMIT 1').get(resume.id)
    : db.prepare('SELECT * FROM jd_analysis ORDER BY id DESC LIMIT 1').get()) as
    | { result_json: string; created_at: string }
    | undefined;
  const match = matchRow
    ? { ...parseJson<Record<string, unknown>>(matchRow.result_json, {}), created_at: matchRow.created_at }
    : null;

  const growth = buildGrowthCached();
  const group =
    (job ? growth.groups.find((g) => g.jobId === job.id && g.count > 0) : null) ||
    growth.groups.find((g) => g.key === 'all') ||
    growth.groups[0] ||
    null;

  const recentPoints = group ? group.points.slice(-5).reverse() : [];
  const interviews = recentPoints.map((p) => ({
    id: p.id,
    startedAt: p.startedAt,
    jobTitle: p.jobTitle,
    overallScore: p.score,
    dims: p.dims,
  }));

  const scopeJobId: number | null = group?.jobId ?? null;
  const latestRow = db
    .prepare(
      `SELECT id, started_at, report_json FROM interview
       WHERE status = 'finished' AND report_json IS NOT NULL ${scopeJobId ? 'AND job_id = ?' : ''}
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(...(scopeJobId ? [scopeJobId] : [])) as
    | { id: number; started_at: string; report_json: string }
    | undefined;
  const report = latestRow ? parseJson<Record<string, unknown> | null>(latestRow.report_json, null) : null;
  const latest = report
    ? {
        id: latestRow!.id,
        startedAt: latestRow!.started_at,
        overallScore: Number(report.overallScore ?? 0),
        roundScores: (report.roundScores as { round: string; score: number; comment: string }[]) || [],
        weaknesses: (report.weaknesses as string[]) || [],
        reviewPoints: (report.reviewPoints as string[]) || [],
        summary: String(report.summary || ''),
      }
    : null;

  const reviewTotal = (db.prepare('SELECT COUNT(*) AS n FROM review').get() as { n: number }).n;
  const reviews = db
    .prepare('SELECT id, question, improvement, rating, tags, created_at FROM review ORDER BY id DESC LIMIT 5')
    .all();

  const bankTotal = (db.prepare('SELECT COUNT(*) AS n FROM bank_item').get() as { n: number }).n;
  const weakTotal = (db.prepare('SELECT COUNT(*) AS n FROM bank_item WHERE weak = 1').get() as { n: number }).n;
  const weakItems = db
    .prepare(
      `SELECT b.id, b.question, b.category, b.last_score, b.ask_count, t.due_at AS next_review_at
       FROM bank_item b
       LEFT JOIN review_task t ON t.kind = 'bank' AND t.ref_id = b.id
       WHERE b.weak = 1
       ORDER BY (b.last_score IS NULL), b.last_score ASC, b.id DESC
       LIMIT 8`,
    )
    .all();

  res.json({
    generatedAt: nowIso(),
    profile,
    resume: resume ?? null,
    job: job ?? null,
    match,
    scope: {
      jobScoped: !!group?.jobId,
      label: group?.jobId ? group.label || job?.title || '目标岗位' : '全部岗位',
    },
    interviews,
    latest,
    growth: {
      totalFinished: growth.totalFinished,
      count: group?.count ?? 0,
      points: group ? group.points.map((p) => ({ id: p.id, startedAt: p.startedAt, score: p.score })) : [],
      radar: group?.radar ?? { early: null, recent: null },
    },
    reviews: { total: reviewTotal, items: reviews },
    bank: { total: bankTotal, weak: weakTotal, items: weakItems },
  });
});

/* FUNC-04：求职档案导出 Word，与打印视图同口径，只读取本机真实记录 */
coreRouter.get(
  '/dossier/docx',
  ah(async (_req, res) => {
    ensureReviewTasks();
    const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get() as Record<string, unknown>;
    const activeResumeId = Number(getSetting('active_resume_id') || 0) || null;
    const resume = (activeResumeId
      ? db.prepare('SELECT title, content FROM resume WHERE id = ?').get(activeResumeId)
      : db.prepare('SELECT title, content FROM resume ORDER BY updated_at DESC LIMIT 1').get()) as
      | { title: string; content: string }
      | undefined;
    const job = (activeResumeId
      ? db
          .prepare(
            'SELECT j.title, j.company, j.jd FROM job j JOIN resume r ON r.job_id = j.id WHERE r.id = ?',
          )
          .get(activeResumeId)
      : db.prepare('SELECT title, company, jd FROM job ORDER BY updated_at DESC LIMIT 1').get()) as
      | { title: string; company: string; jd: string }
      | undefined;
    const latest = db
      .prepare(
        "SELECT report_json FROM interview WHERE status = 'finished' AND report_json IS NOT NULL ORDER BY started_at DESC, id DESC LIMIT 1",
      )
      .get() as { report_json: string } | undefined;
    const report = latest ? parseJson<Record<string, unknown> | null>(latest.report_json, null) : null;
    const finishedTotal = (
      db.prepare("SELECT COUNT(*) AS n FROM interview WHERE status = 'finished'").get() as { n: number }
    ).n;
    const reviewTotal = (db.prepare('SELECT COUNT(*) AS n FROM review').get() as { n: number }).n;
    const bankTotal = (db.prepare('SELECT COUNT(*) AS n FROM bank_item').get() as { n: number }).n;
    const weakTotal = (db.prepare('SELECT COUNT(*) AS n FROM bank_item WHERE weak = 1').get() as { n: number }).n;
    const weakItems = db
      .prepare(
        'SELECT question, category, last_score FROM bank_item WHERE weak = 1 ORDER BY (last_score IS NULL), last_score ASC, id DESC LIMIT 10',
      )
      .all() as { question: string; category: string; last_score: number | null }[];

    const lines = [
      '# 求职档案',
      '',
      `> 生成时间：${nowIso()}`,
      '',
      '## 基本档案',
      `- 昵称：${profile.nickname || '—'}`,
      `- 学校：${profile.school || '—'}`,
      `- 专业：${profile.major || '—'}`,
      `- 年级：${profile.grade || '—'}`,
      '',
      '## 当前简历',
      resume ? `### ${resume.title}\n\n${resume.content}` : '（暂无简历）',
      '',
      '## 目标岗位',
      job ? `### ${job.company || '—'} · ${job.title}\n\n${job.jd || '（JD 为空）'}` : '（暂无岗位）',
      '',
      '## 最近一次面试报告',
      report
        ? [
            `- 总分：${String(report.overallScore ?? '—')}`,
            '',
            ...(((report.roundScores as { round: string; score: number; comment: string }[]) || []).map(
              (r) => `- ${r.round}：${r.score} 分 — ${r.comment}`,
            )),
            '',
            '### 薄弱环节',
            ...(((report.weaknesses as string[]) || []).map((w) => `- ${w}`)),
            '',
            '### 建议复习点',
            ...(((report.reviewPoints as string[]) || []).map((r) => `- ${r}`)),
            '',
            '### 总评',
            String(report.summary || ''),
          ].join('\n')
        : '（暂无已完成的面试报告）',
      '',
      '## 训练统计',
      `- 完成面试：${finishedTotal} 场`,
      `- 复盘记录：${reviewTotal} 条`,
      `- 题库题目：${bankTotal} 道（薄弱 ${weakTotal} 道）`,
      '',
      '## 薄弱题',
      weakItems.length
        ? weakItems
            .map((b) => `- [${b.category}] ${b.question}${b.last_score != null ? `（上次 ${b.last_score} 分）` : ''}`)
            .join('\n')
        : '（暂无薄弱题）',
    ];
    const buffer = await buildDocx('求职档案', lines.join('\n'));
    sendDocx(res, `求职档案-${new Date().toISOString().slice(0, 10)}.docx`, buffer);
  }),
);
