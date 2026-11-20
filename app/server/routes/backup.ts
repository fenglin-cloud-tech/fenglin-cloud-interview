import { db, nowIso } from '../db.js';
import { HttpError, ah } from '../util.js';
import { Router } from 'express';

/**
 * 数据备份导出与导入。
 *
 * 设计要点：
 * - 导出为单个 JSON 文件，只读本机 SQLite，不发任何外部请求。
 * - 导入分两步：preview 只校验、不写库；commit 重新校验后，在单个 SQLite 事务里写入。
 * - 结构、版本、字段类型、JSON 子字段、ID 重复、引用缺失都在写库前检查；
 *   任何一步失败都 ROLLBACK，不会留下半套数据。
 * - 合并时对 ID 做重映射；题库按归一化题面去重；覆盖时先清空业务表再按原 ID 写入。
 */

export const BACKUP_ROUTER = Router();

const BACKUP_APP = 'fenglin-cloud-interview';
const BACKUP_VERSION = 1;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const LIMITS = {
  jobs: 2000,
  resumes: 1000,
  jdAnalyses: 5000,
  interviews: 2000,
  turns: 20000,
  reviews: 5000,
  bankItems: 5000,
  reviewTasks: 20000,
  applications: 3000,
  applicationLinks: 10000,
};

type Obj = Record<string, unknown>;

interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  profile: Obj | null;
  data: {
    jobs: Obj[];
    resumes: Obj[];
    jdAnalyses: Obj[];
    interviews: Obj[];
    turns: Obj[];
    reviews: Obj[];
    bankItems: Obj[];
    reviewTasks: Obj[];
    applications: Obj[];
    applicationLinks: Obj[];
  };
}

interface Validated {
  file: BackupFile;
  warnings: string[];
}

