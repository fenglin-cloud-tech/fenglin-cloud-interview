import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from './util.js';

/**
 * 招聘页面 JD 抓取：只做「服务端代抓 + 正文提取」，不写库、不调用任何外部服务。
 * 安全边界：仅 http/https、仅公网地址（解析后校验，防内网/回环）、最多 3 次重定向、
 * 10 秒总超时、1.5 MB 响应上限、仅接受 HTML。
 */

const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const MAX_JD_CHARS = 12_000;
const ALLOWED_PORTS = new Set(['', '80', '443', '8000', '8080', '8443']);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** JD 识别关键词：中英文常见小节标题。 */
const JD_MARKERS = [
  '岗位职责',
  '工作职责',
  '职位描述',
  '职位详情',
  '岗位描述',
  '岗位要求',
  '任职要求',
  '任职资格',
  '工作内容',
  '职位要求',
  'Responsibilities',
  'Requirements',
  'Qualifications',
  "What you'll do",
  'What you’ll do',
  'About the role',
  'The role',
  'Job Description',
  'Key responsibilities',
  'You will',
];

/** 到这些标记后通常不再是 JD 正文，提前截断。 */
const STOP_MARKERS = [
  'Apply for this job',
  'Submit application',
  'Create a Job Alert',
  'Similar Jobs',
  'Powered by',
  '隐私政策',
  '推荐职位',
  '相关职位',
  '公司简介',
  '关于我们',
  '投递简历',
  '立即申请',
];

const LOGIN_MARKERS = ['请登录', '登录后查看', '登录后继续', '安全验证', '人机验证', '滑动验证', '验证码', '访问受限'];

export interface JdFetchResult {
  jd: string;
  title: string;
  finalUrl: string;
  httpStatus: number;
  chars: number;
  truncated: boolean;
}

function fence(status: number, message: string, code: string): HttpError {
  return new HttpError(status, message, code);
}

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return (
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 192 && p[1] === 0 && (p[2] === 0 || p[2] === 2)) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
    p[0] >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().split('%')[0];
  if (s === '::1' || s === '::') return true;
  if (/^f[cd]/.test(s)) return true; // fc00::/7 唯一本地地址
  if (/^fe[89ab]/.test(s)) return true; // fe80::/10 链路本地
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) {
    return true;
  }
  const bare = h.replace(/^\[|\]$/g, '');
  const family = net.isIP(bare);
  if (family === 4) return isPrivateIPv4(bare);
  if (family === 6) return isPrivateIPv6(bare);
  return false;
}

async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw fence(400, '只支持 http/https 链接，请检查后重试。', 'URL_SCHEME');
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    throw fence(400, '该链接使用了不常见的端口，出于安全考虑已拒绝；请使用默认端口或直接粘贴 JD 正文。', 'URL_PORT');
  }
  if (u.username || u.password) {
    throw fence(400, '链接里不能包含账号密码，请去掉后重试。', 'URL_CREDENTIALS');
  }
  if (isBlockedHost(u.hostname)) {
    throw fence(400, '出于安全考虑，只能抓取公网页面，内网、本机或局域网地址已拒绝。', 'URL_FORBIDDEN');
  }
  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
  } catch {
    throw fence(422, `无法解析域名「${u.hostname}」，请检查链接是否正确。`, 'DNS_FAILED');
  }
  if (!records.length) {
    throw fence(422, `无法解析域名「${u.hostname}」，请检查链接是否正确。`, 'DNS_FAILED');
  }
  for (const r of records) {
    if (r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address)) {
      throw fence(400, '该域名解析到了内网/本机地址，出于安全考虑已拒绝抓取。', 'URL_FORBIDDEN');
    }
  }
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    middot: '·',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    ldquo: '“',
    rdquo: '”',
    lsquo: '‘',
    rsquo: '’',
    copy: '©',
    reg: '®',
    trade: '™',
    emsp: ' ',
    ensp: ' ',
    thinsp: ' ',
    bull: '•',
    times: '×',
    divide: '÷',
    deg: '°',
    plusmn: '±',
    yen: '¥',
    euro: '€',
  };
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const n = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return named[body.toLowerCase()] ?? all;
  });
}

function htmlToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|svg|iframe|canvas|form|nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pickMainHtml(html: string): string {
  for (const tag of ['main', 'article']) {
    const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (m) {
      const text = htmlToText(m[1]);
      if (text.replace(/\s/g, '').length >= 200) return m[1];
    }
  }
  return html;
}

function pageTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() : '';
}

