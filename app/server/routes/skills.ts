import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, nowIso } from '../db.js';
import { chatJSON, LlmError } from '../llm.js';
import { localSkillTags } from '../fallback.js';
import { skillSchema } from '../schemas.js';
import { skillsPrompt } from '../prompts.js';
import { HttpError, ah, idOf } from '../util.js';
import { createAiJob, failAiJob, finishAiJob, getAiJob } from '../ai-jobs.js';

/**
 * DATA-03 / MOD-06：岗位技能标签与简历覆盖率。
 *
 * 技能提取是模型调用，但仍走「202 + 轮询」，避免平台网关 30s 截断；
 * 模型不可用时退化为 JD 关键词词典匹配，并在响应里标注 source=local。
 */
export const skillsRouter = Router();

interface SkillRow {
  id: number;
  job_id: number;
  skill: string;
  weight: number;
  source: string;
  created_at: string;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[\s\-_/·、,，]+/g, '');
}

function getJob(jobId: number) {
  const job = db.prepare('SELECT id, title, company, jd FROM job WHERE id = ?').get(jobId) as
    | { id: number; title: string; company: string; jd: string }
    | undefined;
  if (!job) throw new HttpError(404, '岗位不存在');
  return job;
}

function coverageOf(jobId: number, skills: SkillRow[]) {
  const resume = db
    .prepare('SELECT id, title, content FROM resume WHERE job_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1')
    .get(jobId) as { id: number; title: string; content: string } | undefined;
  const fallbackResume = resume
    ? undefined
    : (db
        .prepare('SELECT id, title, content FROM resume ORDER BY updated_at DESC, id DESC LIMIT 1')
        .get() as { id: number; title: string; content: string } | undefined);
  const target = resume || fallbackResume || null;
  const text = norm(target?.content || '');
  let weightTotal = 0;
  let weightHit = 0;
  const items = skills.map((s) => {
    const key = norm(s.skill);
    const direct = !!key && text.includes(key);
    const parts = s.skill
      .split(/[\s/、,，]+/)
      .map(norm)
      .filter((p) => p.length >= 2);
    const partial = !direct && parts.some((p) => text.includes(p));
    const status = direct ? 'covered' : partial ? 'partial' : 'missing';
    weightTotal += s.weight;
    weightHit += direct ? s.weight : partial ? s.weight * 0.5 : 0;
    return {
      skill: s.skill,
      weight: s.weight,
      status,
      evidence: direct
        ? `简历中出现「${s.skill}」`
        : partial
          ? '简历中只覆盖了部分关键词'
          : '简历中未检索到对应关键词',
    };
  });
  return {
    resume: target ? { id: target.id, title: target.title, matchedByJob: !!resume } : null,
    percent: weightTotal ? Math.round((weightHit / weightTotal) * 100) : 0,
    items,
  };
}

function skillPayload(jobId: number) {
  const job = getJob(jobId);
  const skills = db
    .prepare('SELECT * FROM job_skill WHERE job_id = ? ORDER BY weight DESC, id ASC')
    .all(jobId) as SkillRow[];
  return {
    job,
    skills,
    ...coverageOf(jobId, skills),
    updatedAt: skills[0]?.created_at || null,
  };
}

skillsRouter.get('/jobs/:id/skills', (req, res) => {
  res.json(skillPayload(idOf(req)));
});

async function extractSkills(jobId: number, forceLocal: boolean) {
  const job = getJob(jobId);
  if (job.jd.trim().length < 20) throw new HttpError(400, '岗位还没有有效 JD，请先补充岗位描述');
  let skills: { skill: string; weight: number }[] = [];
  let meta: { source: 'llm' | 'local'; note?: string } = { source: 'llm' };
  if (forceLocal) {
    skills = localSkillTags(job.jd);
    meta = { source: 'local', note: '按要求使用本地关键词提取' };
  } else {
    try {
      const out = await chatJSON(skillSchema, skillsPrompt(job.title, job.jd), {
        tag: 'job-skills',
        temperature: 0.2,
        maxTokens: 900,
      });
      skills = out.data.skills;
      meta = { source: out.meta.source };
    } catch (err) {
      const e = err as LlmError;
      skills = localSkillTags(job.jd);
      meta = { source: 'local', note: `模型不可用（${e.code || 'ERROR'}），已改用本地关键词提取` };
    }
  }

  // 归一化去重，权重取最大值；最多保留 30 个，避免长 JD 生成过多标签。
  const merged = new Map<string, { skill: string; weight: number }>();
  for (const s of skills) {
    const name = s.skill.trim().slice(0, 200);
    if (!name) continue;
    const key = norm(name);
    const prev = merged.get(key);
    if (!prev || s.weight > prev.weight) merged.set(key, { skill: name, weight: Math.max(1, Math.min(3, Math.round(s.weight))) });
  }
  const finalSkills = [...merged.values()].slice(0, 30);
  if (!finalSkills.length) throw new HttpError(422, '没有从 JD 中提取到技能标签，请补充更具体的 JD', 'EMPTY_SKILLS');

  const now = nowIso();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM job_skill WHERE job_id = ?').run(jobId);
    const insert = db.prepare(
      'INSERT INTO job_skill (job_id, skill, weight, source, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const s of finalSkills) insert.run(jobId, s.skill, s.weight, meta.source, now);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { ...skillPayload(jobId), meta };
}

skillsRouter.post(
  '/jobs/:id/skills',
  ah(async (req, res) => {
    const jobId = idOf(req);
    getJob(jobId);
    const forceLocal = !!req.body?.forceLocal;
    const job = randomUUID();
    createAiJob(job, `job-skills:${jobId}`, { jobId });
    res.status(202).json({ jobId: job, status: 'pending' });
    void (async () => {
      try {
        finishAiJob(job, await extractSkills(jobId, forceLocal));
      } catch (err) {
        const e = err as LlmError & { detail?: string };
        failAiJob(job, {
          code: e.code || 'SKILL_EXTRACT_FAILED',
          message: err instanceof HttpError ? err.message : '技能提取失败，请重试',
          detail: e.detail,
        });
      }
    })();
  }),
);

skillsRouter.get('/jobs/:id/skills/jobs/:jobId', (req, res) => {
  const jobId = idOf(req);
  const job = getAiJob(String(req.params.jobId));
  const payload = (job?.payload ?? {}) as { jobId?: number };
  if (!job || job.kind !== `job-skills:${jobId}` || payload.jobId !== jobId) {
    throw new HttpError(404, '任务不存在或已过期，请重新提取');
  }
  if (job.status === 'pending') {
    res.json({ status: 'pending' });
    return;
  }
  if (job.status === 'error') {
    res.json({ status: 'error', error: job.error });
    return;
  }
  res.json({ status: 'done', result: job.result });
});
