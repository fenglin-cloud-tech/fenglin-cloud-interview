import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import type { BindParams } from 'sql.js';
import { env } from './env.js';

/**
 * SQLite 持久层。
 *
 * 这里用 sql.js（SQLite 官方 C 代码编译出的 WebAssembly 版本）而不是 better-sqlite3：
 * 目标托管运行时是 Node 20 + 较旧 glibc，原生二进制模块既无法用 Node 22 的 ABI，
 * 预编译产物又缺少 GLIBC_2.33 符号。WASM 版没有原生二进制，跨环境行为一致。
 *
 * 对外仍然保持原来 better-sqlite3 的最小子集：prepare().get/all/run、exec、close，
 * 路由层无需改动。写入后带 150ms 防抖落盘，并用「临时文件 + rename」保证原子性。
 */

const require = createRequire(import.meta.url);

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  nickname     TEXT NOT NULL DEFAULT '',
  school       TEXT NOT NULL DEFAULT '',
  major        TEXT NOT NULL DEFAULT '',
  grade        TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  company     TEXT NOT NULL DEFAULT '',
  jd          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resume (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  job_id      INTEGER REFERENCES job(id) ON DELETE SET NULL,
  source      TEXT NOT NULL DEFAULT 'manual',
  parent_id   INTEGER REFERENCES resume(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jd_analysis (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resume_id   INTEGER,
  job_id      INTEGER,
  jd          TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'llm',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interview (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  resume_id      INTEGER,
  job_id         INTEGER,
  mode           TEXT NOT NULL DEFAULT 'resume',
  status         TEXT NOT NULL DEFAULT 'active',
  round_key      TEXT NOT NULL DEFAULT 'intro',
  question_index INTEGER NOT NULL DEFAULT 0,
  seed_json      TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  report_json    TEXT,
  overall_score  INTEGER
);

CREATE TABLE IF NOT EXISTS interview_turn (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id  INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
  round_key     TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  depth         INTEGER NOT NULL DEFAULT 0,
  parent_id     INTEGER,
  question      TEXT NOT NULL,
  focus         TEXT NOT NULL DEFAULT '',
  answer        TEXT,
  feedback_json TEXT,
  score         INTEGER,
  source        TEXT NOT NULL DEFAULT 'llm',
  created_at    TEXT NOT NULL,
  answered_at   TEXT
);

CREATE TABLE IF NOT EXISTS review (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER,
  bank_id      INTEGER,
  job_id       INTEGER,
  question     TEXT NOT NULL,
  my_answer    TEXT NOT NULL DEFAULT '',
  performance  TEXT NOT NULL DEFAULT '',
  improvement  TEXT NOT NULL DEFAULT '',
  rating       INTEGER NOT NULL DEFAULT 3,
  tags         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_item (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  question          TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT '专业',
  job_id            INTEGER,
  source            TEXT NOT NULL DEFAULT 'manual',
  weak              INTEGER NOT NULL DEFAULT 0,
  ask_count         INTEGER NOT NULL DEFAULT 0,
  last_score        INTEGER,
  last_practiced_at TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_task (
  kind             TEXT NOT NULL,
  ref_id           INTEGER NOT NULL,
  stage            INTEGER NOT NULL DEFAULT 0,
  due_at           TEXT NOT NULL,
  last_reviewed_at TEXT,
  reps             INTEGER NOT NULL DEFAULT 0,
  lapses           INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (kind, ref_id)
);

CREATE TABLE IF NOT EXISTS application (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company          TEXT NOT NULL,
  title            TEXT NOT NULL,
  job_id           INTEGER REFERENCES job(id) ON DELETE SET NULL,
  applied_on       TEXT NOT NULL,
  stage            TEXT NOT NULL DEFAULT 'applied',
  note             TEXT NOT NULL DEFAULT '',
  next_action_at   TEXT,
  next_action_note TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- 投递阶段历史：每次阶段真正变化时追加一条，漏斗按历史计算。
CREATE TABLE IF NOT EXISTS application_stage_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  from_stage     TEXT,
  to_stage       TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  changed_at     TEXT NOT NULL
);

-- AI 异步任务：仅解决实例重启后任务状态丢失，不做跨实例共享。
CREATE TABLE IF NOT EXISTS ai_job (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  payload_json TEXT,
  result_json  TEXT,
  error_json   TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- 投递与面试/复盘的关联：单独关联表，避免给 interview / review 增加列和迁移。
CREATE TABLE IF NOT EXISTS application_link (
  application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  ref_id         INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (kind, ref_id)
);

CREATE TABLE IF NOT EXISTS demo_seed (
  kind       TEXT NOT NULL,
  ref_id     INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, ref_id)
);

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_due ON review_task(due_at);
CREATE INDEX IF NOT EXISTS idx_turn_interview ON interview_turn(interview_id, seq);
CREATE INDEX IF NOT EXISTS idx_turn_answered ON interview_turn(interview_id, seq) WHERE answer IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_category ON bank_item(category, weak);
CREATE INDEX IF NOT EXISTS idx_bank_question ON bank_item(question);
CREATE INDEX IF NOT EXISTS idx_review_created ON review(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_job ON review(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_status ON interview(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_jd_resume ON jd_analysis(resume_id, id);
CREATE INDEX IF NOT EXISTS idx_application_stage ON application(stage, applied_on DESC);
CREATE INDEX IF NOT EXISTS idx_applink_app ON application_link(application_id);
CREATE INDEX IF NOT EXISTS idx_applink_ref ON application_link(ref_id);
CREATE INDEX IF NOT EXISTS idx_stage_log_app ON application_stage_log(application_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_ai_job_expires ON ai_job(expires_at);
`;

type SqlValue = number | string | Uint8Array | null;
type Params = SqlValue[];

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath, useOldExtensionFunctions: false });

let raw: initSqlJs.Database;
try {
  raw = fs.existsSync(env.dbPath) && fs.statSync(env.dbPath).size > 0
    ? new SQL.Database(fs.readFileSync(env.dbPath))
    : new SQL.Database();
} catch (err) {
  // 文件损坏时不能让整站起不来：退回空库，并把坏文件留档便于排查。
  const backup = `${env.dbPath}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(env.dbPath, backup);
  } catch {
    /* ignore */
  }
  console.error('[db] 读取已有数据库失败，已新建空库：', err instanceof Error ? err.message : err);
  raw = new SQL.Database();
}

raw.run('PRAGMA foreign_keys = ON');
raw.exec(SCHEMA);

/* ── 兼容旧库：补齐 P1 新增列，再建依赖列名的索引 ───────────── */

function tableColumns(table: string): Set<string> {
  const res = raw.exec(`PRAGMA table_info(${table})`);
  const cols = new Set<string>();
  if (res.length) {
    const nameIndex = res[0].columns.indexOf('name');
    for (const row of res[0].values) cols.add(String(row[nameIndex]));
  }
  return cols;
}

function ensureColumn(table: string, column: string, ddl: string): void {
  if (!tableColumns(table).has(column)) raw.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn('resume', 'parent_id', 'parent_id INTEGER');
ensureColumn('application', 'next_action_at', 'next_action_at TEXT');
ensureColumn('application', 'next_action_note', "next_action_note TEXT NOT NULL DEFAULT ''");

raw.exec(`
CREATE INDEX IF NOT EXISTS idx_resume_parent ON resume(parent_id);
CREATE INDEX IF NOT EXISTS idx_application_next ON application(next_action_at);
`);

/* ── 落盘：防抖 + 原子替换 ───────────────────────────────── */

let dirty = false;
let timer: NodeJS.Timeout | null = null;
let writeFailed = false;

function flush(): void {
  if (!dirty) return;
  dirty = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const tmp = `${env.dbPath}.tmp`;
  try {
    fs.writeFileSync(tmp, Buffer.from(raw.export()));
    fs.renameSync(tmp, env.dbPath);
    writeFailed = false;
  } catch (err) {
    if (!writeFailed) {
      writeFailed = true;
      console.error('[db] 数据库落盘失败（内存中继续可用）：', err instanceof Error ? err.message : err);
    }
  }
}

function markDirty(): void {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, 150);
  timer.unref?.();
}

/* ── 语句包装：保持 better-sqlite3 的调用形态 ──────────────── */

function normalizeParams(params: unknown[]): Params {
  return params.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    return v as SqlValue;
  });
}

const cache = new Map<string, initSqlJs.Statement>();

function stmtOf(sql: string): initSqlJs.Statement {
  const hit = cache.get(sql);
  if (hit) return hit;
  const st = raw.prepare(sql);
  cache.set(sql, st);
  return st;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Prepared {
  // 行是动态 SQL 结果，沿用 better-sqlite3 时期的宽松类型，由调用方按需断言。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(...params: unknown[]): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all(...params: unknown[]): any[];
  run(...params: unknown[]): RunResult;
}

export const db = {
  prepare(sql: string): Prepared {
    return {
      get(...params: unknown[]) {
        const st = stmtOf(sql);
        st.reset();
        if (params.length) st.bind(normalizeParams(params) as BindParams);
        const row = st.step() ? (st.getAsObject() as Record<string, unknown>) : undefined;
        st.reset();
        return row;
      },
      all(...params: unknown[]) {
        const st = stmtOf(sql);
        st.reset();
        if (params.length) st.bind(normalizeParams(params) as BindParams);
        const rows: Record<string, unknown>[] = [];
        while (st.step()) rows.push(st.getAsObject() as Record<string, unknown>);
        st.reset();
        return rows;
      },
      run(...params: unknown[]) {
        const st = stmtOf(sql);
        st.reset();
        if (params.length) st.bind(normalizeParams(params) as BindParams);
        st.step();
        st.reset();
        const changes = raw.getRowsModified();
        // 只读查询和 INSERT OR IGNORE 的无效写入不应触发全库导出。
        if (changes > 0) markDirty();
        const idRow = raw.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = Number(idRow[0]?.values[0]?.[0] ?? 0);
        return { changes, lastInsertRowid };
      },
    };
  },
  exec(sql: string): void {
    raw.exec(sql);
    markDirty();
  },
  close(): void {
    flush();
    for (const st of cache.values()) {
      try {
        st.free();
      } catch {
        /* ignore */
      }
    }
    cache.clear();
    raw.close();
  },
};

const seedProfile = db.prepare('SELECT COUNT(*) AS n FROM profile').get() as { n: number };
if (!seedProfile.n) {
  db.prepare('INSERT INTO profile (id, nickname, school, major, grade, updated_at) VALUES (1, ?, ?, ?, ?, ?)').run(
    '',
    '',
    '',
    '',
    nowIso(),
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? String(row.value) : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function parseJson<T>(rawValue: string | null | undefined, fallback: T): T {
  if (!rawValue) return fallback;
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}
