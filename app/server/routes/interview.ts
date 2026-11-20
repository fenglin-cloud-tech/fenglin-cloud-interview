import { Router } from 'express';
import { db, nowIso, parseJson } from '../db.js';
import { chatJSON, LlmError } from '../llm.js';
import { localFeedback, localQuestion } from '../fallback.js';
import { feedbackSchema, questionSchema, reportSchema } from '../schemas.js';
import type { FeedbackResult, ReportResult } from '../schemas.js';
import { FOLLOWUP_FOCUS_LABEL, ROUNDS, TOTAL_BASE_QUESTIONS, roundByKey } from '../interview-plan.js';
import { feedbackPrompt, questionPrompt, reportPrompt } from '../prompts.js';
import { HttpError, ah, idOf, str } from '../util.js';

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

function planFor(iv: InterviewRow): PlanRound[] {
  if (iv.mode === 'bank') {
    const seeds = parseJson<string[]>(iv.seed_json, []);
    return [
      {
        key: 'practice',
        name: '题库再练',
        numeral: '练',
        desc: '从你的个人题库里抽题，逐题作答并给反馈',
        count: Math.max(1, seeds.length),
      },
    ];
  }
  return ROUNDS.map((r) => ({ key: r.key, name: r.name, numeral: r.numeral, desc: r.desc, count: r.count }));
}

function totalBase(iv: InterviewRow): number {
  return iv.mode === 'bank' ? Math.max(1, parseJson<string[]>(iv.seed_json, []).length) : TOTAL_BASE_QUESTIONS;
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
): Promise<{ question: string; focus: string; source: 'llm' | 'local' | 'builtin' }> {
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
  try {
    const { data, meta } = await chatJSON(
      questionSchema,
      questionPrompt({ roundKey, resumeText, jobTitle, jd, asked, seedQuestion }),
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
  const info = db
    .prepare(
      'INSERT INTO interview_turn (interview_id, round_key, seq, depth, parent_id, question, focus, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(interviewId, roundKey, seq, depth, parentId, question, focus, source, nowIso());
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
      focusLabel: FOLLOWUP_FOCUS_LABEL[t.focus] || t.focus,
    })),
    progress: {
      answeredBase,
      total,
      answeredAll,
      percent: total ? Math.min(100, Math.round((answeredBase / total) * 100)) : 0,
    },
    pendingTurn: turns.find((t) => t.answer === null) || null,
  };
}

interviewRouter.get('/interviews', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, j.title AS job_title, r.title AS resume_title,
        (SELECT COUNT(*) FROM interview_turn t WHERE t.interview_id = i.id AND t.answer IS NOT NULL) AS answered
       FROM interview i
       LEFT JOIN job j ON j.id = i.job_id
       LEFT JOIN resume r ON r.id = i.resume_id
       ORDER BY i.id DESC LIMIT 50`,
    )
    .all();
  res.json({ interviews: rows });
});

interviewRouter.get('/interviews/:id', (req, res) => {
  res.json(sessionPayload(idOf(req)));
});

interviewRouter.post(
  '/interviews',
  ah(async (req, res) => {
    const body = req.body ?? {};
    const mode = body.mode === 'bank' ? 'bank' : 'resume';
    const resumeId = body.resumeId ? Number(body.resumeId) : null;
    const jobId = body.jobId ? Number(body.jobId) : null;
    let seeds: string[] = [];

    if (mode === 'bank') {
      const ids: number[] = Array.isArray(body.bankIds) ? body.bankIds.map(Number).filter((n: number) => n > 0) : [];
      if (!ids.length) throw new HttpError(400, '请至少选择 1 道题库题目');
      const rows = ids
        .map((id) => db.prepare('SELECT question FROM bank_item WHERE id = ?').get(id) as { question: string } | undefined)
        .filter(Boolean) as { question: string }[];
      if (!rows.length) throw new HttpError(400, '选中的题目已不存在');
      seeds = rows.map((r) => r.question);
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
    const info = db
      .prepare(
        'INSERT INTO interview (resume_id, job_id, mode, status, round_key, question_index, seed_json, started_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      )
      .run(resumeId, jobId, mode, 'active', firstRound, JSON.stringify(seeds), now);
    const id = Number(info.lastInsertRowid);

    const q = await makeQuestion(getInterview(id), firstRound, mode === 'bank' ? seeds[0] : undefined);
    insertTurn(id, firstRound, 1, 0, null, q.question, q.focus, q.source);
    res.status(201).json(sessionPayload(id));
  }),
);

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

    const score = Math.round((feedback.scores.structure + feedback.scores.content + feedback.scores.expression) / 3);
    db.prepare(
      'UPDATE interview_turn SET answer = ?, feedback_json = ?, score = ?, source = ?, answered_at = ? WHERE id = ?',
    ).run(answer, JSON.stringify(feedback), score, source, nowIso(), turnId);

    // 追问：最多 2 层，方向限定为项目细节 / 数据来源 / 个人贡献
    // 只有回答偏弱时才追问（避免每道题都追问导致一场 20 题以上），并限制总题量
    let nextTurn: TurnRow | null = null;
    let allDone = false;
    const answeredCount = db
      .prepare('SELECT COUNT(*) AS n FROM interview_turn WHERE interview_id = ? AND answer IS NOT NULL')
      .get(id) as { n: number };
    const canFollow =
      (turn.round_key === 'professional' || turn.round_key === 'behavioral' || turn.round_key === 'practice') &&
      turn.depth < 2 &&
      !!feedback.followup &&
      (turn.depth === 0 ? score < 72 : score < 70) &&
      answeredCount.n < 18;
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
        nextTurn = insertTurn(id, round.key, nextSeq(id), 0, null, q.question, q.focus, q.source);
        db.prepare('UPDATE interview SET question_index = ? WHERE id = ?').run(nextIndex, id);
      } else if (idx + 1 < plan.length) {
        const nr = plan[idx + 1];
        db.prepare('UPDATE interview SET round_key = ?, question_index = 0 WHERE id = ?').run(nr.key, id);
        const q = await makeQuestion(iv, nr.key);
        nextTurn = insertTurn(id, nr.key, nextSeq(id), 0, null, q.question, q.focus, q.source);
      } else {
        allDone = true;
      }
    }

    res.json({ feedback, source, score, nextTurn, allDone, session: sessionPayload(id) });
  }),
);

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

interviewRouter.post(
  '/interviews/:id/finish',
  ah(async (req, res) => {
    const id = idOf(req);
    const iv = getInterview(id);
    if (iv.status === 'finished' && iv.report_json) {
      res.json({ report: parseJson<ReportResult | null>(iv.report_json, null), session: sessionPayload(id) });
      return;
    }
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

    db.prepare('UPDATE interview SET status = ?, ended_at = ?, report_json = ?, overall_score = ? WHERE id = ?').run(
      'finished',
      nowIso(),
      JSON.stringify(report),
      Math.round(report.overallScore),
      id,
    );

    // 沉淀到个人题库：题目去重，记录最近一次得分与薄弱标记
    const seedRows = iv.seed_json ? (JSON.parse(iv.seed_json) as string[]) : [];
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

    res.json({ report, source, session: sessionPayload(id) });
  }),
);

interviewRouter.delete('/interviews/:id', (req, res) => {
  const id = idOf(req);
  db.prepare('DELETE FROM interview_turn WHERE interview_id = ?').run(id);
  db.prepare('DELETE FROM interview WHERE id = ?').run(id);
  res.json({ ok: true });
});
