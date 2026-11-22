import { Router } from 'express';
import { db, nowIso, parseJson } from '../db.js';
import { HttpError, idOf } from '../util.js';

/**
 * MOD-03：7 天训练计划。
 *
 * 设计约束（与 P0/P1/P2 一致）：
 * - 不引入服务端定时任务，计划在「报告生成后」或「打开计划页」时按需生成；
 * - 复用 DATA-08 的 training_task 表，任务按天落库，完成状态可追踪；
 * - 单实例、进程内运行，不做跨实例调度。
 *
 * 生成口径：最近一份已完成报告的 weaknesses / reviewPoints、今日到期的复习任务、
 * 近 7 天需要跟进的投递。若没有任何数据，则给出一条从 0 到 1 的起步任务链。
 */

export const planRouter = Router();

const PLAN_KIND_PREFIX = 'plan:';
const DAYS = 7;
const MAX_PER_DAY = 3;

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('sv-SE');
}

function addDays(date: string, offset: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + offset);
  return dt.toLocaleDateString('sv-SE');
}

interface Candidate {
  kind: string;
  refId: number | null;
  title: string;
  date?: string;
}

interface TaskRow {
  id: number;
  plan_date: string;
  kind: string;
  ref_id: number | null;
  title: string;
  status: string;
  done_at: string | null;
  created_at: string;
}

function latestReport(): { interviewId: number; weaknesses: string[]; reviewPoints: string[] } | null {
  const row = db
    .prepare(
      `SELECT id, report_json FROM interview
       WHERE status = 'finished' AND report_json IS NOT NULL
       ORDER BY COALESCE(ended_at, started_at) DESC, id DESC LIMIT 1`,
    )
    .get() as { id: number; report_json: string } | undefined;
  if (!row) return null;
  const report = parseJson<{ weaknesses?: string[]; reviewPoints?: string[] }>(row.report_json, {});
  return {
    interviewId: row.id,
    weaknesses: (report.weaknesses || []).filter((s) => !!s).slice(0, 4),
    reviewPoints: (report.reviewPoints || []).filter((s) => !!s).slice(0, 4),
  };
}

function dueReviewCandidates(from: string, to: string): Candidate[] {
  const tasks = db
    .prepare(
      `SELECT kind, ref_id, due_at FROM review_task
       WHERE due_at <= ? AND due_at >= ? ORDER BY due_at ASC LIMIT 4`,
    )
    .all(to, from) as { kind: string; ref_id: number; due_at: string }[];
  const out: Candidate[] = [];
  for (const t of tasks) {
    if (t.kind === 'bank') {
      const row = db.prepare('SELECT question FROM bank_item WHERE id = ?').get(t.ref_id) as
        | { question: string }
        | undefined;
      if (row) out.push({ kind: 'review', refId: t.ref_id, title: `复习题库：${row.question.slice(0, 80)}` });
    } else {
      const row = db.prepare('SELECT question FROM review WHERE id = ?').get(t.ref_id) as
        | { question: string }
        | undefined;
      if (row) out.push({ kind: 'review', refId: t.ref_id, title: `回看复盘：${row.question.slice(0, 80)}` });
    }
  }
  return out;
}

function followUpCandidates(from: string, to: string): Candidate[] {
  const rows = db
    .prepare(
      `SELECT id, company, title, next_action_at FROM application
       WHERE next_action_at IS NOT NULL AND next_action_at >= ? AND next_action_at <= ?
         AND stage NOT IN ('offer', 'rejected', 'withdrawn')
       ORDER BY next_action_at ASC, id ASC LIMIT 5`,
    )
    .all(from, to) as { id: number; company: string; title: string; next_action_at: string }[];
  return rows.map((r) => ({
    kind: 'followup',
    refId: r.id,
    title: `跟进投递：${r.company} · ${r.title}`,
    date: r.next_action_at,
  }));
}

const STARTERS: { kind: string; title: string }[] = [
  { kind: 'starter', title: '完善一份简历并保存（没有简历时先做这一步）' },
  { kind: 'starter', title: '新建一个目标岗位，粘贴 JD 并做匹配诊断' },
  { kind: 'starter', title: '跑一场 20 分钟的模拟面试' },
  { kind: 'starter', title: '把面试里答得不好的题加入个人题库' },
  { kind: 'starter', title: '写一条复盘，补上改进点' },
  { kind: 'starter', title: '把最近一次真实投递记进投递追踪' },
  { kind: 'starter', title: '查看成长曲线，挑一项薄弱维度再练' },
];

function buildCandidates(from: string, to: string): Candidate[] {
  const list: Candidate[] = [];
  const report = latestReport();
  if (report) {
    for (const w of report.weaknesses) {
      list.push({ kind: 'weakness', refId: report.interviewId, title: `针对性练习：${w.slice(0, 120)}` });
    }
    for (const r of report.reviewPoints) {
      list.push({ kind: 'review_point', refId: report.interviewId, title: `按报告复习：${r.slice(0, 120)}` });
    }
  }
  list.push(...dueReviewCandidates(from, to));
  list.push(...followUpCandidates(from, to));
  return list;
}