function extractJd(html: string): { text: string; title: string; truncated: boolean } {
  const title = pageTitle(html).slice(0, 120);
  const text = htmlToText(pickMainHtml(html));
  if (!text) {
    throw fence(422, '页面正文为空，可能由脚本动态渲染或需要登录；请手动复制 JD 粘贴。', 'UNRECOGNIZED');
  }

  const lower = text.toLowerCase();
  let start = -1;
  for (const marker of JD_MARKERS) {
    const i = lower.indexOf(marker.toLowerCase());
    if (i >= 0 && (start < 0 || i < start)) start = i;
  }
  if (start < 0) {
    const probe = text.slice(0, 400);
    if (LOGIN_MARKERS.some((m) => probe.includes(m))) {
      throw fence(422, '该页面需要登录或正在做安全验证，抓不到公开正文；请登录后复制 JD，或直接粘贴文字。', 'LOGIN_OR_BLOCKED');
    }
    throw fence(422, '没有识别到「岗位职责 / 任职要求」等 JD 正文，可能页面需要登录或内容由脚本加载；请手动粘贴。', 'UNRECOGNIZED');
  }

  // 从关键词所在行的行首开始，避免把上一段切成半句话。
  const lineStart = text.lastIndexOf('\n', start);
  let body = text.slice(lineStart >= 0 ? lineStart + 1 : 0);
  for (const stop of STOP_MARKERS) {
    const i = body.toLowerCase().indexOf(stop.toLowerCase());
    if (i > 300) body = body.slice(0, i);
  }
  body = body.replace(/\n{3,}/g, '\n\n').trim();

  if (body.replace(/\s/g, '').length < 80) {
    throw fence(422, '识别到的正文过短，无法作为 JD；请手动粘贴完整内容。', 'UNRECOGNIZED');
  }
  const truncated = body.length > MAX_JD_CHARS;
  if (truncated) body = body.slice(0, MAX_JD_CHARS);
  return { text: body, title, truncated };
}

function charsetOf(contentType: string | null, bytes: Buffer): string {
  const fromHeader = contentType?.match(/charset\s*=\s*["']?([\w-]+)/i);
  if (fromHeader) return fromHeader[1].toLowerCase();
  const head = bytes.subarray(0, 4096).toString('latin1');
  const meta =
    head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i) ||
    head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i);
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

function decodeHtml(bytes: Buffer, contentType: string | null): string {
  const label = charsetOf(contentType, bytes);
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw fence(413, '页面体积超过 1.5 MB，已停止抓取；请直接粘贴需要的 JD 片段。', 'TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export async function fetchJdFromUrl(raw: string): Promise<JdFetchResult> {
  let current: URL;
  try {
    current = new URL(raw.trim());
  } catch {
    throw fence(400, '请输入完整的招聘页面链接（以 http:// 或 https:// 开头）。', 'URL_INVALID');
  }

  const deadline = Date.now() + TIMEOUT_MS;
  let redirects = 0;
  const visited = new Set<string>();

  for (;;) {
    await assertPublicUrl(current);
    if (visited.has(current.href)) {
      throw fence(422, '链接发生了循环重定向，已停止抓取。', 'REDIRECT_LOOP');
    }
    visited.add(current.href);

    const left = deadline - Date.now();
    if (left <= 0) {
      throw fence(504, '抓取超时（10 秒），目标站点响应过慢；请稍后重试或直接粘贴 JD。', 'TIMEOUT');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    let res: Response;
    try {
      res = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
        },
      });
    } catch (e) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw fence(504, '抓取超时（10 秒），目标站点响应过慢；请稍后重试或直接粘贴 JD。', 'TIMEOUT');
      }
      const reason = e instanceof Error ? e.message : String(e);
      throw fence(422, `无法访问该页面（${reason}），请检查链接或稍后重试。`, 'FETCH_FAILED');
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      clearTimeout(timer);
      const location = res.headers.get('location');
      if (!location) throw fence(422, '目标站点返回了不完整的中转响应（缺少 Location），无法继续。', 'REDIRECT_INVALID');
      redirects += 1;
      if (redirects > MAX_REDIRECTS) {
        throw fence(422, '重定向次数超过 3 次，已停止抓取；请使用最终页面链接。', 'TOO_MANY_REDIRECTS');
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw fence(422, '目标站点的跳转地址无效，已停止抓取。', 'REDIRECT_INVALID');
      }
      current = next;
      continue;
    }

    try {
      if (!res.ok) {
        clearTimeout(timer);
        if (res.status === 401 || res.status === 403) {
          throw fence(422, `页面需要登录或被反爬拦截（HTTP ${res.status}），抓不到公开正文；请复制 JD 粘贴到下方。`, 'LOGIN_OR_BLOCKED');
        }
        if (res.status === 404 || res.status === 410) {
          throw fence(422, `页面不存在或已下线（HTTP ${res.status}），请检查链接。`, 'NOT_FOUND');
        }
        if (res.status === 429) {
          throw fence(422, '目标站点限制了访问频率（HTTP 429），请稍后重试或直接粘贴 JD。', 'RATE_LIMITED');
        }
        if (res.status >= 500) {
          throw fence(422, `目标站点暂时不可用（HTTP ${res.status}），请稍后重试。`, 'UPSTREAM_ERROR');
        }
        throw fence(422, `目标站点返回了 HTTP ${res.status}，无法读取页面。`, 'HTTP_ERROR');
      }

      const type = res.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
        throw fence(422, `链接返回的不是网页（${type || '未知类型'}），无法提取 JD。`, 'NOT_HTML');
      }

      const bytes = await readCapped(res);
      if (!bytes.length) {
        throw fence(422, '页面内容为空，抓取失败；请手动粘贴 JD。', 'EMPTY');
      }
      const html = decodeHtml(bytes, type);
      const extracted = extractJd(html);
      return {
        jd: extracted.text,
        title: extracted.title,
        finalUrl: current.href,
        httpStatus: res.status,
        chars: extracted.text.replace(/\s/g, '').length,
        truncated: extracted.truncated,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
