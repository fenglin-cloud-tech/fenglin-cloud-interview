import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, nowIso, parseJson } from '../db.js';
import { chatJSON, LlmError } from '../llm.js';
import { localFeedback, localQuestion } from '../fallback.js';
import { feedbackSchema, questionSchema, reportSchema } from '../schemas.js';
import type { FeedbackResult, ReportResult } from '../schemas.js';
import { FOLLOWUP_FOCUS_LABEL, ROUNDS, TOTAL_BASE_QUESTIONS, roundByKey } from '../interview-plan.js';
import {
  COMMON_QUESTIONS,
  COMMON_SOURCE,
  DIRECTIONS,
  directionLabel,
  isDirection,
  pickCommonQuestion,
} from '../common-questions.js';
import type { DirectionKey } from '../common-questions.js';
import { feedbackPrompt, questionPrompt, reportPrompt } from '../prompts.js';
import { FOLLOWUP_THRESHOLD, analyzeAnswer, buildFallbackFollowup, calibrateScores } from '../scoring.js';
import { HttpError, ah, idOf, sendDocx, str } from '../util.js';
import { buildDocx } from '../docx-export.js';
import { createAiJob, failAiJob, finishAiJob, getAiJob, hasPendingAiJob } from '../ai-jobs.js';
import { experienceSnippet } from './experiences.js';
import { deriveTags } from '../tags.js';

export const interviewRouter = Router();

interface InterviewRow {
  id: number;
  resume_id: number | null;
  job_id: number | null;
  mode: string;
  status: string;
  round_key: string;
  question_index: number;
  seed_json: string | null;
  started_at: string;
  ended_at: string | null;
  report_json: string | null;
  overall_score: number | null;
}

interface TurnRow {
  id: number;
  interview_id: number;
  round_key: string;
  seq: number;
  depth: number;
  parent_id: number | null;
  question: string;
  focus: string;
  answer: string | null;
  feedback_json: string | null;
  score: number | null;
  source: string;
  created_at: string;
  answered_at: string | null;
  answer_started_at: string | null;
  duration_sec: number | null;
  tags_json: string | null;
  skipped: number;
}

/**
 * 单题反馈 / 面试报告都是长任务：网关约 30s 截断，不能继续在 HTTP 请求里同步等待。
 * 沿用「202 + 轮询」模式，任务状态落 ai_job 表（PERF-08），
 * 实例重启后仍可继续轮询；仍按单实例设计，不承诺跨实例共享。
 */
function jobKindOf(interviewId: number, kind: 'answer' | 'finish' | 'skip'): string {
  return `interview:${interviewId}:${kind}`;
}

function jobErrorOf(err: unknown): { code: string; message: string; detail?: string } {
  if (err instanceof HttpError) {
    return { code: err.code, message: err.message, detail: err.detail };
  }
  if (err instanceof LlmError) {
    return { code: err.code, message: err.message, detail: err.detail };
  }
  console.error('[interview] 异步任务失败:', err instanceof Error ? err.stack : err);
  return { code: 'INTERNAL', message: '任务执行失败，请重试' };
}

function hasPendingJob(interviewId: number, kind: 'answer' | 'finish'): boolean {
  return hasPendingAiJob(jobKindOf(interviewId, kind));
}

function startInterviewJob<T>(interviewId: number, kind: 'answer' | 'finish' | 'skip', task: () => Promise<T>): string {
  const jobId = randomUUID();
  createAiJob(jobId, jobKindOf(interviewId, kind), { interviewId, kind });
  void (async () => {
    try {
      finishAiJob(jobId, await task());
    } catch (err) {
      failAiJob(jobId, jobErrorOf(err));
    }
  })();
  return jobId;
}

function getInterview(id: number): InterviewRow {
  const row = db.prepare('SELECT * FROM interview WHERE id = ?').get(id) as InterviewRow | undefined;
  if (!row) throw new HttpError(404, '面试不存在');
  return row;
}

function turnsOf(id: number): TurnRow[] {
  return db.prepare('SELECT * FROM interview_turn WHERE interview_id = ? ORDER BY seq ASC').all(id) as TurnRow[];
}

interface PlanRound {
  key: string;
  name: string;
  numeral: string;
  desc: string;
  count: number;
}

interface SeedInfo {
  source: 'resume' | 'mixed' | 'common' | 'bank';
  direction?: DirectionKey;
  bank: string[];
}