/**
 * 生成 7 天计划。
 *
 * - 默认只在「今天还没有计划任务」时生成，避免反复刷新页面不断追加；
 * - refresh=true 用于报告生成后，允许补入新报告带来的任务，但仍按天去重并限制每天 3 条。
 */
export function ensurePlan(opts: { refresh?: boolean } = {}): { created: number } {
  const today = localDate(0);
  const to = addDays(today, DAYS - 1);
  if (!opts.refresh) {
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM training_task WHERE plan_date >= ? AND plan_date <= ? AND kind LIKE 'plan:%' AND plan_date = ?")
      .get(today, to, today) as { n: number };
    if (n.n > 0) return { created: 0 };
  }

  const existing = db
    .prepare(
      `SELECT id, plan_date, kind, ref_id, title, status, done_at, created_at FROM training_task
       WHERE plan_date >= ? AND plan_date <= ? AND kind LIKE 'plan:%'`,
    )
    .all(today, to) as TaskRow[];
  const seen = new Set(existing.map((t) => `${t.plan_date}|${t.title}`));
  const perDay = new Map<string, number>();
  for (const t of existing) perDay.set(t.plan_date, (perDay.get(t.plan_date) || 0) + 1);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const candidates = buildCandidates(today, to);
  const insert = db.prepare(
    'INSERT INTO training_task (plan_date, kind, ref_id, title, status, done_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
  );
  let created = 0;

  const put = (date: string, kind: string, refId: number | null, title: string) => {
    const key = `${date}|${title}`;
    if (seen.has(key)) return false;
    if ((perDay.get(date) || 0) >= MAX_PER_DAY) return false;
    insert.run(date, `${PLAN_KIND_PREFIX}${kind}`, refId, title, 'todo', nowIso());
    seen.add(key);
    perDay.set(date, (perDay.get(date) || 0) + 1);
    created += 1;
    return true;
  };

  // 跟进类任务优先落在它自己的日期；超出范围的落到今天。
  const others: Candidate[] = [];
  for (const c of candidates) {
    if (c.kind === 'followup') {
      const date = c.date && c.date >= today && c.date <= to ? c.date : today;
      if (!put(date, c.kind, c.refId, c.title)) others.push(c);
    } else {
      others.push(c);
    }
  }

  // 其余任务按天轮转填充，每天最多 3 条。
  let slot = 0;
  for (const c of others) {
    let placed = false;
    for (let attempt = 0; attempt < DAYS; attempt += 1) {
      const date = days[(slot + attempt) % DAYS];
      if (put(date, c.kind, c.refId, c.title)) {
        slot = (slot + attempt + 1) % DAYS;
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }

  // 每天至少一条可执行任务：没有数据时给起步任务，有数据但某天仍为空时给一条通用训练。
  if (candidates.length === 0) {
    days.forEach((date, i) => {
      if ((perDay.get(date) || 0) === 0) {
        const s = STARTERS[i % STARTERS.length];
        put(date, s.kind, null, s.title);
      }
    });
  } else {
    const generic = [
      '用 15 分钟复述一场面试里最没答好的一题',
      '挑一道薄弱题写 150 字答案并对照反馈修改',
      '回看最近一场面试报告，补齐一条可量化结果',
      '把今天练过的题标记掌握程度，更新复习排程',
      '看一遍目标岗位 JD，补一个缺失关键词的真实经历',
      '用 STAR 重写一段项目经历，控制在 200 字内',
      '安排一次 30 分钟模拟面试，重点练追问',
    ];
    days.forEach((date, i) => {
      if ((perDay.get(date) || 0) === 0) put(date, 'practice', null, generic[i % generic.length]);
    });
  }

  return { created };
}

function tasksInWindow(from: string, to: string): TaskRow[] {
  return db
    .prepare(
      `SELECT id, plan_date, kind, ref_id, title, status, done_at, created_at FROM training_task
       WHERE plan_date >= ? AND plan_date <= ? ORDER BY plan_date ASC, id ASC`,
    )
    .all(from, to) as TaskRow[];
}

planRouter.get('/plan/today', (_req, res) => {
  const result = ensurePlan();
  const today = localDate(0);
  const to = addDays(today, DAYS - 1);
  const rows = tasksInWindow(today, to);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const date = addDays(today, i);
    const tasks = rows.filter((t) => t.plan_date === date);
    return {
      date,
      isToday: date === today,
      total: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
      tasks,
    };
  });
  res.json({
    today,
    from: today,
    to,
    created: result.created,
    total: rows.length,
    done: rows.filter((t) => t.status === 'done').length,
    days,
  });
});

planRouter.post('/plan/:id/complete', (req, res) => {
  const id = idOf(req);
  const row = db.prepare('SELECT id, status FROM training_task WHERE id = ?').get(id) as
    | { id: number; status: string }
    | undefined;
  if (!row) throw new HttpError(404, '计划任务不存在');
  const done = row.status !== 'done';
  db.prepare('UPDATE training_task SET status = ?, done_at = ? WHERE id = ?').run(
    done ? 'done' : 'todo',
    done ? nowIso() : null,
    id,
  );
  res.json({ task: db.prepare('SELECT * FROM training_task WHERE id = ?').get(id) });
});
