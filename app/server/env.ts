import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const isProd = process.env.NODE_ENV === 'production';

function nonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/** 生产托管环境的文件系统是临时的，数据库落到 TMPDIR；本地开发仍用 app/data 持久化 */
const defaultDbPath = isProd
  ? path.join(process.env.TMPDIR || os.tmpdir(), 'fenglin-cloud-interview', 'fenglin.sqlite')
  : path.join(root, 'data', 'fenglin.sqlite');

export const env = {
  port: Number(process.env.PORT || 8787),
  zhipuApiKey: (process.env.ZHIPU_API_KEY || '').trim(),
  zhipuModel: (process.env.ZHIPU_MODEL || 'glm-4-air').trim(),
  /** 视觉模型：glm-4v-flash 约 17s 且字段需归一化；glm-4.5v 更守格式但更慢。 */
  zhipuVisionModel: (process.env.ZHIPU_VISION_MODEL || 'glm-4v-flash').trim(),
  zhipuBaseUrl: (process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions').trim(),
  dbPath: process.env.DB_PATH || defaultDbPath,
  sharedDemo: process.env.SHARED_DEMO === '1',
  /** 公网演示的模型调用保护：每 IP 每分钟次数、全实例每日总次数；设 0 可关闭。 */
  aiRateLimitPerMin: nonNegativeInt('AI_RATE_LIMIT_PER_MIN', 6),
  aiDailyLimit: nonNegativeInt('AI_DAILY_LIMIT', 300),
  isProd,
};

export function hasApiKey(): boolean {
  return env.zhipuApiKey.length > 0;
}

/** 只输出 key 的存在性与长度，任何日志都不打印明文。 */
export function keyFingerprint(): string {
  if (!env.zhipuApiKey) return '未配置';
  return `已配置（长度 ${env.zhipuApiKey.length}，前缀 ${env.zhipuApiKey.slice(0, 4)}***）`;
}