/** seed_json 兼容两种格式：旧题库模式存 string[]，新模式存 {source, direction}。 */
function seedOf(iv: InterviewRow): SeedInfo {
  const raw = parseJson<unknown>(iv.seed_json, null);
  if (Array.isArray(raw)) {
    return {
      source: iv.mode === 'bank' ? 'bank' : 'resume',
      bank: raw.filter((x): x is string => typeof x === 'string'),
    };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { source?: unknown; direction?: unknown };
    const source = o.source === 'common' || o.source === 'mixed' ? o.source : 'resume';
    return { source, direction: isDirection(o.direction) ? o.direction : undefined, bank: [] };
  }
  return { source: iv.mode === 'bank' ? 'bank' : 'resume', bank: [] };
}

function planFor(iv: InterviewRow): PlanRound[] {
  const seed = seedOf(iv);
  if (iv.mode === 'bank') {
    return [
      {
        key: 'practice',
        name: '题库再练',
        numeral: '练',
        desc: '从你的个人题库里抽题，逐题作答并给反馈',
        count: Math.max(1, seed.bank.length),
      },
    ];
  }
  const dir = directionLabel(seed.direction);
  return ROUNDS.map((r) => {
    let desc = r.desc;
    if (seed.source === 'common' && (r.key === 'professional' || r.key === 'behavioral')) {
      desc =
        r.key === 'professional'
          ? `「${dir}」方向的常见技术基础与项目题`
          : `「${dir}」方向的常见行为面试题，用 STAR 作答`;
    } else if (seed.source === 'mixed' && (r.key === 'professional' || r.key === 'behavioral')) {
      desc = `${r.desc}，后半段混入「${dir}」常见题`;
    }
    return { key: r.key, name: r.name, numeral: r.numeral, desc, count: r.count };
  });
}

function totalBase(iv: InterviewRow): number {
  return iv.mode === 'bank' ? Math.max(1, seedOf(iv).bank.length) : TOTAL_BASE_QUESTIONS;
}

function resumeContent(resumeId: number | null): string {
  if (!resumeId) return '';
  const row = db.prepare('SELECT content FROM resume WHERE id = ?').get(resumeId) as { content: string } | undefined;
  return row?.content || '';
}

function jobTitleOf(jobId: number | null): string {
  if (!jobId) return '';
  const row = db.prepare('SELECT title FROM job WHERE id = ?').get(jobId) as { title: string } | undefined;
  return row?.title || '';
}

function jobJdOf(jobId: number | null): string {
  if (!jobId) return '';
  const row = db.prepare('SELECT jd FROM job WHERE id = ?').get(jobId) as { jd: string } | undefined;
  return row?.jd || '';
}

async function makeQuestion(
  iv: InterviewRow,
  roundKey: string,
  seedQuestion?: string,
): Promise<{ question: string; focus: string; source: 'llm' | 'local' | 'builtin' | 'common' }> {
  const asked = turnsOf(iv.id)
    .filter((t) => t.round_key === roundKey && t.depth === 0)
    .map((t) => t.question);
  const resumeText = resumeContent(iv.resume_id);
  const jobTitle = jobTitleOf(iv.job_id);
  const jd = jobJdOf(iv.job_id);
  // 自我介绍与反问环节用固定题面，保证「分轮次」稳定，不让模型跑偏成专业题
  if (roundKey === 'intro' || roundKey === 'reverse') {
    const q = localQuestion({ roundKey, resumeText, jobTitle, asked });
    return { question: q.question, focus: q.focus, source: 'builtin' };
  }

  const seed = seedOf(iv);
  // 以数据库里的当前进度为准：换轮时 iv 是旧快照，question_index 可能还没刷新。
  const questionIndex = getInterview(iv.id).question_index;
  const useCommon =
    !!seed.direction &&
    !seedQuestion &&
    (seed.source === 'common' || (seed.source === 'mixed' && questionIndex >= 1));
  if (useCommon && seed.direction) {
    const banked = (db.prepare('SELECT question FROM bank_item').all() as { question: string }[]).map((r) => r.question);
    const allAsked = turnsOf(iv.id).map((t) => t.question);
    const picked = pickCommonQuestion({
      direction: seed.direction,
      roundKey,
      asked: allAsked,
      banked,
      offset: iv.id * 7 + questionIndex * 3,
    });
    if (picked) {
      return {
        question: picked.question,
        focus: `${picked.focus} · ${directionLabel(seed.direction)}常见题`,
        source: 'common',
      };
    }
  }
  try {
    const { data, meta } = await chatJSON(
      questionSchema,
      questionPrompt({
        roundKey,
        resumeText,
        jobTitle,
        jd,
        asked,
        seedQuestion,
        experiences: experienceSnippet(iv.job_id),
      }),
      { tag: `question-${roundKey}`, temperature: 0.75, maxTokens: 500 },
    );
    return { question: data.question.trim(), focus: data.focus || roundByKey(roundKey).name, source: meta.source };
  } catch (err) {
    const e = err as LlmError;
    console.warn(`[interview] 出题降级 ${e.code}: ${e.message}`);
    const q = localQuestion({ roundKey, resumeText, jobTitle, asked, seedQuestion });
    return { ...q, source: 'local' };
  }
}

