import type { z } from 'zod';
import { env, hasApiKey } from './env.js';

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmCode = 'NO_KEY' | 'TIMEOUT' | 'HTTP' | 'PARSE' | 'SCHEMA' | 'NETWORK';

export class LlmError extends Error {
  code: LlmCode;
  detail?: string;
  constructor(code: LlmCode, message: string, detail?: string) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export interface LlmMeta {
  source: 'llm' | 'local';
  model?: string;
  attempts?: number;
  ms?: number;
  note?: string;
}

const TIMEOUT_MS = 55_000;
const MAX_ATTEMPTS = 3;

/** 从模型文本里抠出第一段平衡的 JSON 对象/数组，容忍 ```json 围栏与前后废话。 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const direct = tryParse(trimmed);
  if (direct.ok) return direct.value;

  const start = trimmed.search(/[[{]/);
  if (start === -1) throw new LlmError('PARSE', '模型返回中没有 JSON 结构');
  const open = trimmed[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        const parsed = tryParse(candidate);
        if (parsed.ok) return parsed.value;
        break;
      }
    }
  }
  throw new LlmError('PARSE', '模型返回的 JSON 不完整或无法解析');
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function callOnce(messages: ChatMsg[], temperature: number, maxTokens: number): Promise<string> {
  if (!hasApiKey()) {
    throw new LlmError('NO_KEY', '未配置 ZHIPU_API_KEY，服务端无法调用模型');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(env.zhipuBaseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.zhipuApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.zhipuModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const hint = body.slice(0, 400);
      throw new LlmError('HTTP', `模型接口返回 ${res.status}`, hint);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new LlmError('PARSE', '模型返回内容为空');
    return content;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LlmError('TIMEOUT', `模型调用超时（${TIMEOUT_MS / 1000}s）`);
    }
    throw new LlmError('NETWORK', '无法连接模型服务', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调用模型并强制校验 JSON 结构。
 * 解析/校验失败会把错误与原始输出回灌给模型要求重写，最多 3 次。
 */
export async function chatJSON<S extends z.ZodTypeAny>(
  schema: S,
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number; tag?: string } = {},
): Promise<{ data: z.infer<S>; meta: LlmMeta; raw: string }> {
  const started = Date.now();
  const temperature = opts.temperature ?? 0.5;
  const maxTokens = opts.maxTokens ?? 2200;
  const convo: ChatMsg[] = [...messages];
  let lastErr: Error = new LlmError('PARSE', '模型调用失败');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = await callOnce(convo, temperature, maxTokens);
      let parsed: unknown;
      try {
        parsed = extractJson(raw);
      } catch (err) {
        throw new LlmError('PARSE', err instanceof Error ? err.message : 'JSON 解析失败', raw.slice(0, 600));
      }
      const checked = schema.safeParse(parsed);
      if (!checked.success) {
        throw new LlmError('SCHEMA', '模型返回结构不符合约定', checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      console.log(`[llm] ${opts.tag || 'json'} ok attempt=${attempt} ms=${Date.now() - started} model=${env.zhipuModel}`);
      return {
        data: checked.data,
        raw,
        meta: { source: 'llm', model: env.zhipuModel, attempts: attempt, ms: Date.now() - started },
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const e = lastErr as LlmError;
      console.warn(`[llm] ${opts.tag || 'json'} attempt=${attempt} failed code=${e.code || 'UNKNOWN'}: ${e.message}`);
      if (e.code === 'NO_KEY') break;
      if (attempt === MAX_ATTEMPTS) break;
      if (e.code === 'TIMEOUT' && attempt >= 2) break;
      if (e.code === 'PARSE' || e.code === 'SCHEMA') {
        convo.push(
          { role: 'assistant', content: e.detail?.slice(0, 1200) || '(上一条输出)' },
          {
            role: 'user',
            content:
              '上面的输出无法被程序解析或字段不完整。请只输出一个合法的 JSON 对象，不要包含任何解释文字、不要使用 Markdown 代码围栏，并严格包含约定的全部字段。',
          },
        );
      } else {
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
  }
  throw lastErr;
}
