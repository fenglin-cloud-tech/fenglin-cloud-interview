import type { Dossier, Session } from '../types';
import { PRESET_LABEL, formatDateTime } from './format';

/**
 * MOD-11：分享快照。
 *
 * 生成完全自包含的 HTML：内联 CSS、无脚本、无外链、无服务端链接。
 * 对方离线双击即可打开；同时明确提示文件中可能包含个人信息。
 */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f4f1ea;color:#1d2024;font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.sheet{max-width:900px;margin:32px auto;background:#fffdf8;border:1px solid #e3ded2;box-shadow:0 18px 50px rgba(29,32,36,.08);padding:44px 52px}
header{border-bottom:2px solid #1d2024;padding-bottom:16px;margin-bottom:24px}
.brand{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.16em;color:#2c7a7b;text-transform:uppercase}
h1{font-size:28px;line-height:1.25;margin:8px 0 6px;letter-spacing:-.01em}
.meta{font-size:12px;color:#6d6a62}
.notice{margin:18px 0 26px;padding:10px 14px;border:1px solid #ecd9a8;background:#fff8e6;color:#7a5a11;font-size:12px;border-radius:2px}
h2{font-size:17px;margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid #e3ded2}
h3{font-size:14px;margin:18px 0 6px}
ul{margin:6px 0;padding-left:20px}
li{margin:3px 0}
.score{display:flex;gap:26px;align-items:baseline;padding:14px 0;border-bottom:1px dashed #e3ded2}
.score b{font-size:44px;line-height:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.score span{font-size:12px;color:#6d6a62}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.box{border:1px solid #e3ded2;padding:12px 14px;background:#faf8f2}
.box em{display:block;font-style:normal;font-size:11px;color:#6d6a62;letter-spacing:.06em}
.box strong{display:block;font-size:15px;margin-top:2px}
.qa{border:1px solid #e3ded2;margin:12px 0;padding:14px 16px;background:#fff}
.qa .q{font-weight:600;margin:0 0 8px}
.qa .a{white-space:pre-wrap;word-break:break-word;color:#333;margin:0;padding-left:10px;border-left:2px solid #ece7db}
.tags{font-size:11px;color:#2c7a7b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.muted{color:#6d6a62}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.pre{white-space:pre-wrap;word-break:break-word;background:#faf8f2;border:1px solid #e3ded2;padding:14px;font-size:12.5px}
footer{margin-top:34px;padding-top:12px;border-top:1px solid #e3ded2;font-size:11px;color:#8a867c}
@media print{body{background:#fff}.sheet{box-shadow:none;border:0;margin:0;max-width:none;padding:0 8mm}}
@media(max-width:720px){.sheet{margin:0;padding:24px 18px}.grid{grid-template-columns:1fr}}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(
    title,
  )}</title><style>${CSS}</style></head><body><main class="sheet">${body}<footer>由「丰麟云面」本地生成 · 本文件不包含任何服务端链接，离线可读。个人信息请仅分享给可信对象。</footer></main></body></html>`;
}

const NOTICE = `<div class="notice">隐私提示：本快照包含简历 / 面试原文，可能含姓名、学校、项目等个人信息。请确认接收方可信后再发送；文件本身可离线打开。</div>`;

function list(items: string[], fallback = '暂无'): string {
  if (!items.length) return `<p class="muted">${esc(fallback)}</p>`;
  return `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
}

export function buildInterviewShareHtml(session: Session): string {
  const iv = session.interview;
  const report = iv.report;
  const answered = session.turns.filter((t) => t.answer);
  const meta = [
    session.job?.title || '未关联岗位',
    session.resume?.title ? `简历：${session.resume.title}` : '',
    formatDateTime(iv.started_at),
    iv.language === 'en' ? 'English interview' : '中文面试',
    PRESET_LABEL[iv.preset || 'standard'] || '标准面',
  ]
    .filter(Boolean)
    .map((x) => esc(x))
    .join(' · ');

  const scoreBlock = report
    ? `<div class="score"><b>${esc(report.overallScore)}</b><div><strong>综合得分</strong><br><span>${esc(
        report.summary.split('\n')[0] || '',
      )}</span></div></div>`
    : '';

  const rounds = report
    ? `<h2>各轮得分</h2><ul>${report.roundScores
        .map((r) => `<li><strong>${esc(r.round)}</strong> · <span class="mono">${esc(r.score)}</span> 分 — ${esc(r.comment)}</li>`)
        .join('')}</ul>`
    : '';

  const qa = answered
    .map((t) => {
      const fb = t.feedback;
      const dims = fb
        ? `<p class="tags">结构 ${esc(fb.scores.structure)} · 内容 ${esc(fb.scores.content)} · 表达 ${esc(
            fb.scores.expression,
          )} · 本题 ${esc(t.score ?? '—')}</p>`
        : '';
      const details = fb
        ? `${fb.summary ? `<p>${esc(fb.summary)}</p>` : ''}${fb.issues?.length ? `<p class="muted">待改：${esc(fb.issues.join('；'))}</p>` : ''}${
            fb.improvedAnswer ? `<p class="muted">改进示范：${esc(fb.improvedAnswer)}</p>` : ''
          }`
        : '';
      return `<div class="qa"><p class="q">${esc(t.round_key)}${t.depth ? ` · 追问 ${t.depth}` : ''}｜${esc(
        t.question,
      )}</p><p class="a">${esc(t.answer)}</p>${dims}${details}</div>`;
    })
    .join('');

  const body = `<header><div class="brand">Fenglin Cloud Interview · Mock Interview Report</div><h1>${esc(
    session.job?.title || '模拟面试报告',
  )}</h1><div class="meta">${meta}</div></header>${NOTICE}${scoreBlock}
  ${rounds}
  <h2>薄弱环节</h2>${list(report?.weaknesses || [])}
  <h2>建议复习点</h2>${list(report?.reviewPoints || [])}
  <h2>问答记录（${answered.length} 题）</h2>${qa || '<p class="muted">暂无作答记录。</p>'}`;

  return page(`面试报告 · ${session.job?.title || iv.id}`, body);
}

export function buildDossierShareHtml(dossier: Dossier): string {
  const p = dossier.profile;
  const profileLine = [p.nickname, p.school, p.major, p.grade].filter(Boolean).map((x) => esc(x)).join(' · ');
  const match = dossier.match
    ? `<div class="box"><em>JD 匹配度</em><strong class="mono">${esc(dossier.match.score)} / 100</strong><p>${esc(
        dossier.match.verdict,
      )}</p></div>`
    : '';
  const latest = dossier.latest
    ? `<h2>最近一场面试</h2><div class="grid"><div class="box"><em>得分</em><strong class="mono">${esc(
        dossier.latest.overallScore,
      )}</strong></div><div class="box"><em>时间</em><strong>${esc(
        formatDateTime(dossier.latest.startedAt),
      )}</strong></div></div><p>${esc(dossier.latest.summary)}</p><h3>薄弱环节</h3>${list(
        dossier.latest.weaknesses,
      )}`
    : '<h2>最近一场面试</h2><p class="muted">暂无已完成的面试报告。</p>';

  const interviews = dossier.interviews.length
    ? `<ul>${dossier.interviews
        .map((i) => `<li>${esc(formatDateTime(i.startedAt))} · ${esc(i.jobTitle || '未关联岗位')} · <span class="mono">${esc(i.overallScore)}</span> 分</li>`)
        .join('')}</ul>`
    : '<p class="muted">暂无面试记录。</p>';

  const weak = dossier.bank.items.length
    ? `<ul>${dossier.bank.items
        .map((b) => `<li>${esc(b.question)} <span class="tags">${esc(b.category)} · 最近 ${esc(b.last_score ?? '—')} 分</span></li>`)
        .join('')}</ul>`
    : '<p class="muted">暂无薄弱题。</p>';

  const body = `<header><div class="brand">Fenglin Cloud Interview · Job Dossier</div><h1>求职档案 · ${
    profileLine || '未填写档案'
  }</h1><div class="meta">${esc(dossier.scope.label)} · 生成于 ${esc(
    formatDateTime(dossier.generatedAt),
  )}</div></header>${NOTICE}
  <h2>目标岗位</h2>${
    dossier.job
      ? `<div class="grid"><div class="box"><em>岗位</em><strong>${esc(dossier.job.title)}</strong></div><div class="box"><em>公司</em><strong>${esc(
          dossier.job.company || '—',
        )}</strong></div></div><p class="muted">JD 摘要：${esc(dossier.job.jd.slice(0, 800))}</p>`
      : '<p class="muted">未关联目标岗位。</p>'
  }
  ${match}
  <h2>简历摘要</h2>${
    dossier.resume
      ? `<div class="pre">${esc(dossier.resume.content.slice(0, 5000))}</div>`
      : '<p class="muted">暂无简历。</p>'
  }
  ${latest}
  <h2>面试记录（${dossier.interviews.length} 场）</h2>${interviews}
  <h2>成长趋势</h2><p>累计完成 <strong class="mono">${esc(
    dossier.growth.totalFinished,
  )}</strong> 场面试；当前范围 ${esc(dossier.growth.count)} 场，最高分 <span class="mono">${esc(
    dossier.growth.points.length ? Math.max(...dossier.growth.points.map((x) => x.score)) : '—',
  )}</span>。</p>
  <h2>题库与薄弱项</h2><p>题库 ${esc(dossier.bank.total)} 道，薄弱 ${esc(
    dossier.bank.weak,
  )} 道；复盘 ${esc(dossier.reviews.total)} 条。</p>${weak}`;

  return page(`求职档案 · ${p.nickname || p.school || '丰麟云面'}`, body);
}

export function downloadShareHtml(filename: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const SHARE_PRIVACY_CONFIRM =
  '分享快照会包含简历 / 面试原文，可能含姓名、学校、项目等个人信息。确认仅发送给可信对象？';