function insertTurn(
  interviewId: number,
  roundKey: string,
  seq: number,
  depth: number,
  parentId: number | null,
  question: string,
  focus: string,
  source: string,
): TurnRow {
  const now = nowIso();
  const info = db
    .prepare(
      'INSERT INTO interview_turn (interview_id, round_key, seq, depth, parent_id, question, focus, source, created_at, answer_started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(interviewId, roundKey, seq, depth, parentId, question, focus, source, now, now);
  return db.prepare('SELECT * FROM interview_turn WHERE id = ?').get(Number(info.lastInsertRowid)) as TurnRow;
}

function nextSeq(interviewId: number): number {
  const row = db.prepare('SELECT MAX(seq) AS s FROM interview_turn WHERE interview_id = ?').get(interviewId) as {
    s: number | null;
  };
  return (row.s ?? 0) + 1;
}

function sessionPayload(ivId: number) {
  const iv = getInterview(ivId);
  const turns = turnsOf(ivId);
  const plan = planFor(iv);
  const answeredBase = turns.filter((t) => t.depth === 0 && t.answer !== null).length;
  const skippedBase = turns.filter((t) => t.depth === 0 && t.skipped === 1).length;
  const total = totalBase(iv);
  const answeredAll = turns.filter((t) => t.answer !== null).length;
  const currentRound = plan.find((r) => r.key === iv.round_key) || plan[0];
  const resume = iv.resume_id
    ? (db.prepare('SELECT id, title FROM resume WHERE id = ?').get(iv.resume_id) ?? null)
    : null;
  const job = iv.job_id ? (db.prepare('SELECT id, title, company FROM job WHERE id = ?').get(iv.job_id) ?? null) : null;
  return {
    interview: {
      ...iv,
      report: parseJson<ReportResult | null>(iv.report_json, null),
      seed: parseJson<string[]>(iv.seed_json, []),
    },
    resume,
    job,
    plan,
    currentRound,
    turns: turns.map((t) => ({
      ...t,
      feedback: parseJson<FeedbackResult | null>(t.feedback_json, null),
      tags: parseJson<string[]>(t.tags_json, []),
      focusLabel: FOLLOWUP_FOCUS_LABEL[t.focus] || t.focus,
    })),
    progress: {
      answeredBase,
      skippedBase,
      total,
      answeredAll,
      percent: total ? Math.min(100, Math.round(((answeredBase + skippedBase) / total) * 100)) : 0,
    },
    pendingTurn: turns.find((t) => t.answer === null && !t.skipped) || null,
  };
}

interviewRouter.get('/common-questions', (_req, res) => {
  res.json({
    source: COMMON_SOURCE,
    total: COMMON_QUESTIONS.length,
    directions: DIRECTIONS.map((d) => ({
      ...d,
      count: COMMON_QUESTIONS.filter((q) => q.direction === d.key).length,
    })),
    questions: COMMON_QUESTIONS,
  });
});

interviewRouter.get('/interviews', (req, res) => {
  // 游标分页 + 状态/岗位/模式筛选；旧客户端不带参数时行为与原来的「最近 20 条」一致。
  const status = str(req.query.status, 20).trim();
  const mode = str(req.query.mode, 20).trim();
  const jobId = req.query.jobId ? Number(req.query.jobId) : null;
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const limitRaw = req.query.limit ? Number(req.query.limit) : 20;
  const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (status) {
    conds.push('i.status = ?');
    params.push(status);
  }
  if (mode) {
    conds.push('i.mode = ?');
    params.push(mode);
  }
  if (jobId) {
    conds.push('i.job_id = ?');
    params.push(jobId);
  }
  if (cursor) {
    conds.push('i.id < ?');
    params.push(cursor);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT i.*, j.title AS job_title, r.title AS resume_title,
        (SELECT COUNT(*) FROM interview_turn t WHERE t.interview_id = i.id AND t.answer IS NOT NULL) AS answered
       FROM interview i
       LEFT JOIN job j ON j.id = i.job_id
       LEFT JOIN resume r ON r.id = i.resume_id
       ${where}
       ORDER BY i.id DESC LIMIT ?`,
    )
    .all(...params, limit);
  const nextCursor = rows.length === limit ? (rows[rows.length - 1] as { id: number }).id : null;
  res.json({ interviews: rows, nextCursor });
});

interviewRouter.get('/interviews/:id', (req, res) => {
  res.json(sessionPayload(idOf(req)));
});

/* FUNC-03：面试报告导出 Word（与前端 Markdown 同一口径，只读取已保存的报告） */
interviewRouter.get(
  '/interviews/:id/report/docx',
  ah(async (req, res) => {
    const id = idOf(req);
    const iv = db.prepare('SELECT * FROM interview WHERE id = ?').get(id) as
      | { id: number; status: string; report_json: string | null; started_at: string; job_id: number | null; resume_id: number | null }
      | undefined;
    if (!iv) throw new HttpError(404, '面试不存在');
    if (!iv.report_json) throw new HttpError(400, '这场面试还没有生成报告');
    const report = JSON.parse(iv.report_json) as {
      overallScore: number;
      summary: string;
      roundScores: { round: string; score: number; comment: string }[];
      weaknesses: string[];
      reviewPoints: string[];
    };
    const job = iv.job_id
      ? (db.prepare('SELECT title FROM job WHERE id = ?').get(iv.job_id) as { title: string } | undefined)
      : undefined;
    const resume = iv.resume_id
      ? (db.prepare('SELECT title FROM resume WHERE id = ?').get(iv.resume_id) as { title: string } | undefined)
      : undefined;
    const turns = db
      .prepare(
        'SELECT question, answer, score, feedback_json, duration_sec, tags_json FROM interview_turn WHERE interview_id = ? AND answer IS NOT NULL ORDER BY round_key, seq, id',
      )
      .all(id) as {
      question: string;
      answer: string;
      score: number | null;
      feedback_json: string | null;
      duration_sec: number | null;
      tags_json: string | null;
    }[];
    const lines = [
      '# 模拟面试报告',
      '',
      `- 岗位：${job?.title || '未关联'}`,
      `- 简历：${resume?.title || '未关联'}`,
      `- 时间：${iv.started_at}`,
      `- 总分：${report.overallScore}`,
      '',
      '## 各轮得分',
      ...report.roundScores.map((r) => `- ${r.round}：${r.score} 分 — ${r.comment}`),
      '',
      '## 薄弱环节',
      ...report.weaknesses.map((w) => `- ${w}`),
      '',
      '## 建议复习点',
      ...report.reviewPoints.map((r) => `- ${r}`),
      '',
      '## 总评',
      report.summary,
      '',
      '## 问答记录',
      ...turns.map((t, i) => {
        let feedback = '';
        try {
          feedback = (JSON.parse(t.feedback_json || '{}') as { summary?: string }).summary || '';
        } catch {
          feedback = '';
        }
        return `### ${i + 1}. ${t.question}\n\n**我的回答**：${t.answer}\n\n**得分**：${t.score ?? '—'}\n\n**用时**：${t.duration_sec != null ? `${t.duration_sec} 秒` : '—'}\n\n**薄弱标签**：${parseJson<string[]>(t.tags_json, []).join('、') || '—'}\n\n**反馈**：${feedback}\n`;
      }),
    ];
    const buffer = await buildDocx(`面试报告-${id}`, lines.join('\n'));
    sendDocx(res, `面试报告-${id}.docx`, buffer);
  }),
);