function bad(message: string, code = 'BAD_BACKUP'): HttpError {
  return new HttpError(422, message, code);
}

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function str(v: unknown, max: number, label: string, required = false): string {
  if (v === null || v === undefined) {
    if (required) throw bad(`${label} 缺失`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${label} 类型不正确`);
  if (v.length > max) throw bad(`${label} 超过长度上限`);
  return v;
}
function nullableStr(v: unknown, max: number, label: string): string | null {
  if (v === null || v === undefined) return null;
  return str(v, max, label);
}
function int(v: unknown, label: string, opts: { min?: number; max?: number; nullable?: boolean } = {}): number | null {
  if (v === null || v === undefined) {
    if (opts.nullable) return null;
    throw bad(`${label} 缺失`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) throw bad(`${label} 不是整数`);
  if (opts.min !== undefined && v < opts.min) throw bad(`${label} 小于允许值`);
  if (opts.max !== undefined && v > opts.max) throw bad(`${label} 超过允许值`);
  return v;
}
function jsonStr(v: unknown, max: number, label: string): string | null {
  if (v === null || v === undefined) return null;
  const s = str(v, max, label);
  try {
    JSON.parse(s);
  } catch {
    throw bad(`${label} 不是合法 JSON`);
  }
  return s;
}
function isoish(v: unknown, label: string, fallbackNow = false): string {
  const s = nullableStr(v, 40, label);
  return s || (fallbackNow ? nowIso() : '');
}
function arr(data: Obj, key: keyof BackupFile['data']): Obj[] {
  const v = data[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`备份中的 ${key} 不是数组`);
  if (v.length > LIMITS[key]) throw bad(`${key} 条目过多（上限 ${LIMITS[key]}），已拒绝导入`);
  return v.map((row, i) => {
    if (!isObj(row)) throw bad(`${key} 第 ${i + 1} 条不是对象`);
    return row;
  });
}
function checkDupIds(rows: { id: number }[], label: string): void {
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.id)) throw bad(`${label} 存在重复 ID（${r.id}），文件可能已损坏`);
    seen.add(r.id);
  }
}

function parseRows(file: BackupFile) {
  const d = file.data;
  const jobs = arr(d, 'jobs').map((r, i) => ({
    id: int(r.id, `jobs[${i}].id`, { min: 1 })!,
    title: str(r.title, 200, `jobs[${i}].title`, true),
    company: str(r.company, 200, `jobs[${i}].company`),
    jd: str(r.jd, 200_000, `jobs[${i}].jd`),
    created_at: isoish(r.created_at, `jobs[${i}].created_at`, true),
    updated_at: isoish(r.updated_at, `jobs[${i}].updated_at`, true),
  }));
  const resumes = arr(d, 'resumes').map((r, i) => ({
    id: int(r.id, `resumes[${i}].id`, { min: 1 })!,
    title: str(r.title, 200, `resumes[${i}].title`, true),
    content: str(r.content, 200_000, `resumes[${i}].content`),
    job_id: int(r.job_id, `resumes[${i}].job_id`, { min: 1, nullable: true }),
    source: str(r.source, 40, `resumes[${i}].source`) || 'manual',
    created_at: isoish(r.created_at, `resumes[${i}].created_at`, true),
    updated_at: isoish(r.updated_at, `resumes[${i}].updated_at`, true),
  }));
  const jdAnalyses = arr(d, 'jdAnalyses').map((r, i) => ({
    id: int(r.id, `jdAnalyses[${i}].id`, { min: 1 })!,
    resume_id: int(r.resume_id, `jdAnalyses[${i}].resume_id`, { min: 1, nullable: true }),
    job_id: int(r.job_id, `jdAnalyses[${i}].job_id`, { min: 1, nullable: true }),
    jd: str(r.jd, 200_000, `jdAnalyses[${i}].jd`),
    score: int(r.score, `jdAnalyses[${i}].score`, { min: 0, max: 100, nullable: true }) ?? 0,
    result_json: jsonStr(r.result_json, 500_000, `jdAnalyses[${i}].result_json`) || '{}',
    source: str(r.source, 40, `jdAnalyses[${i}].source`) || 'llm',
    created_at: isoish(r.created_at, `jdAnalyses[${i}].created_at`, true),
  }));
  const interviews = arr(d, 'interviews').map((r, i) => ({
    id: int(r.id, `interviews[${i}].id`, { min: 1 })!,
    resume_id: int(r.resume_id, `interviews[${i}].resume_id`, { min: 1, nullable: true }),
    job_id: int(r.job_id, `interviews[${i}].job_id`, { min: 1, nullable: true }),
    mode: str(r.mode, 20, `interviews[${i}].mode`) || 'resume',
    status: str(r.status, 20, `interviews[${i}].status`) || 'finished',
    round_key: str(r.round_key, 20, `interviews[${i}].round_key`) || 'intro',
    question_index: int(r.question_index, `interviews[${i}].question_index`, { min: 0, nullable: true }) ?? 0,
    seed_json: jsonStr(r.seed_json, 200_000, `interviews[${i}].seed_json`),
    started_at: isoish(r.started_at, `interviews[${i}].started_at`, true),
    ended_at: nullableStr(r.ended_at, 40, `interviews[${i}].ended_at`),
    report_json: jsonStr(r.report_json, 500_000, `interviews[${i}].report_json`),
    overall_score: int(r.overall_score, `interviews[${i}].overall_score`, { min: 0, max: 100, nullable: true }),
  }));
  const turns = arr(d, 'turns').map((r, i) => ({
    id: int(r.id, `turns[${i}].id`, { min: 1 })!,
    interview_id: int(r.interview_id, `turns[${i}].interview_id`, { min: 1 })!,
    round_key: str(r.round_key, 20, `turns[${i}].round_key`) || 'intro',
    seq: int(r.seq, `turns[${i}].seq`, { min: 0, nullable: true }) ?? 0,
    depth: int(r.depth, `turns[${i}].depth`, { min: 0, max: 2, nullable: true }) ?? 0,
    parent_id: int(r.parent_id, `turns[${i}].parent_id`, { min: 1, nullable: true }),
    question: str(r.question, 5000, `turns[${i}].question`, true),
    focus: str(r.focus, 300, `turns[${i}].focus`),
    answer: nullableStr(r.answer, 30_000, `turns[${i}].answer`),
    feedback_json: jsonStr(r.feedback_json, 300_000, `turns[${i}].feedback_json`),
    score: int(r.score, `turns[${i}].score`, { min: 0, max: 100, nullable: true }),
    source: str(r.source, 20, `turns[${i}].source`) || 'llm',
    created_at: isoish(r.created_at, `turns[${i}].created_at`, true),
    answered_at: nullableStr(r.answered_at, 40, `turns[${i}].answered_at`),
  }));
  const reviews = arr(d, 'reviews').map((r, i) => ({
    id: int(r.id, `reviews[${i}].id`, { min: 1 })!,
    interview_id: int(r.interview_id, `reviews[${i}].interview_id`, { min: 1, nullable: true }),
    bank_id: int(r.bank_id, `reviews[${i}].bank_id`, { min: 1, nullable: true }),
    job_id: int(r.job_id, `reviews[${i}].job_id`, { min: 1, nullable: true }),
    question: str(r.question, 5000, `reviews[${i}].question`, true),
    my_answer: str(r.my_answer, 30_000, `reviews[${i}].my_answer`),
    performance: str(r.performance, 5000, `reviews[${i}].performance`),
    improvement: str(r.improvement, 5000, `reviews[${i}].improvement`),
    rating: int(r.rating, `reviews[${i}].rating`, { min: 1, max: 5, nullable: true }) ?? 3,
    tags: str(r.tags, 500, `reviews[${i}].tags`),
    created_at: isoish(r.created_at, `reviews[${i}].created_at`, true),
  }));
  const bankItems = arr(d, 'bankItems').map((r, i) => ({
    id: int(r.id, `bankItems[${i}].id`, { min: 1 })!,
    question: str(r.question, 5000, `bankItems[${i}].question`, true),
    category: str(r.category, 50, `bankItems[${i}].category`) || '专业',
    job_id: int(r.job_id, `bankItems[${i}].job_id`, { min: 1, nullable: true }),
    source: str(r.source, 40, `bankItems[${i}].source`) || 'manual',
    weak: (int(r.weak, `bankItems[${i}].weak`, { min: 0, max: 1, nullable: true }) ?? 0) as 0 | 1,
    ask_count: int(r.ask_count, `bankItems[${i}].ask_count`, { min: 0, nullable: true }) ?? 0,
    last_score: int(r.last_score, `bankItems[${i}].last_score`, { min: 0, max: 100, nullable: true }),
    last_practiced_at: nullableStr(r.last_practiced_at, 40, `bankItems[${i}].last_practiced_at`),
    created_at: isoish(r.created_at, `bankItems[${i}].created_at`, true),
  }));
  const reviewTasks = arr(d, 'reviewTasks').map((r, i) => ({
    kind: str(r.kind, 20, `reviewTasks[${i}].kind`, true),
    ref_id: int(r.ref_id, `reviewTasks[${i}].ref_id`, { min: 1 })!,
    stage: int(r.stage, `reviewTasks[${i}].stage`, { min: 0, max: 10, nullable: true }) ?? 0,
    due_at: isoish(r.due_at, `reviewTasks[${i}].due_at`, true),
    last_reviewed_at: nullableStr(r.last_reviewed_at, 40, `reviewTasks[${i}].last_reviewed_at`),
    reps: int(r.reps, `reviewTasks[${i}].reps`, { min: 0, nullable: true }) ?? 0,
    lapses: int(r.lapses, `reviewTasks[${i}].lapses`, { min: 0, nullable: true }) ?? 0,
    updated_at: isoish(r.updated_at, `reviewTasks[${i}].updated_at`, true),
  }));
  for (const t of reviewTasks) {
    if (t.kind !== 'review' && t.kind !== 'bank') throw bad(`reviewTasks 存在未知类型「${t.kind}」`);
  }
  const APP_STAGES = ['applied', 'written', 'interview1', 'interview2', 'hr', 'offer', 'rejected', 'withdrawn'];
  const applications = arr(d, 'applications').map((r, i) => {
    const stage = str(r.stage, 20, `applications[${i}].stage`) || 'applied';
    if (!APP_STAGES.includes(stage)) throw bad(`applications[${i}].stage 不是已知阶段`);
    const appliedOn = str(r.applied_on, 10, `applications[${i}].applied_on`, true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appliedOn)) throw bad(`applications[${i}].applied_on 日期格式不正确`);
    return {
      id: int(r.id, `applications[${i}].id`, { min: 1 })!,
      company: str(r.company, 120, `applications[${i}].company`, true),
      title: str(r.title, 160, `applications[${i}].title`, true),
      job_id: int(r.job_id, `applications[${i}].job_id`, { min: 1, nullable: true }),
      applied_on: appliedOn,
      stage,
      note: str(r.note, 5000, `applications[${i}].note`),
      created_at: isoish(r.created_at, `applications[${i}].created_at`, true),
      updated_at: isoish(r.updated_at, `applications[${i}].updated_at`, true),
    };
  });
  const applicationLinks = arr(d, 'applicationLinks').map((r, i) => {
    const kind = str(r.kind, 20, `applicationLinks[${i}].kind`, true);
    if (kind !== 'interview' && kind !== 'review') throw bad(`applicationLinks[${i}].kind 不合法`);
    return {
      application_id: int(r.application_id, `applicationLinks[${i}].application_id`, { min: 1 })!,
      kind,
      ref_id: int(r.ref_id, `applicationLinks[${i}].ref_id`, { min: 1 })!,
      created_at: isoish(r.created_at, `applicationLinks[${i}].created_at`, true),
    };
  });

  checkDupIds(jobs, 'jobs');
  checkDupIds(resumes, 'resumes');
  checkDupIds(jdAnalyses, 'jdAnalyses');
  checkDupIds(interviews, 'interviews');
  checkDupIds(turns, 'turns');
  checkDupIds(reviews, 'reviews');
  checkDupIds(bankItems, 'bankItems');
  checkDupIds(applications, 'applications');

  const warnings: string[] = [];
  const jobIds = new Set(jobs.map((j) => j.id));
  const resumeIds = new Set(resumes.map((r) => r.id));
  const interviewIds = new Set(interviews.map((i) => i.id));
  const bankIds = new Set(bankItems.map((b) => b.id));
  const reviewIds = new Set(reviews.map((r) => r.id));
  const turnIds = new Set(turns.map((t) => t.id));
  for (const r of resumes) {
    if (r.job_id && !jobIds.has(r.job_id)) {
      r.job_id = null;
      warnings.push('有简历关联的岗位不在备份中，已置空');
    }
  }
  for (const a of jdAnalyses) {
    if (a.resume_id && !resumeIds.has(a.resume_id)) a.resume_id = null;
    if (a.job_id && !jobIds.has(a.job_id)) a.job_id = null;
  }
  for (const iv of interviews) {
    if (iv.resume_id && !resumeIds.has(iv.resume_id)) iv.resume_id = null;
    if (iv.job_id && !jobIds.has(iv.job_id)) iv.job_id = null;
  }
  for (const t of turns) {
    if (!interviewIds.has(t.interview_id)) throw bad('逐题记录引用了不存在的面试，文件结构不完整');
    if (t.parent_id && !turnIds.has(t.parent_id)) t.parent_id = null;
  }
  for (const rv of reviews) {
    if (rv.interview_id && !interviewIds.has(rv.interview_id)) rv.interview_id = null;
    if (rv.job_id && !jobIds.has(rv.job_id)) rv.job_id = null;
    if (rv.bank_id && !bankIds.has(rv.bank_id)) rv.bank_id = null;
  }
  for (const b of bankItems) {
    if (b.job_id && !jobIds.has(b.job_id)) b.job_id = null;
  }
  const validTasks = reviewTasks.filter((t) => (t.kind === 'bank' ? bankIds.has(t.ref_id) : reviewIds.has(t.ref_id)));
  if (validTasks.length < reviewTasks.length) warnings.push('有复习任务引用了备份中不存在的题目/复盘，已跳过');

  const appIds = new Set(applications.map((a) => a.id));
  for (const a of applications) {
    if (a.job_id && !jobIds.has(a.job_id)) a.job_id = null;
  }
  const seenLinks = new Set<string>();
  const validLinks = applicationLinks.filter((l) => {
    if (!appIds.has(l.application_id)) return false;
    if (l.kind === 'interview' && !interviewIds.has(l.ref_id)) return false;
    if (l.kind === 'review' && !reviewIds.has(l.ref_id)) return false;
    const key = `${l.kind}:${l.ref_id}`;
    if (seenLinks.has(key)) return false;
    seenLinks.add(key);
    return true;
  });
  if (validLinks.length < applicationLinks.length) warnings.push('有投递关联指向不存在的记录或重复，已跳过');

  return {
    jobs,
    resumes,
    jdAnalyses,
    interviews,
    turns,
    reviews,
    bankItems,
    reviewTasks: validTasks,
    applications,
    applicationLinks: validLinks,
    warnings,
  };
}

function validate(raw: unknown): Validated {
  if (!isObj(raw)) throw bad('文件内容不是有效的备份对象');
  if (raw.app !== BACKUP_APP) throw bad('这不是丰麟云面的备份文件');
  if (raw.version !== BACKUP_VERSION) {
    throw bad(`备份版本为 ${String(raw.version)}，当前只支持版本 ${BACKUP_VERSION}；请更新应用或使用对应版本的备份`, 'VERSION_MISMATCH');
  }
  if (!isObj(raw.data)) throw bad('备份缺少 data 字段，文件可能已损坏');
  let profile: BackupFile['profile'] = null;
  if (raw.profile !== null && raw.profile !== undefined) {
    if (!isObj(raw.profile)) throw bad('profile 字段格式不正确');
    profile = {
      nickname: str(raw.profile.nickname, 200, 'profile.nickname'),
      school: str(raw.profile.school, 200, 'profile.school'),
      major: str(raw.profile.major, 200, 'profile.major'),
      grade: str(raw.profile.grade, 200, 'profile.grade'),
    };
  }
  const file: BackupFile = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: isoish(raw.exportedAt, 'exportedAt'),
    profile,
    data: raw.data as BackupFile['data'],
  };
  const parsed = parseRows(file);
  return {
    file: { ...file, data: {
      jobs: parsed.jobs,
      resumes: parsed.resumes,
      jdAnalyses: parsed.jdAnalyses,
      interviews: parsed.interviews,
      turns: parsed.turns,
      reviews: parsed.reviews,
      bankItems: parsed.bankItems,
      reviewTasks: parsed.reviewTasks,
      applications: parsed.applications,
      applicationLinks: parsed.applicationLinks,
    } },
    warnings: parsed.warnings,
  };
}

function countsOf(parsed: ReturnType<typeof parseRows>) {
  return {
    profiles: 1,
    jobs: parsed.jobs.length,
    resumes: parsed.resumes.length,
    jdAnalyses: parsed.jdAnalyses.length,
    interviews: parsed.interviews.length,
    turns: parsed.turns.length,
    reviews: parsed.reviews.length,
    bankItems: parsed.bankItems.length,
    reviewTasks: parsed.reviewTasks.length,
    applications: parsed.applications.length,
    applicationLinks: parsed.applicationLinks.length,
  };
}

function currentCounts() {
  const one = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const profile = db.prepare('SELECT id FROM profile WHERE id = 1').get() as { id: number } | undefined;
  return {
    profiles: profile ? 1 : 0,
    jobs: one('job'),
    resumes: one('resume'),
    jdAnalyses: one('jd_analysis'),
    interviews: one('interview'),
    turns: one('interview_turn'),
    reviews: one('review'),
    bankItems: one('bank_item'),
    reviewTasks: one('review_task'),
    applications: one('application'),
    applicationLinks: one('application_link'),
  };
}

function isEmptyTarget(): boolean {
  const c = currentCounts();
  return (
    c.jobs === 0 &&
    c.resumes === 0 &&
    c.jdAnalyses === 0 &&
    c.interviews === 0 &&
    c.reviews === 0 &&
    c.bankItems === 0 &&
    c.reviewTasks === 0 &&
    c.applications === 0 &&
    !db.prepare('SELECT nickname FROM profile WHERE id = 1').get()?.nickname
  );
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[\s\u3000]+/g, '').replace(/[，。！？、；：“”‘’（）()《》【】,.!?;:'"\-—_/\\]/g, '');
}

function clearAll(): void {
  // 清空示例数据标记与失效的选择状态，避免导入后仍显示“示例已载入”或指向不存在的 ID。
  db.prepare('DELETE FROM demo_seed').run();
  db.prepare("DELETE FROM setting WHERE key IN ('demo_prev_profile', 'active_resume_id', 'active_job_id')").run();
  for (const t of [
    'application_link',
    'application',
    'review_task',
    'interview_turn',
    'review',
    'jd_analysis',
    'interview',
    'bank_item',
    'resume',
    'job',
  ]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('UPDATE profile SET nickname = ?, school = ?, major = ?, grade = ?, updated_at = ? WHERE id = 1').run(
    '',
    '',
    '',
    '',
    nowIso(),
  );
}

function writeOverwrite(parsed: ReturnType<typeof parseRows>, profile: BackupFile['profile']): void {
  clearAll();
  for (const j of parsed.jobs) {
    db.prepare(
      'INSERT INTO job (id, title, company, jd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(j.id, j.title, j.company, j.jd, j.created_at, j.updated_at);
  }
  for (const r of parsed.resumes) {
    db.prepare(
      'INSERT INTO resume (id, title, content, job_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(r.id, r.title, r.content, r.job_id, r.source, r.created_at, r.updated_at);
  }
  for (const a of parsed.jdAnalyses) {
    db.prepare(
      'INSERT INTO jd_analysis (id, resume_id, job_id, jd, score, result_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(a.id, a.resume_id, a.job_id, a.jd, a.score, a.result_json, a.source, a.created_at);
  }
  for (const iv of parsed.interviews) {
    db.prepare(
      'INSERT INTO interview (id, resume_id, job_id, mode, status, round_key, question_index, seed_json, started_at, ended_at, report_json, overall_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      iv.id,
      iv.resume_id,
      iv.job_id,
      iv.mode,
      iv.status,
      iv.round_key,
      iv.question_index,
      iv.seed_json,
      iv.started_at,
      iv.ended_at,
      iv.report_json,
      iv.overall_score,
    );
  }
  for (const t of parsed.turns) {
    db.prepare(
      'INSERT INTO interview_turn (id, interview_id, round_key, seq, depth, parent_id, question, focus, answer, feedback_json, score, source, created_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      t.id,
      t.interview_id,
      t.round_key,
      t.seq,
      t.depth,
      t.parent_id,
      t.question,
      t.focus,
      t.answer,
      t.feedback_json,
      t.score,
      t.source,
      t.created_at,
      t.answered_at,
    );
  }
  for (const b of parsed.bankItems) {
    db.prepare(
      'INSERT INTO bank_item (id, question, category, job_id, source, weak, ask_count, last_score, last_practiced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      b.id,
      b.question,
      b.category,
      b.job_id,
      b.source,
      b.weak,
      b.ask_count,
      b.last_score,
      b.last_practiced_at,
      b.created_at,
    );
  }
  for (const rv of parsed.reviews) {
    db.prepare(
      'INSERT INTO review (id, interview_id, bank_id, job_id, question, my_answer, performance, improvement, rating, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      rv.id,
      rv.interview_id,
      rv.bank_id,
      rv.job_id,
      rv.question,
      rv.my_answer,
      rv.performance,
      rv.improvement,
      rv.rating,
      rv.tags,
      rv.created_at,
    );
  }
  for (const a of parsed.applications) {
    db.prepare(
      'INSERT INTO application (id, company, title, job_id, applied_on, stage, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(a.id, a.company, a.title, a.job_id, a.applied_on, a.stage, a.note, a.created_at, a.updated_at);
  }
  for (const l of parsed.applicationLinks) {
    db.prepare(
      'INSERT OR IGNORE INTO application_link (application_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?)',
    ).run(l.application_id, l.kind, l.ref_id, l.created_at);
  }
  for (const t of parsed.reviewTasks) {
    db.prepare(
      'INSERT OR IGNORE INTO review_task (kind, ref_id, stage, due_at, last_reviewed_at, reps, lapses, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(t.kind, t.ref_id, t.stage, t.due_at, t.last_reviewed_at, t.reps, t.lapses, t.updated_at);
  }
  if (profile) {
    db.prepare('UPDATE profile SET nickname = ?, school = ?, major = ?, grade = ?, updated_at = ? WHERE id = 1').run(
      profile.nickname || '',
      profile.school || '',
      profile.major || '',
      profile.grade || '',
      nowIso(),
    );
  }
}

function writeMerge(parsed: ReturnType<typeof parseRows>, profile: BackupFile['profile']): void {
  const jobMap = new Map<number, number>();
  const resumeMap = new Map<number, number>();
  const interviewMap = new Map<number, number>();
  const bankMap = new Map<number, number>();
  const reviewMap = new Map<number, number>();
  const appMap = new Map<number, number>();

  for (const j of parsed.jobs) {
    const r = db
      .prepare('INSERT INTO job (title, company, jd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(j.title, j.company, j.jd, j.created_at, j.updated_at);
    jobMap.set(j.id, r.lastInsertRowid);
  }
  for (const r of parsed.resumes) {
    const ins = db
      .prepare('INSERT INTO resume (title, content, job_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.title, r.content, r.job_id ? jobMap.get(r.job_id) ?? null : null, r.source, r.created_at, r.updated_at);
    resumeMap.set(r.id, ins.lastInsertRowid);
  }
  for (const a of parsed.jdAnalyses) {
    db.prepare(
      'INSERT INTO jd_analysis (resume_id, job_id, jd, score, result_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      a.resume_id ? resumeMap.get(a.resume_id) ?? null : null,
      a.job_id ? jobMap.get(a.job_id) ?? null : null,
      a.jd,
      a.score,
      a.result_json,
      a.source,
      a.created_at,
    );
  }
  for (const a of parsed.applications) {
    const r = db
      .prepare(
        'INSERT INTO application (company, title, job_id, applied_on, stage, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        a.company,
        a.title,
        a.job_id ? jobMap.get(a.job_id) ?? null : null,
        a.applied_on,
        a.stage,
        a.note,
        a.created_at,
        a.updated_at,
      );
    appMap.set(a.id, r.lastInsertRowid);
  }
  for (const iv of parsed.interviews) {
    const r = db
      .prepare(
        'INSERT INTO interview (resume_id, job_id, mode, status, round_key, question_index, seed_json, started_at, ended_at, report_json, overall_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        iv.resume_id ? resumeMap.get(iv.resume_id) ?? null : null,
        iv.job_id ? jobMap.get(iv.job_id) ?? null : null,
        iv.mode,
        iv.status,
        iv.round_key,
        iv.question_index,
        iv.seed_json,
        iv.started_at,
        iv.ended_at,
        iv.report_json,
        iv.overall_score,
      );
    interviewMap.set(iv.id, r.lastInsertRowid);
  }
  const turnMap = new Map<number, number>();
  for (const t of parsed.turns) {
    const iid = interviewMap.get(t.interview_id);
    if (!iid) continue;
    const r = db
      .prepare(
        'INSERT INTO interview_turn (interview_id, round_key, seq, depth, parent_id, question, focus, answer, feedback_json, score, source, created_at, answered_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        iid,
        t.round_key,
        t.seq,
        t.depth,
        t.question,
        t.focus,
        t.answer,
        t.feedback_json,
        t.score,
        t.source,
        t.created_at,
        t.answered_at,
      );
    turnMap.set(t.id, r.lastInsertRowid);
  }
  for (const t of parsed.turns) {
    if (!t.parent_id) continue;
    const tid = turnMap.get(t.id);
    const pid = turnMap.get(t.parent_id);
    if (tid && pid) db.prepare('UPDATE interview_turn SET parent_id = ? WHERE id = ?').run(pid, tid);
  }

  const existingBank = new Map<string, number>();
  for (const row of db.prepare('SELECT id, question FROM bank_item').all() as { id: number; question: string }[]) {
    existingBank.set(normalizeQuestion(row.question), row.id);
  }
  let skippedBank = 0;
  for (const b of parsed.bankItems) {
    const key = normalizeQuestion(b.question);
    const dup = existingBank.get(key);
    if (dup) {
      bankMap.set(b.id, dup);
      skippedBank += 1;
      continue;
    }
    const r = db
      .prepare(
        'INSERT INTO bank_item (question, category, job_id, source, weak, ask_count, last_score, last_practiced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        b.question,
        b.category,
        b.job_id ? jobMap.get(b.job_id) ?? null : null,
        b.source,
        b.weak,
        b.ask_count,
        b.last_score,
        b.last_practiced_at,
        b.created_at,
      );
    bankMap.set(b.id, r.lastInsertRowid);
    existingBank.set(key, r.lastInsertRowid);
  }
  for (const rv of parsed.reviews) {
    const r = db
      .prepare(
        'INSERT INTO review (interview_id, bank_id, job_id, question, my_answer, performance, improvement, rating, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        rv.interview_id ? interviewMap.get(rv.interview_id) ?? null : null,
        rv.bank_id ? bankMap.get(rv.bank_id) ?? null : null,
        rv.job_id ? jobMap.get(rv.job_id) ?? null : null,
        rv.question,
        rv.my_answer,
        rv.performance,
        rv.improvement,
        rv.rating,
        rv.tags,
        rv.created_at,
      );
    reviewMap.set(rv.id, r.lastInsertRowid);
  }
  for (const l of parsed.applicationLinks) {
    const appId = appMap.get(l.application_id);
    const refId = l.kind === 'interview' ? interviewMap.get(l.ref_id) : reviewMap.get(l.ref_id);
    if (!appId || !refId) continue;
    db.prepare(
      'INSERT OR IGNORE INTO application_link (application_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?)',
    ).run(appId, l.kind, refId, l.created_at);
  }
  for (const t of parsed.reviewTasks) {
    const mapped =
      t.kind === 'bank' ? bankMap.get(t.ref_id) : reviewMap.get(t.ref_id);
    if (!mapped) continue;
    db.prepare(
      'INSERT OR IGNORE INTO review_task (kind, ref_id, stage, due_at, last_reviewed_at, reps, lapses, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(t.kind, mapped, t.stage, t.due_at, t.last_reviewed_at, t.reps, t.lapses, t.updated_at);
  }

  const p = db.prepare('SELECT nickname, school, major, grade FROM profile WHERE id = 1').get() as
    | { nickname: string; school: string; major: string; grade: string }
    | undefined;
  const hasProfile = p && (p.nickname || p.school || p.major || p.grade);
  if (profile && !hasProfile && (profile.nickname || profile.school || profile.major || profile.grade)) {
    db.prepare('UPDATE profile SET nickname = ?, school = ?, major = ?, grade = ?, updated_at = ? WHERE id = 1').run(
      profile.nickname || '',
      profile.school || '',
      profile.major || '',
      profile.grade || '',
      nowIso(),
    );
  }
  (parsed as ReturnType<typeof parseRows> & { skippedBank?: number }).skippedBank = skippedBank;
}

function readBody(req: { body?: unknown }): { backup: unknown; mode: 'merge' | 'overwrite' } {
  const body = req.body;
  if (!isObj(body)) throw bad('请求体格式不正确');
  const backup = body.backup;
  if (!isObj(backup)) throw bad('缺少备份内容');
  const serialized = JSON.stringify(backup);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    throw new HttpError(413, '备份文件超过 8 MB，已拒绝导入', 'TOO_LARGE');
  }
  const mode = body.mode === 'overwrite' ? 'overwrite' : 'merge';
  return { backup, mode };
}

BACKUP_ROUTER.get(
  '/backup/export',
  ah(async (_req, res) => {
    const file: BackupFile = {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: nowIso(),
      profile: (db.prepare('SELECT nickname, school, major, grade FROM profile WHERE id = 1').get() as Obj) ?? null,
      data: {
        jobs: db.prepare('SELECT * FROM job ORDER BY id').all() as Obj[],
        resumes: db.prepare('SELECT * FROM resume ORDER BY id').all() as Obj[],
        jdAnalyses: db.prepare('SELECT * FROM jd_analysis ORDER BY id').all() as Obj[],
        interviews: db.prepare('SELECT * FROM interview ORDER BY id').all() as Obj[],
        turns: db.prepare('SELECT * FROM interview_turn ORDER BY id').all() as Obj[],
        reviews: db.prepare('SELECT * FROM review ORDER BY id').all() as Obj[],
        bankItems: db.prepare('SELECT * FROM bank_item ORDER BY id').all() as Obj[],
        reviewTasks: db.prepare('SELECT * FROM review_task ORDER BY kind, ref_id').all() as Obj[],
        applications: db.prepare('SELECT * FROM application ORDER BY id').all() as Obj[],
        applicationLinks: db.prepare('SELECT * FROM application_link ORDER BY application_id, kind, ref_id').all() as Obj[],
      },
    };
    const filename = `fenglin-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'no-store');
    res.send(JSON.stringify(file, null, 2));
  }),
);

