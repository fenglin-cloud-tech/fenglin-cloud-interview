import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso } from '../db.js';
import { hasApiKey } from '../env.js';
import { chatJSON, LlmError, type LlmMeta } from '../llm.js';
import { localJdMatch } from '../fallback.js';
import {
  feedbackSchema,
  iterateSchema,
  jdMatchSchema,
  polishSchema,
  suggestionSchema,
} from '../schemas.js';
import type { JdMatchResult } from '../schemas.js';
import { iteratePrompt, jdMatchPrompt, polishPrompt, reviewCoachPrompt, suggestionsPrompt } from '../prompts.js';
import { HttpError, ah, str } from '../util.js';

export const aiRouter = Router();

function requireText(value: unknown, field: string, min = 20, max = 20000): string {
  const text = str(value, max).trim();
  if (text.length < min) throw new HttpError(400, `${field}太短，至少需要 ${min} 个字，请补充后再试`);
  return text;
}

aiRouter.get('/ai/status', (_req, res) => {
  res.json({ configured: hasApiKey() });
});

/* 简历优化建议 */
aiRouter.post(
  '/ai/suggestions',
  ah(async (req, res) => {
    const resumeText = requireText(req.body?.resumeText, '简历内容');
    const jobTitle = str(req.body?.jobTitle, 120).trim();
    try {
      const { data, meta } = await chatJSON(suggestionSchema, suggestionsPrompt(resumeText, jobTitle), {
        tag: 'suggestions',
        temperature: 0.4,
        maxTokens: 2600,
      });
      res.json({ result: data, meta });
    } catch (err) {
      const e = err as LlmError;
      throw new HttpError(
        503,
        e.code === 'NO_KEY' ? '服务端未配置智谱 API Key，暂时无法生成建议' : 'AI 暂时无法给出建议，请稍后重试',
        e.code || 'LLM_FAILED',
        e.detail,
      );
    }
  }),
);

/* JD 匹配：失败时降级为本地关键词比对，并明确标注 */
aiRouter.post(
  '/ai/jd-match',
  ah(async (req, res) => {
    const resumeText = requireText(req.body?.resumeText, '简历内容');
    const jd = requireText(req.body?.jd, 'JD 内容', 30);
    let result: JdMatchResult;
    let meta: LlmMeta;
    try {
      const out = await chatJSON(jdMatchSchema, jdMatchPrompt(resumeText, jd), {
        tag: 'jd-match',
        temperature: 0.3,
        maxTokens: 2200,
      });
      result = out.data;
      meta = out.meta;
    } catch (err) {
      const e = err as LlmError;
      const local = localJdMatch(resumeText, jd);
      result = local;
      meta = { source: 'local', note: `模型不可用（${e.code || 'ERROR'}），已改用本地关键词比对` };
    }
    let savedId: number | null = null;
    const resumeId = req.body?.resumeId ? Number(req.body.resumeId) : null;
    if (resumeId) {
      const info = db
        .prepare('INSERT INTO jd_analysis (resume_id, job_id, jd, score, result_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          resumeId,
          req.body?.jobId ? Number(req.body.jobId) : null,
          jd,
          Math.round(result.score),
          JSON.stringify(result),
          meta.source === 'local' ? 'local' : 'llm',
          nowIso(),
        );
      savedId = Number(info.lastInsertRowid);
    }
    res.json({ result, meta, savedId });
  }),
);

aiRouter.get('/jd-analyses', (req, res) => {
  const resumeId = req.query.resumeId ? Number(req.query.resumeId) : null;
  const rows = resumeId
    ? db.prepare('SELECT * FROM jd_analysis WHERE resume_id = ? ORDER BY id DESC LIMIT 20').all(resumeId)
    : db.prepare('SELECT * FROM jd_analysis ORDER BY id DESC LIMIT 20').all();
  res.json({
    analyses: (rows as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      resume_id: r.resume_id,
      job_id: r.job_id,
      jd: r.jd,
      score: r.score,
      source: r.source,
      created_at: r.created_at,
      result: JSON.parse(String(r.result_json)),
    })),
  });
});

/* 对话式迭代 */
aiRouter.post(
  '/ai/iterate',
  ah(async (req, res) => {
    const resumeText = requireText(req.body?.resumeText, '简历内容');
    const currentResume = str(req.body?.currentResume, 20000).trim() || resumeText;
    const jobTitle = str(req.body?.jobTitle, 120).trim();
    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = rawMessages
      .filter((m: unknown): m is { role: string; content: string } => {
        const mm = m as { role?: unknown; content?: unknown };
        return !!mm && typeof mm.content === 'string' && (mm.role === 'user' || mm.role === 'assistant');
      })
      .slice(-8)
      .map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: str(m.content, 6000),
      }));
    if (!messages.length) throw new HttpError(400, '请先输入你的修改要求');
    try {
      const { data, meta } = await chatJSON(
        iterateSchema,
        iteratePrompt({ resumeText, currentResume, jobTitle, messages }),
        { tag: 'iterate', temperature: 0.5, maxTokens: 3000 },
      );
      res.json({ result: data, meta });
    } catch (err) {
      const e = err as LlmError;
      throw new HttpError(
        503,
        e.code === 'NO_KEY' ? '服务端未配置智谱 API Key，暂时无法迭代' : 'AI 迭代暂时不可用，请稍后重试',
        e.code || 'LLM_FAILED',
        e.detail,
      );
    }
  }),
);

/* 新手初稿润色 */
aiRouter.post(
  '/ai/polish',
  ah(async (req, res) => {
    const markdown = requireText(req.body?.markdown, '初稿内容');
    const jobTitle = str(req.body?.jobTitle, 120).trim();
    try {
      const { data, meta } = await chatJSON(polishSchema, polishPrompt(markdown, jobTitle), {
        tag: 'polish',
        temperature: 0.4,
        maxTokens: 3000,
      });
      res.json({ result: data, meta });
    } catch (err) {
      const e = err as LlmError;
      const fallback = { resume: markdown, notes: ['AI 润色不可用，已保留你的初稿；可直接继续人工修改。'] };
      res.json({
        result: fallback,
        meta: { source: 'local', note: `模型不可用（${e.code || 'ERROR'}），已保留初稿` },
      });
    }
  }),
);

/* 复盘改进点建议 */
aiRouter.post(
  '/ai/review-coach',
  ah(async (req, res) => {
    const question = requireText(req.body?.question, '问题', 4);
    const answer = str(req.body?.answer, 8000);
    const performance = str(req.body?.performance, 4000);
    const schema = z.object({
      improvement: z.string().min(1),
      tags: z.array(z.string()).catch([]),
    });
    try {
      const { data, meta } = await chatJSON(schema, reviewCoachPrompt({ question, answer, performance }), {
        tag: 'review-coach',
        temperature: 0.4,
        maxTokens: 900,
      });
      res.json({ result: data, meta });
    } catch (err) {
      const e = err as LlmError;
      throw new HttpError(503, 'AI 暂时无法给出改进建议，请稍后重试', e.code || 'LLM_FAILED');
    }
  }),
);