interviewRouter.post(
  '/interviews',
  ah(async (req, res) => {
    const body = req.body ?? {};
    const mode =
      body.mode === 'bank' ? 'bank' : body.mode === 'common' ? 'common' : body.mode === 'mixed' ? 'mixed' : 'resume';
    const direction = isDirection(body.direction) ? body.direction : undefined;
    const resumeId = body.resumeId ? Number(body.resumeId) : null;
    const jobId = body.jobId ? Number(body.jobId) : null;
    let seeds: string[] = [];

    if ((mode === 'common' || mode === 'mixed') && !direction) {
      throw new HttpError(400, '请选择一个岗位方向，再开始常见题面试');
    }
    if (mode === 'bank') {
      const ids: number[] = Array.isArray(body.bankIds) ? body.bankIds.map(Number).filter((n: number) => n > 0) : [];
      if (!ids.length) throw new HttpError(400, '请至少选择 1 道题库题目');
      const rows = ids
        .map((id) => db.prepare('SELECT question FROM bank_item WHERE id = ?').get(id) as { question: string } | undefined)
        .filter(Boolean) as { question: string }[];
      if (!rows.length) throw new HttpError(400, '选中的题目已不存在');
      seeds = rows.map((r) => r.question);
    } else if (mode === 'common') {
      // 常见题专项不依赖简历，但仍可选一份作为上下文
      if (resumeId) {
        const resume = db.prepare('SELECT content FROM resume WHERE id = ?').get(resumeId) as
          | { content: string }
          | undefined;
        if (!resume) throw new HttpError(404, '简历不存在');
      }
    } else {
      if (!resumeId) throw new HttpError(400, '请先选择一份简历');
      const resume = db.prepare('SELECT content FROM resume WHERE id = ?').get(resumeId) as
        | { content: string }
        | undefined;
      if (!resume) throw new HttpError(404, '简历不存在');
      if (resume.content.trim().length < 20) throw new HttpError(400, '简历内容太短，请先在简历库补充');
    }

    const now = nowIso();
    const firstRound = mode === 'bank' ? 'practice' : ROUNDS[0].key;
    const seedPayload =
      mode === 'bank' ? JSON.stringify(seeds) : JSON.stringify({ source: mode, direction: direction ?? null });
    const info = db
      .prepare(
        'INSERT INTO interview (resume_id, job_id, mode, status, round_key, question_index, seed_json, started_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      )
      .run(resumeId, jobId, mode, 'active', firstRound, seedPayload, now);
    const id = Number(info.lastInsertRowid);

    const q = await makeQuestion(getInterview(id), firstRound, mode === 'bank' ? seeds[0] : undefined);
    insertTurn(id, firstRound, 1, 0, null, q.question, q.focus, q.source);
    res.status(201).json(sessionPayload(id));
  }),
);

async function runAnswerJob(id: number, turnId: number, answer: string) {
  let iv = getInterview(id);
  if (iv.status !== 'active') throw new HttpError(409, '这场面试已经结束');
  const turn = db
    .prepare('SELECT * FROM interview_turn WHERE id = ? AND interview_id = ?')
    .get(turnId, id) as TurnRow | undefined;
  if (!turn) throw new HttpError(404, '题目不存在');
  if (turn.answer !== null) throw new HttpError(409, '这道题已经作答过了');

  let feedback: FeedbackResult;
  let source: 'llm' | 'local' = 'llm';
  try {
    const { data } = await chatJSON(
      feedbackSchema,
      feedbackPrompt({
        roundKey: turn.round_key,
        question: turn.question,
        answer,
        jobTitle: jobTitleOf(iv.job_id),
        depth: turn.depth,
      }),
      { tag: `feedback-${turn.round_key}`, temperature: 0.4, maxTokens: 1800 },
    );
    feedback = data;
  } catch (err) {
    const e = err as LlmError;
    console.warn(`[interview] 反馈降级 ${e.code}: ${e.message}`);
    feedback = localFeedback({ roundKey: turn.round_key, question: turn.question, answer });
    source = 'local';
  }

  // 用 STAR 覆盖、量化数据、个人贡献、篇幅等可观察证据校准模型分，避免不同质量的回答都落在 75 附近
  const signals = analyzeAnswer(turn.question, answer);
  feedback.scores = calibrateScores(signals, feedback.scores);
  const score = Math.round((feedback.scores.structure + feedback.scores.content + feedback.scores.expression) / 3);
  const answeredCount = db
    .prepare('SELECT COUNT(*) AS n FROM interview_turn WHERE interview_id = ? AND answer IS NOT NULL')
    .get(id) as { n: number };
  // 追问：最多 2 层，方向限定为项目细节 / 数据来源 / 个人贡献
  // 只有回答偏弱（低于阈值）时才追问，避免每道题都追问；并限制总题量
  const followable =
    turn.round_key === 'professional' || turn.round_key === 'behavioral' || turn.round_key === 'practice';
  const canFollow = followable && turn.depth < 2 && score < FOLLOWUP_THRESHOLD && answeredCount.n + 1 < 18;
  if (canFollow && !feedback.followup) {
    // 模型有时只评不追问；这里用规则补一个方向明确的追问，保证弱回答能稳定触发
    feedback.followup = buildFallbackFollowup({
      signals,
      scores: feedback.scores,
      depth: turn.depth,
    });
  }

  // source 同时承担「题目来源」语义：常见题答完后仍保留 common，避免前端丢失来源标注；
  // 其他题型沿用原有行为，记录反馈是模型还是本地降级。
  const sourceAfterAnswer = turn.source === 'common' ? 'common' : source;
  // DATA-06：用题目发出时间到提交时间的真实差值记录用时，避免前端计时被节流影响。
  const startedMs = turn.answer_started_at ? Date.parse(turn.answer_started_at) : NaN;
  const durationSec = Number.isFinite(startedMs)
    ? Math.max(0, Math.min(86_400, Math.round((Date.now() - startedMs) / 1000)))
    : null;
  const tags = deriveTags(feedback, score);
  // 原子占位：并发提交时只有一个请求能把 NULL 改成答案，避免重复生成下一题。
  const claimed = db
    .prepare(
      'UPDATE interview_turn SET answer = ?, feedback_json = ?, score = ?, source = ?, answered_at = ?, duration_sec = ?, tags_json = ? WHERE id = ? AND interview_id = ? AND answer IS NULL',
    )
    .run(
      answer,
      JSON.stringify(feedback),
      score,
      sourceAfterAnswer,
      nowIso(),
      durationSec,
      JSON.stringify(tags),
      turnId,
      id,
    );
  if (claimed.changes === 0) throw new HttpError(409, '这道题已经作答过了');

  // 用最新状态推进轮次，避免请求开始时读到的 question_index 过期。
  iv = getInterview(id);
  // 反馈生成期间用户可能已经点了「生成报告」；此时不要再补一道新题。
  if (iv.status !== 'active') {
    return { feedback, source, score, nextTurn: null, allDone: true, session: sessionPayload(id) };
  }
  let nextTurn: TurnRow | null = null;
  let allDone = false;
  if (canFollow && feedback.followup) {
    nextTurn = insertTurn(
      id,
      turn.round_key,
      nextSeq(id),
      turn.depth + 1,
      turnId,
      feedback.followup.question,
      feedback.followup.focus,
      source,
    );
  } else {
    const plan = planFor(iv);
    const idx = plan.findIndex((r) => r.key === iv.round_key);
    const round = plan[idx] || plan[0];
    const nextIndex = iv.question_index + 1;
    if (nextIndex < round.count) {
      const q = await makeQuestion(iv, round.key);
      if (getInterview(id).status !== 'active') {
        allDone = true;
      } else {
        nextTurn = insertTurn(id, round.key, nextSeq(id), 0, null, q.question, q.focus, q.source);
        db.prepare('UPDATE interview SET question_index = ? WHERE id = ?').run(nextIndex, id);
      }
    } else if (idx + 1 < plan.length) {
      const nr = plan[idx + 1];
      const q = await makeQuestion(iv, nr.key);
      if (getInterview(id).status !== 'active') {
        allDone = true;
      } else {
        db.prepare('UPDATE interview SET round_key = ?, question_index = 0 WHERE id = ?').run(nr.key, id);
        nextTurn = insertTurn(id, nr.key, nextSeq(id), 0, null, q.question, q.focus, q.source);
      }
    } else {
      allDone = true;
    }
  }

  return { feedback, source, score, nextTurn, allDone, session: sessionPayload(id) };
}

interviewRouter.post(
  '/interviews/:id/answer',
  ah(async (req, res) => {
    const id = idOf(req);
    const iv = getInterview(id);
    if (iv.status !== 'active') throw new HttpError(409, '这场面试已经结束');
    const turnId = Number(req.body?.turnId);
    const answer = str(req.body?.answer, 6000).trim();
    if (!turnId) throw new HttpError(400, '缺少题目 ID');
    if (answer.length < 2) throw new HttpError(400, '回答不能为空');
    const turn = db
      .prepare('SELECT * FROM interview_turn WHERE id = ? AND interview_id = ?')
      .get(turnId, id) as TurnRow | undefined;
    if (!turn) throw new HttpError(404, '题目不存在');
    if (turn.answer !== null) throw new HttpError(409, '这道题已经作答过了');
    if (hasPendingJob(id, 'finish')) throw new HttpError(409, '报告正在生成，暂时不能继续作答');

    const jobId = startInterviewJob(id, 'answer', () => runAnswerJob(id, turnId, answer));
    res.status(202).json({ jobId, status: 'pending' });
  }),
);

/** UX-07：换一题。只允许跳过未作答的题，每场最多 2 次。 */
async function runSkipJob(id: number, turnId: number) {
  let iv = getInterview(id);
  if (iv.status !== 'active') throw new HttpError(409, '这场面试已经结束');
  const turn = db
    .prepare('SELECT * FROM interview_turn WHERE id = ? AND interview_id = ?')
    .get(turnId, id) as TurnRow | undefined;
  if (!turn) throw new HttpError(404, '题目不存在');
  if (turn.answer !== null) throw new HttpError(409, '这道题已经作答过了');
  if (turn.skipped) throw new HttpError(409, '这道题已经跳过了');
  if (hasPendingJob(id, 'answer')) throw new HttpError(409, '正在生成上一题的反馈，稍后再换题');

  const skipped = db
    .prepare('SELECT COUNT(*) AS n FROM interview_turn WHERE interview_id = ? AND skipped = 1')
    .get(id) as { n: number };
  if (skipped.n >= 2) throw new HttpError(409, '每场面试最多跳过 2 题，请先作答或直接结束');

  const claimed = db
    .prepare('UPDATE interview_turn SET skipped = 1 WHERE id = ? AND interview_id = ? AND answer IS NULL AND skipped = 0')
    .run(turnId, id);
  if (claimed.changes === 0) throw new HttpError(409, '这道题状态已变化，请刷新后重试');

  iv = getInterview(id);
  let nextTurn: TurnRow | null = null;
  let allDone = false;
  const plan = planFor(iv);
  const idx = plan.findIndex((r) => r.key === iv.round_key);
  const round = plan[idx] || plan[0];
  const nextIndex = iv.question_index + 1;
  if (nextIndex < round.count) {
    const q = await makeQuestion(iv, round.key);
    if (getInterview(id).status !== 'active') {
      allDone = true;
    } else {
      nextTurn = insertTurn(id, round.key, nextSeq(id), 0, null, q.question, q.focus, q.source);
      db.prepare('UPDATE interview SET question_index = ? WHERE id = ?').run(nextIndex, id);
    }
  } else if (idx + 1 < plan.length) {
    const nr = plan[idx + 1];
    const q = await makeQuestion(iv, nr.key);
    if (getInterview(id).status !== 'active') {
      allDone = true;
    } else {
      db.prepare('UPDATE interview SET round_key = ?, question_index = 0 WHERE id = ?').run(nr.key, id);
      nextTurn = insertTurn(id, nr.key, nextSeq(id), 0, null, q.question, q.focus, q.source);
    }
  } else {
    allDone = true;
  }

  return { skippedTurnId: turnId, nextTurn, allDone, remainingSkips: Math.max(0, 1 - skipped.n), session: sessionPayload(id) };
}

interviewRouter.post(
  '/interviews/:id/turns/:turnId/skip',
  ah(async (req, res) => {
    const id = idOf(req);
    const turnId = Number(req.params.turnId);
    if (!Number.isInteger(turnId) || turnId <= 0) throw new HttpError(400, '题目 ID 不正确');
    const iv = getInterview(id);
    if (iv.status !== 'active') throw new HttpError(409, '这场面试已经结束');
    const turn = db
      .prepare('SELECT * FROM interview_turn WHERE id = ? AND interview_id = ?')
      .get(turnId, id) as TurnRow | undefined;
    if (!turn) throw new HttpError(404, '题目不存在');
    if (turn.answer !== null) throw new HttpError(409, '这道题已经作答过了');
    const skipped = db
      .prepare('SELECT COUNT(*) AS n FROM interview_turn WHERE interview_id = ? AND skipped = 1')
      .get(id) as { n: number };
    if (skipped.n >= 2) throw new HttpError(409, '每场面试最多跳过 2 题');

    const jobId = startInterviewJob(id, 'skip', () => runSkipJob(id, turnId));
    res.status(202).json({ jobId, status: 'pending' });
  }),
);

interviewRouter.get('/interviews/:id/jobs/:jobId', (req, res) => {
  const id = idOf(req);
  const job = getAiJob(String(req.params.jobId));
  const payload = (job?.payload ?? {}) as { interviewId?: number };
  if (!job || !job.kind.startsWith(`interview:${id}:`) || payload.interviewId !== id) {
    throw new HttpError(404, '任务不存在或已过期，请重新提交');
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

function localReport(turns: TurnRow[]): ReportResult {
  const byRound = new Map<string, number[]>();
  for (const t of turns) {
    if (t.score === null) continue;
    const name = roundByKey(t.round_key).name;
    const arr = byRound.get(name) || [];
    arr.push(t.score);
    byRound.set(name, arr);
  }
  const roundScores = [...byRound.entries()].map(([round, arr]) => ({
    round,
    score: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    comment: '本地规则评分（模型不可用），按结构/内容/表达三维平均值计算。',
  }));
  const all = turns.filter((t) => t.score !== null).map((t) => t.score as number);
  const overallScore = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : 0;
  const weaknesses: string[] = [];
  const reviewPoints: string[] = [];
  for (const t of turns) {
    const fb = parseJson<FeedbackResult | null>(t.feedback_json, null);
    if ((t.score ?? 100) < 70 && fb?.issues?.length) weaknesses.push(fb.issues[0]);
  }
  if (!weaknesses.length) weaknesses.push('未发现明显失分项，继续保持用数据支撑结论的习惯。');
  for (const w of weaknesses.slice(0, 3)) reviewPoints.push(`针对「${w}」准备一版新的回答。`);
  reviewPoints.push('把本次题目与答案写入复盘，7 天后从题库再练一次。');
  return {
    overallScore,
    roundScores,
    weaknesses: [...new Set(weaknesses)].slice(0, 4),
    reviewPoints: [...new Set(reviewPoints)].slice(0, 5),
    summary: `本地汇总：共作答 ${all.length} 次，平均分 ${overallScore}。模型不可用时仅做规则汇总，建议稍后重跑以获得深度点评。`,
  };
}

async function runFinishJob(id: number) {
  const iv = getInterview(id);
  if (iv.status === 'finished' && iv.report_json) {
    return { report: parseJson<ReportResult | null>(iv.report_json, null), source: 'llm', session: sessionPayload(id) };
  }
  if (iv.status !== 'active') throw new HttpError(409, '这场面试状态已变化，请刷新后重试');

  const turns = turnsOf(id).filter((t) => t.answer !== null);
  if (!turns.length) throw new HttpError(400, '还没有任何作答，无法生成报告');

  let report: ReportResult;
  let source: 'llm' | 'local' = 'llm';
  try {
    const { data } = await chatJSON(
      reportSchema,
      reportPrompt({
        jobTitle: jobTitleOf(iv.job_id),
        turns: turns.map((t) => ({
          round: roundByKey(t.round_key).name,
          question: t.question,
          answer: t.answer || '',
          score: t.score,
          depth: t.depth,
        })),
      }),
      { tag: 'report', temperature: 0.4, maxTokens: 1800 },
    );
    report = data;
  } catch (err) {
    const e = err as LlmError;
    console.warn(`[interview] 报告降级 ${e.code}: ${e.message}`);
    report = localReport(turns);
    source = 'local';
  }

  db.exec('BEGIN');
  try {
    // 原子收口：并发生成报告时，只有一个请求能把 active 改成 finished。
    const claimed = db
      .prepare(
        'UPDATE interview SET status = ?, ended_at = ?, report_json = ?, overall_score = ? WHERE id = ? AND status = ?',
      )
      .run('finished', nowIso(), JSON.stringify(report), Math.round(report.overallScore), id, 'active');
    if (claimed.changes === 0) {
      db.exec('ROLLBACK');
      const latest = getInterview(id);
      if (latest.status === 'finished' && latest.report_json) {
        return {
          report: parseJson<ReportResult | null>(latest.report_json, null),
          source: 'llm',
          session: sessionPayload(id),
        };
      }
      throw new HttpError(409, '这场面试状态已变化，请刷新后重试');
    }

    // 沉淀到个人题库：题目去重，记录最近一次得分与薄弱标记
    const seedRows = iv.mode === 'bank' ? parseJson<string[]>(iv.seed_json, []) : [];
    for (const t of turns) {
      const category = roundByKey(t.round_key).name;
      const existing = db.prepare('SELECT id, ask_count FROM bank_item WHERE question = ?').get(t.question) as
        | { id: number; ask_count: number }
        | undefined;
      const weak = (t.score ?? 0) < 70 ? 1 : 0;
      if (existing) {
        db.prepare(
          'UPDATE bank_item SET ask_count = ?, last_score = ?, last_practiced_at = ?, weak = MAX(weak, ?) WHERE id = ?',
        ).run(existing.ask_count + 1, t.score, nowIso(), weak, existing.id);
      } else {
        db.prepare(
          'INSERT INTO bank_item (question, category, job_id, source, weak, ask_count, last_score, last_practiced_at, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        ).run(t.question, category, iv.job_id, 'interview', weak, t.score, nowIso(), nowIso());
      }
    }
    if (iv.mode === 'bank') {
      for (const q of seedRows) {
        db.prepare('UPDATE bank_item SET last_practiced_at = ? WHERE question = ?').run(nowIso(), q);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 事务可能已经回滚 */
    }
    throw err;
  }

  return { report, source, session: sessionPayload(id) };
}

interviewRouter.post(
  '/interviews/:id/finish',
  ah(async (req, res) => {
    const id = idOf(req);
    const iv = getInterview(id);
    if (iv.status === 'finished' && iv.report_json) {
      res.json({ report: parseJson<ReportResult | null>(iv.report_json, null), session: sessionPayload(id) });
      return;
    }
    if (iv.status !== 'active') throw new HttpError(409, '这场面试状态已变化，请刷新后重试');
    const turns = turnsOf(id).filter((t) => t.answer !== null);
    if (!turns.length) throw new HttpError(400, '还没有任何作答，无法生成报告');
    if (hasPendingJob(id, 'answer')) throw new HttpError(409, '还有题目正在提交，请稍后再生成报告');

    const jobId = startInterviewJob(id, 'finish', () => runFinishJob(id));
    res.status(202).json({ jobId, status: 'pending' });
  }),
);

interviewRouter.delete('/interviews/:id', (req, res) => {
  const id = idOf(req);
  db.prepare("DELETE FROM application_link WHERE kind = 'interview' AND ref_id = ?").run(id);
  db.prepare('DELETE FROM interview_turn WHERE interview_id = ?').run(id);
  db.prepare('DELETE FROM interview WHERE id = ?').run(id);
  res.json({ ok: true });
});