BACKUP_ROUTER.post(
  '/backup/preview',
  ah(async (req, res) => {
    try {
      const { backup } = readBody(req);
      const validated = validate(backup);
      const counts = countsOf(parseRows(validated.file));
      res.json({
        ok: true,
        version: validated.file.version,
        exportedAt: validated.file.exportedAt,
        counts,
        current: currentCounts(),
        emptyTarget: isEmptyTarget(),
        warnings: validated.warnings,
      });
    } catch (e) {
      if (e instanceof HttpError) {
        res.json({ ok: false, code: e.code, message: e.message });
        return;
      }
      throw e;
    }
  }),
);

BACKUP_ROUTER.post(
  '/backup/import',
  ah(async (req, res) => {
    try {
      const { backup, mode } = readBody(req);
      const validated = validate(backup);
      const parsed = parseRows(validated.file);
      const before = currentCounts();
      const empty = isEmptyTarget();
      const effectiveMode = empty ? 'overwrite' : mode;

      db.exec('BEGIN');
      try {
        if (effectiveMode === 'overwrite') {
          writeOverwrite(parsed, validated.file.profile);
        } else {
          writeMerge(parsed, validated.file.profile);
        }
        db.exec('COMMIT');
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      }

      res.json({
        ok: true,
        mode: effectiveMode,
        before,
        after: currentCounts(),
        warnings: validated.warnings,
      });
    } catch (e) {
      if (e instanceof HttpError) {
        // 与预览一致：可预期的坏文件用 200 + ok:false，避免浏览器控制台网络报错；
        // 写库异常仍抛给全局错误处理。
        res.json({ ok: false, code: e.code, message: e.message });
        return;
      }
      throw e;
    }
  }),
);
