import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, nowIso, parseJson } from '../db.js';
import { chatJSON, LlmError } from '../llm.js';
import { bankCardSchema, type BankCardResult } from '../schemas.js';
import { bankCardPrompt } from '../prompts.js';
import { HttpError, ah, idOf } from '../util.js';
import { createAiJob, failAiJob, finishAiJob, getAiJob } from '../ai-jobs.js';

/**
 * MOD-07：任意题库题生成并保存解析卡。
 *
 * 卡片存 bank_item.card_json，随备份 v2 导出/导入；
 * 生成走 202 + 轮询，模型不可用时给通用框架，不编造个人事实。
 */
export const bankCardRouter = Router();

interface BankRow {
  id: number;
  question: string;
  category: string;
  card_json: string | null;
  job_title: string | null;
}

function bankRow(id: number): BankRow | undefined {
  return db
    .prepare(
      'SELECT b.id, b.question, b.category, b.card_json, j.title AS job_title FROM bank_item b LEFT JOIN job j ON j.id = b.job_id WHERE b.id = ?',
    )
    .get(id) as BankRow | undefined;
}

function localCard(row: BankRow): BankCardResult {
  return {
    summary: `这道题属于「${row.category}」，主要考察你能否把真实经历讲清楚、讲具体。`,
    keyPoints: ['先确认问题边界与考察点', '用一段真实经历回答', '说清个人行动与结果', '补充反思与迁移'],
    framework: [
      { title: '定位', detail: '一句话回应问题，确认自己理解的是同一个方向。' },
      { title: '背景', detail: '交代情境与目标，控制在一两句话。' },
      { title: '行动', detail: '按步骤讲你个人做了什么、为什么这样做。' },
      { title: '结果', detail: '给出结果与量化指标；没有数据就说「待补充」。' },
      { title: '反思', detail: '补充不足与下一次会怎么改进。' },
    ],
    sample: `（示例）这道题我会从一段真实经历回答：当时的情境是（替换为你的项目/实习），我的任务是把（替换为具体目标）做好。我先（替换为第一步），再（替换为第二步），最终结果是（替换为可验证结果）。如果重来一次，我会（替换为改进点）。`,
    pitfalls: ['只讲团队做了什么，没讲个人贡献', '堆概念没有具体步骤', '结果没有数据支撑', '答得太长，没有先给结论'],
    followups: ['如果资源只有一半，你会怎么调整？', '这件事里最大的失误是什么？', '如果重来一次，你会先做什么？'],
  };
}

async function runBankCard(row: BankRow) {
  try {
    const { data, meta } = await chatJSON(
      bankCardSchema,
      bankCardPrompt({ question: row.question, category: row.category, jobTitle: row.job_title || '' }),
      { tag: 'bank-card', temperature: 0.4, maxTokens: 1800 },
    );
    return { card: { ...data, generatedAt: nowIso(), meta }, meta };
  } catch (err) {
    const e = err as LlmError;
    return {
      card: { ...localCard(row), generatedAt: nowIso(), meta: { source: 'local', note: '模型不可用，已生成通用解析框架' } },
      meta: { source: 'local', note: `模型不可用（${e.code || 'ERROR'}），已生成通用解析框架` },
    };
  }
}

bankCardRouter.get('/bank/:id/card', (req, res) => {
  const row = bankRow(idOf(req));
  if (!row) throw new HttpError(404, '题目不存在');
  const card = parseJson<Record<string, unknown> | null>(row.card_json, null);
  res.json({ card, question: row.question, category: row.category });
});

bankCardRouter.post(
  '/bank/:id/card/generate',
  ah(async (req, res) => {
    const id = idOf(req);
    const row = bankRow(id);
    if (!row) throw new HttpError(404, '题目不存在');
    const jobId = randomUUID();
    createAiJob(jobId, `bank-card:${id}`, { bankId: id });
    res.status(202).json({ jobId, status: 'pending' });
    void (async () => {
      try {
        const result = await runBankCard(row);
        db.prepare('UPDATE bank_item SET card_json = ? WHERE id = ?').run(JSON.stringify(result.card), id);
        finishAiJob(jobId, { card: result.card, question: row.question, category: row.category });
      } catch (err) {
        failAiJob(jobId, {
          code: 'BANK_CARD_FAILED',
          message: err instanceof Error ? err.message : '解析卡生成失败，请重试',
        });
      }
    })();
  }),
);

bankCardRouter.get('/bank/:id/card/jobs/:jobId', (req, res) => {
  const id = idOf(req);
  const job = getAiJob(String(req.params.jobId));
  const payload = (job?.payload ?? {}) as { bankId?: number };
  if (!job || job.kind !== `bank-card:${id}` || payload.bankId !== id) {
    throw new HttpError(404, '任务不存在或已过期，请重新生成');
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
