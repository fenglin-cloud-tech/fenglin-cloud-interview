import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, keyFingerprint } from './env.js';
import { db } from './db.js';
import { HttpError } from './util.js';
import { coreRouter } from './routes/core.js';
import { aiRouter } from './routes/ai.js';
import { interviewRouter } from './routes/interview.js';
import { reviewRouter } from './routes/review.js';
import { demoRouter } from './routes/demo.js';
import { BACKUP_ROUTER } from './routes/backup.js';
import { applicationsRouter } from './routes/applications.js';
import { experiencesRouter } from './routes/experiences.js';
import { skillsRouter } from './routes/skills.js';
import { trainingRouter } from './routes/training.js';
import { pitchRouter } from './routes/pitch.js';
import { bankCardRouter } from './routes/bank-card.js';
import { maintenanceRouter } from './routes/maintenance.js';
import { backfillTurnTags } from './tags.js';

const app = express();
app.disable('x-powered-by');
// 线上由平台网关转发；开启单层 trust proxy 才能拿到真实客户端 IP。
app.set('trust proxy', 1);
app.use(express.json({ limit: '16mb' }));

/* 公网演示实例的模型调用保护：按 IP 每分钟限流 + 全实例每日上限。 */
const aiBuckets = new Map<string, { count: number; resetAt: number }>();
let aiDay = new Date().toDateString();
let aiDayCount = 0;

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.ip || req.socket.remoteAddress || 'unknown';
}

function needsAiLimit(pathname: string): boolean {
  if (pathname === '/ai/status') return false;
  if (pathname.startsWith('/ai/')) return true;
  return (
    /^\/interviews\/\d+\/(answer|finish)$/.test(pathname) ||
    /^\/jobs\/\d+\/skills$/.test(pathname) ||
    pathname === '/pitch/generate' ||
    /^\/bank\/\d+\/card\/generate$/.test(pathname) ||
    /^\/interviews\/\d+\/turns\/\d+\/skip$/.test(pathname)
  );
}

app.use('/api', (req, res, next) => {
  if (!needsAiLimit(req.path)) {
    next();
    return;
  }
  const day = new Date().toDateString();
  if (day !== aiDay) {
    aiDay = day;
    aiDayCount = 0;
    aiBuckets.clear();
  }
  if (env.aiDailyLimit > 0 && aiDayCount >= env.aiDailyLimit) {
    res.status(429).json({ error: { code: 'AI_DAILY_LIMIT', message: '今日 AI 调用额度已用完，请明天再试' } });
    return;
  }
  const now = Date.now();
  const ip = clientIp(req);
  let bucket = aiBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    aiBuckets.set(ip, bucket);
  }
  if (env.aiRateLimitPerMin > 0 && bucket.count >= env.aiRateLimitPerMin) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    res.status(429).json({
      error: {
        code: 'AI_RATE_LIMIT',
        message: `AI 请求太频繁，请稍后再试（每分钟最多 ${env.aiRateLimitPerMin} 次）`,
      },
    });
    return;
  }
  bucket.count += 1;
  aiDayCount += 1;
  next();
});

app.use('/api', coreRouter);
app.use('/api', aiRouter);
app.use('/api', interviewRouter);
app.use('/api', reviewRouter);
app.use('/api', demoRouter);
app.use('/api', BACKUP_ROUTER);
app.use('/api', applicationsRouter);
app.use('/api', experiencesRouter);
app.use('/api', skillsRouter);
app.use('/api', trainingRouter);
app.use('/api', pitchRouter);
app.use('/api', bankCardRouter);
app.use('/api', maintenanceRouter);

// DATA-04：旧库回填薄弱标签；失败不影响启动。
try {
  backfillTurnTags();
} catch (err) {
  console.warn('[tags] 回填薄弱标签失败:', err instanceof Error ? err.message : err);
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

// 兼容三种部署布局：本地 app/dist、生产包内 cwd=dist、以及 STATIC_DIR 显式指定
const here = path.dirname(fileURLToPath(import.meta.url));
const staticCandidates = [
  process.env.STATIC_DIR,
  path.resolve(process.cwd(), 'dist'),
  process.cwd(),
  path.resolve(here, '../dist'),
].filter((p): p is string => !!p);
const distDir = staticCandidates.find((p) => fs.existsSync(path.join(p, 'index.html')));

if (distDir) {
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        // Vite 产物带内容哈希，可以放心长缓存；index.html 必须每次回源，避免旧壳引用已删除的 chunk。
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    }),
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain; charset=utf-8')
      .send('丰麟云面 API 已启动。开发模式请访问 Vite 地址（默认 http://localhost:5173）。');
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, detail: err.detail } });
    return;
  }
  // 请求体不是合法 JSON（body-parser 抛出）属于客户端错误，不应报 500。
  if (err instanceof Error && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: '请求体不是合法的 JSON' } });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('[server] 未捕获错误:', message, err instanceof Error ? err.stack : '');
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务端开小差了，请稍后重试' } });
});

app.listen(env.port, '0.0.0.0', () => {
  console.log('──────────────────────────────────────────────');
  console.log(' 丰麟云面 API');
  console.log(` 端口      : ${env.port}`);
  console.log(` 数据库    : ${env.dbPath}`);
  console.log(` 模型      : ${env.zhipuModel}`);
  console.log(` API Key   : ${keyFingerprint()}`);
  if (!env.isProd) console.log(' 前端开发   : http://localhost:5173');
  console.log('──────────────────────────────────────────────');
});

function shutdown() {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
