import { Router } from 'express';
import { db, parseJson } from '../db.js';
import { HttpError } from '../util.js';

/**
 * MOD-10：周报洞察。
 *
 * 只聚合既有表（interview / application / application_stage_log / review /
 * bank_item / training_task），不新增表、不做定时任务；由前端按范围请求。
 */
export const reportsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmt(d: Date): string {
  return d.toLocaleDateString('sv-SE');
}

function parseDate(value: unknown): string {
  const s = String(value || '').trim();
  if (!DATE_RE.test(s)) throw new HttpError(400, '日期格式应为 YYYY-MM-DD');
  return s;
}

function defaultFrom(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 周一为一周开始
  d.setDate(d.getDate() - day);
  return fmt(d);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return fmt(new Date(y, m - 1, d + n));
}

interface ReportJson {
  weaknesses?: string[];
}

const STAGE_LABEL: Record<string, string> = {
  applied: '已投递',
  written: '笔试',
  interview1: '一面',
  interview2: '二面',
  hr: 'HR 面',
  offer: '已发 offer',
  rejected: '已拒',
  withdrawn: '自己放弃',
};

reportsRouter.get('/reports/weekly', (req, res) => {
  const from = req.query.from ? parseDate(req.query.from) : defaultFrom();
  const to = req.query.to ? parseDate(req.query.to) : fmt(new Date());
  if (from > to) throw new HttpError(400, '开始日期不能晚于结束日期');

  const days = Math.max(1, Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000) + 1);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));

  const interviews = db
    .prepare(
      `SELECT i.id, i.status, i.started_at, i.ended_at, i.overall_score, i.report_json, j.title AS job_title
       FROM interview i LEFT JOIN job j ON j.id = i.job_id
       WHERE substr(i.started_at, 1, 10) BETWEEN ? AND ?
       ORDER BY i.started_at ASC`,
    )
    .all(from, to) as {
    id: number;
    status: string;
    started_at: string;
    ended_at: string | null;
    overall_score: number | null;
    report_json: string | null;
    job_title: string | null;
  }[];

  const finished = interviews.filter((i) => i.status === 'finished' && i.overall_score != null);
  const avgScore = finished.length
    ? Math.round(finished.reduce((s, i) => s + (i.overall_score || 0), 0) / finished.length)
    : null;

  const prev = db
    .prepare(
      `SELECT AVG(overall_score) AS avg FROM interview
       WHERE status = 'finished' AND overall_score IS NOT NULL
         AND substr(started_at, 1, 10) BETWEEN ? AND ?`,
    )
    .get(prevFrom, prevTo) as { avg: number | null };
  const prevAvg = prev.avg != null ? Math.round(prev.avg) : null;
  const delta = avgScore != null && prevAvg != null ? avgScore - prevAvg : null;

  const weaknessCount = new Map<string, number>();
  for (const i of interviews) {
    const report = parseJson<ReportJson | null>(i.report_json, null);
    for (const w of report?.weaknesses || []) {
      const text = String(w || '').trim();
      if (text) weaknessCount.set(text, (weaknessCount.get(text) || 0) + 1);
    }
  }
  const topWeaknesses = [...weaknessCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  const newApplications = db
    .prepare('SELECT COUNT(*) AS n FROM application WHERE applied_on BETWEEN ? AND ?')
    .get(from, to) as { n: number };

  const stageChanges = db
    .prepare(
      `SELECT l.changed_at, l.from_stage, l.to_stage, a.company, a.title
       FROM application_stage_log l JOIN application a ON a.id = l.application_id
       WHERE substr(l.changed_at, 1, 10) BETWEEN ? AND ?
       ORDER BY l.changed_at ASC`,
    )
    .all(from, to) as {
    changed_at: string;
    from_stage: string | null;
    to_stage: string;
    company: string;
    title: string;
  }[];

  const reviews = db
    .prepare('SELECT COUNT(*) AS n FROM review WHERE substr(created_at, 1, 10) BETWEEN ? AND ?')
    .get(from, to) as { n: number };
  const bankAdded = db
    .prepare('SELECT COUNT(*) AS n FROM bank_item WHERE substr(created_at, 1, 10) BETWEEN ? AND ?')
    .get(from, to) as { n: number };
  const plan = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM training_task WHERE plan_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { total: number; done: number | null };

  const metrics = {
    interviews: {
      started: interviews.length,
      finished: finished.length,
      avgScore,
      prevAvg,
      delta,
      items: interviews.map((i) => ({
        id: i.id,
        status: i.status,
        jobTitle: i.job_title,
        startedAt: i.started_at,
        score: i.overall_score,
      })),
    },
    applications: {
      newCount: newApplications.n,
      stageChanges: stageChanges.map((l) => ({
        changedAt: l.changed_at,
        fromStage: l.from_stage,
        toStage: l.to_stage,
        company: l.company,
        title: l.title,
      })),
    },
    reviews: { count: reviews.n },
    bank: { added: bankAdded.n },
    plan: { total: plan.total, done: plan.done || 0 },
  };

  const lines = [
    `# 本周求职周报（${from} ~ ${to}）`,
    '',
    `## 一句话总结`,
    `本周开始 ${metrics.interviews.started} 场面试、完成 ${metrics.interviews.finished} 场${
      avgScore != null ? `，平均 ${avgScore} 分${delta != null ? `（较上一周期 ${delta >= 0 ? '+' : ''}${delta}）` : ''}` : ''
    }；新增投递 ${metrics.applications.newCount} 条，阶段推进 ${stageChanges.length} 次，复盘 ${reviews.n} 条，题库新增 ${bankAdded.n} 道。`,
    '',
    '## 面试表现',
  ];
  if (!interviews.length) {
    lines.push('- 本周还没有面试记录。');
  } else {
    for (const i of interviews) {
      lines.push(
        `- ${i.job_title || '未关联岗位'} · ${i.started_at.slice(0, 10)} · ${
          i.status === 'finished' ? `${i.overall_score ?? '—'} 分` : '进行中'
        }`,
      );
    }
  }
  lines.push('', '## 本周薄弱项 TOP');
  if (!topWeaknesses.length) lines.push('- 暂无报告薄弱项，完成一场面试报告后可自动汇总。');
  else for (const w of topWeaknesses) lines.push(`- ${w.text}${w.count > 1 ? `（出现 ${w.count} 次）` : ''}`);

  lines.push('', '## 投递与阶段');
  lines.push(`- 新增投递：${metrics.applications.newCount} 条`);
  if (!stageChanges.length) lines.push('- 本周没有阶段变化。');
  else for (const l of stageChanges) lines.push(`- ${l.changed_at.slice(0, 10)} ${l.company} · ${l.title}：${l.from_stage ? STAGE_LABEL[l.from_stage] || l.from_stage : '创建'} → ${STAGE_LABEL[l.to_stage] || l.to_stage}`);

  lines.push(
    '',
    '## 复盘与题库',
    `- 新增复盘：${reviews.n} 条`,
    `- 题库新增：${bankAdded.n} 道`,
    `- 7 天计划完成：${metrics.plan.done}/${metrics.plan.total}`,
    '',
    '## 下周建议',
  );
  if (topWeaknesses.length) {
    for (const w of topWeaknesses.slice(0, 3)) lines.push(`- 针对「${w.text}」准备一版新的回答，并用 STAR 复述。`);
  } else {
    lines.push('- 先完成一场模拟面试，拿到具体薄弱项后再安排针对性练习。');
  }
  if (metrics.applications.stageChanges.length === 0) lines.push('- 给在投岗位设置下次跟进日期，避免投出去就断线。');
  lines.push('- 把本周练过的题在题库里标记掌握程度，进入下一轮复习排程。');

  res.json({ from, to, metrics, markdown: lines.join('\n') });
});
