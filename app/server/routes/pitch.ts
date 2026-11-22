import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { chatJSON, LlmError } from '../llm.js';
import { pitchSchema } from '../schemas.js';
import { pitchPrompt } from '../prompts.js';
import { HttpError, ah, str } from '../util.js';
import { createAiJob, failAiJob, finishAiJob, getAiJob } from '../ai-jobs.js';
import { experienceSnippet } from './experiences.js';

/**
 * MOD-02：自我介绍与背稿卡。
 *
 * 生成仍是模型长任务，走 202 + 轮询；结果不落新表，前端把三版草稿存 localStorage。
 * 素材来自当前简历、目标岗位与 experience_card，不编造简历里没有的事实。
 */
export const pitchRouter = Router();

const DURATIONS = [60, 90, 120];

function resolveContext(resumeId: number | null, jobId: number | null) {
  const resume = (resumeId
    ? db.prepare('SELECT id, title, content, job_id FROM resume WHERE id = ?').get(resumeId)
    : db.prepare('SELECT id, title, content, job_id FROM resume ORDER BY updated_at DESC, id DESC LIMIT 1').get()) as
    | { id: number; title: string; content: string; job_id: number | null }
    | undefined;
  if (!resume) throw new HttpError(400, '请先在「我的简历」准备一份简历，再生成自我介绍');
  const targetJobId = jobId || resume.job_id || null;
  const job = (targetJobId
    ? db.prepare('SELECT id, title, company, jd FROM job WHERE id = ?').get(targetJobId)
    : db.prepare('SELECT id, title, company, jd FROM job ORDER BY updated_at DESC, id DESC LIMIT 1').get()) as
    | { id: number; title: string; company: string; jd: string }
    | undefined;
  return { resume, job };
}

function localPitch(params: {
  resume: { title: string; content: string };
  jobTitle: string;
  profile: { nickname: string; school: string; major: string; grade: string };
  experiences: string;
}) {
  const name = params.profile.nickname || '（姓名待补充）';
  const education = [params.profile.school, params.profile.major, params.profile.grade].filter(Boolean).join(' · ');
  const lines = params.resume.content
    .split('\n')
    .map((l) => l.trim().replace(/^#+\s*/, ''))
    .filter((l) => l.length >= 6)
    .slice(0, 4);
  const project = lines[0] || '（项目经历待补充）';
  const second = lines[1] || '';
  const job = params.jobTitle || '目标岗位';
  const expLine = params.experiences
    ? params.experiences.split('\n').find((l) => /^结果：|^指标：/.test(l)) || ''
    : '';

  const opening = `面试官好，我是${name}${education ? `，来自${education}` : ''}。`;
  const relevance = `我关注${job}，${project}。`;
  const result = expLine ? `${expLine.replace(/^(结果|指标)：/, '其中')}。` : '这段经历让我对岗位需要的核心能力有了实际练习。';
  const why = `我选择${job}，是因为希望把已有的项目经验用到更真实的业务场景里，也愿意从基础工作做起。`;
  const closing = '我的介绍到这里，谢谢面试官。';

  return {
    versions: DURATIONS.map((duration) => {
      const text =
        duration === 60
          ? `${opening}${relevance}${closing}`
          : duration === 90
            ? `${opening}${relevance}${result}${closing}`
            : `${opening}${relevance}${result}${second ? `${second}。` : ''}${why}${closing}`;
      return {
        duration,
        text,
        outline:
          duration === 60
            ? ['我是谁', '最相关的一段经历', '收尾']
            : duration === 90
              ? ['我是谁', '相关经历', '结果', '收尾']
              : ['我是谁', '相关经历', '结果', '为什么投', '收尾'],
        tips: ['模型不可用，本版由本地模板拼装，请按真实经历补充细节', '朗读时在经历与结果之间停顿半秒'],
      };
    }),
    source: 'local' as const,
    note: '模型不可用，已用本地模板基于简历原文拼装，请人工核对后再背。',
  };
}

async function runPitchJob(payload: {
  resume: { id: number; title: string; content: string };
  job: { id: number; title: string; company: string } | null;
  profile: { nickname: string; school: string; major: string; grade: string };
}) {
  const jobTitle = payload.job?.title || '';
  const experiences = experienceSnippet(payload.job?.id ?? null, 2);
  if (!payload.resume.content.trim()) throw new HttpError(400, '当前简历内容为空，无法生成自我介绍');
  try {
    const { data, meta } = await chatJSON(
      pitchSchema,
      pitchPrompt({
        resumeText: payload.resume.content,
        jobTitle,
        profile: [payload.profile.nickname, payload.profile.school, payload.profile.major, payload.profile.grade]
          .filter(Boolean)
          .join('｜'),
        experiences,
      }),
      { tag: 'pitch', temperature: 0.5, maxTokens: 2600 },
    );
    return {
      versions: data.versions.length ? data.versions : localPitch({ ...payload, jobTitle, experiences }).versions,
      meta,
      resume: { id: payload.resume.id, title: payload.resume.title },
      job: payload.job ? { id: payload.job.id, title: payload.job.title, company: payload.job.company } : null,
    };
  } catch (err) {
    const e = err as LlmError;
    const local = localPitch({ ...payload, jobTitle, experiences });
    return {
      versions: local.versions,
      meta: { source: 'local', note: local.note },
      resume: { id: payload.resume.id, title: payload.resume.title },
      job: payload.job ? { id: payload.job.id, title: payload.job.title, company: payload.job.company } : null,
      fallbackCode: e.code || 'ERROR',
    };
  }
}

pitchRouter.post(
  '/pitch/generate',
  ah(async (req, res) => {
    const resumeId = req.body?.resumeId ? Number(req.body.resumeId) : null;
    const jobId = req.body?.jobId ? Number(req.body.jobId) : null;
    const { resume, job } = resolveContext(resumeId, jobId);
    const profile = db.prepare('SELECT nickname, school, major, grade FROM profile WHERE id = 1').get() as {
      nickname: string;
      school: string;
      major: string;
      grade: string;
    };
    const id = randomUUID();
    createAiJob(id, 'pitch', { resumeId: resume.id, jobId: job?.id ?? null });
    res.status(202).json({ jobId: id, status: 'pending' });
    void (async () => {
      try {
        finishAiJob(id, await runPitchJob({ resume, job: job ?? null, profile }));
      } catch (err) {
        failAiJob(id, {
          code: err instanceof HttpError ? err.code : 'PITCH_FAILED',
          message: err instanceof Error ? err.message : '自我介绍生成失败，请重试',
          detail: str((err as { detail?: unknown })?.detail, 2000) || undefined,
        });
      }
    })();
  }),
);

pitchRouter.get('/pitch/generate/:jobId', (req, res) => {
  const job = getAiJob(String(req.params.jobId));
  if (!job || job.kind !== 'pitch') throw new HttpError(404, '任务不存在或已过期，请重新生成');
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
