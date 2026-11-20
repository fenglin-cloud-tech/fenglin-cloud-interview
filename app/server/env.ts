import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const isProd = process.env.NODE_ENV === 'production';

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
