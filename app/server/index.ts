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

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

app.use('/api', coreRouter);
app.use('/api', aiRouter);
app.use('/api', interviewRouter);
app.use('/api', reviewRouter);

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
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
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
