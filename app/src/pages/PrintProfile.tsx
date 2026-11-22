import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Dossier, GrowthDims, GrowthRadarSide } from '../types';
import { formatDate, formatDateTime } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';

/** 求职档案打印视图：封面 + 分段内页，A4 分页防截断。数据全部来自本机真实记录。 */
export function PrintProfile() {
  const [params] = useSearchParams();
  const [data, setData] = useState<Dossier | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .dossier()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setError('加载求职档案失败，请确认后端已启动');
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || error || params.get('auto') !== '1') return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loaded, error, params]);

  return (
    <div className="print-page">
      <div className="print-actions">
        <button type="button" className="btn btn-ink" onClick={() => window.print()}>
          打印 / 另存为 PDF
        </button>
        <a className="btn btn-ghost" href="/api/dossier/docx">
          下载 Word
        </a>
        <a className="btn btn-ghost" href="/">
          返回训练台
        </a>
      </div>
      {error && <p className="print-error">{error}</p>}
      {!error && !data && <p className="print-muted">正在汇总本机数据…</p>}
      {data && <article className="print-sheet dossier">{<DossierBody data={data} />}</article>}
    </div>
  );
}

function DossierBody({ data }: { data: Dossier }) {
  const { profile, job, resume, match } = data;
  const name = profile.nickname || '未填写姓名';
  const person = [profile.school, profile.major, profile.grade].filter(Boolean).join(' · ') || '档案信息未填写';
  const completed = data.growth.totalFinished;
  const scores = data.growth.points.map((p) => p.score);
  const latestScore = scores.length ? scores[scores.length - 1] : null;
  const bestScore = scores.length ? Math.max(...scores) : null;
  const jd = job?.jd?.trim() || '';
  const jdShown = jd.length > 900 ? `${jd.slice(0, 900)}…（JD 原文较长，此处截取前 900 字）` : jd;

  return (
    <>
      <section className="dossier-cover">
        <div className="dc-top">
          <span className="dc-brand">
            <img src="/brand/logo.png" alt="丰麟云面" />
            丰麟云面 · FENGLIN CLOUD INTERVIEW
          </span>
          <span className="dc-no">NO. {formatDate(data.generatedAt).replace(/\./g, '')}</span>
        </div>
        <div className="dc-main">
          <div className="dc-kicker">JOB-SEEKING DOSSIER / 答辩材料</div>
          <h1 className="dc-title">求职能力档案</h1>
          <p className="dc-person">
            <strong>{name}</strong>
            <span>{person}</span>
          </p>
          <div className="dc-target">
            <span>目标岗位</span>
            <strong>{job ? `${job.title}${job.company ? ` · ${job.company}` : ''}` : '暂无'}</strong>
          </div>
          <dl className="dc-facts">
            <div>
              <dt>生成日期</dt>
              <dd>{formatDate(data.generatedAt)}</dd>
            </div>
            <div>
              <dt>已完成面试</dt>
              <dd>{completed} 场</dd>
            </div>
            <div>
              <dt>简历</dt>
              <dd>{resume?.title || '暂无'}</dd>
            </div>
            <div>
              <dt>数据口径</dt>
              <dd>{data.scope.label}</dd>
            </div>
          </dl>
        </div>
        <div className="dc-foot">
          本档案由丰麟云面根据本机保存的简历、岗位、JD 匹配、面试报告、复盘与题库记录自动汇总；所有数字均来自真实数据，缺失板块标注「暂无」。
        </div>
      </section>

      <section className="dossier-section">
        <SectionHead no="01" title="个人与目标岗位" />
        <div className="ds-grid-2">
          <div className="ds-block">
            <h3>个人信息</h3>
            <dl className="ds-kv">
              <div><dt>姓名</dt><dd>{profile.nickname || '未填写'}</dd></div>
              <div><dt>学校</dt><dd>{profile.school || '未填写'}</dd></div>
              <div><dt>专业</dt><dd>{profile.major || '未填写'}</dd></div>
              <div><dt>年级</dt><dd>{profile.grade || '未填写'}</dd></div>
            </dl>
          </div>
          <div className="ds-block">
            <h3>目标岗位</h3>
            {job ? (
              <dl className="ds-kv">
                <div><dt>岗位</dt><dd>{job.title}</dd></div>
                <div><dt>公司</dt><dd>{job.company || '未填写'}</dd></div>
                <div><dt>关联简历</dt><dd>{resume?.title || '暂无'}</dd></div>
                <div><dt>简历更新</dt><dd>{resume ? formatDate(resume.updated_at) : '暂无'}</dd></div>
              </dl>
            ) : (
              <p className="ds-empty">暂无目标岗位，先到「目标岗位」创建并关联 JD。</p>
            )}
          </div>
        </div>

        <div className="ds-block">
          <h3>JD 原文</h3>
          {jdShown ? <p className="ds-pre">{jdShown}</p> : <p className="ds-empty">暂无 JD 内容。</p>}
        </div>

        <div className="ds-block">
          <h3>
            JD 匹配结果
            {match?.created_at && <span className="ds-side">{formatDateTime(match.created_at)}</span>}
          </h3>
          {match ? (
            <>
              <div className="ds-match-top">
                <div className="ds-score">
                  <strong>{match.score}</strong>
                  <span>匹配分</span>
                </div>
                <p className="ds-verdict">{match.verdict}</p>
              </div>
              {match.covered?.length ? (
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>岗位要求</th>
                      <th className="col-st">覆盖</th>
                      <th>简历证据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {match.covered.slice(0, 6).map((c, i) => (
                      <tr key={i}>
                        <td>{c.requirement}</td>
                        <td className="col-st">{c.status === 'covered' ? '已覆盖' : c.status === 'partial' ? '部分' : '缺失'}</td>
                        <td>{c.evidence || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="ds-empty">这次匹配没有返回逐条覆盖项。</p>
              )}
              <div className="ds-two-col">
                <div>
                  <h4>缺失关键词</h4>
                  {match.missingKeywords?.length ? (
                    <p className="ds-inline-list">{match.missingKeywords.join('、')}</p>
                  ) : (
                    <p className="ds-empty">暂无缺失关键词。</p>
                  )}
                </div>
                <div>
                  <h4>改进建议</h4>
                  {match.actions?.length ? (
                    <ul className="ds-list">
                      {match.actions.slice(0, 5).map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ds-empty">暂无建议。</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="ds-empty">暂无 JD 匹配记录，先到「简历优化」做一次 JD 匹配诊断。</p>
          )}
        </div>
      </section>

      <section className="dossier-section">
        <SectionHead no="02" title="简历要点" />
        {resume ? (
          <>
            <div className="ds-block-head">
              <h3>{resume.title}</h3>
              <span className="ds-side">更新于 {formatDate(resume.updated_at)}</span>
            </div>
            <div className="markdown-body print-body dossier-resume">{renderMarkdown(resume.content)}</div>
          </>
        ) : (
          <p className="ds-empty">暂无简历。</p>
        )}
      </section>

      <section className="dossier-section">
        <SectionHead no="03" title="面试成绩" />
        <p className="ds-note">
          口径：{data.scope.label}的已完成面试，总分取报告总分，三维取该场已作答题目反馈评分的平均值（满分 100）。
        </p>
        {data.interviews.length ? (
          <table className="ds-table">
            <thead>
              <tr>
                <th>日期</th>
                <th className="col-num">总分</th>
                <th className="col-num">结构</th>
                <th className="col-num">内容</th>
                <th className="col-num">表达</th>
              </tr>
            </thead>
            <tbody>
              {data.interviews.map((iv) => (
                <tr key={iv.id}>
                  <td>
                    {formatDate(iv.startedAt)}
                    {iv.jobTitle ? <span className="ds-sub"> · {iv.jobTitle}</span> : null}
                  </td>
                  <td className="col-num">{iv.overallScore}</td>
                  <td className="col-num">{iv.dims ? iv.dims.structure : '—'}</td>
                  <td className="col-num">{iv.dims ? iv.dims.content : '—'}</td>
                  <td className="col-num">{iv.dims ? iv.dims.expression : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ds-empty">暂无已完成的面试成绩。</p>
        )}

        <div className="ds-block">
          <h3>最近一场各轮得分</h3>
          {data.latest ? (
            <>
              <div className="ds-block-head">
                <span className="ds-side">
                  {formatDateTime(data.latest.startedAt)} · 总分 {data.latest.overallScore}
                </span>
              </div>
              {data.latest.roundScores.length ? (
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>轮次</th>
                      <th className="col-num">得分</th>
                      <th>点评</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.latest.roundScores.map((r, i) => (
                      <tr key={i}>
                        <td>{r.round}</td>
                        <td className="col-num">{r.score}</td>
                        <td>{r.comment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="ds-empty">这场报告没有分轮得分。</p>
              )}
              {data.latest.summary && <p className="ds-pre">{data.latest.summary}</p>}
              <div className="ds-two-col">
                <div>
                  <h4>薄弱环节</h4>
                  {data.latest.weaknesses.length ? (
                    <ul className="ds-list">
                      {data.latest.weaknesses.slice(0, 4).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ds-empty">暂无。</p>
                  )}
                </div>
                <div>
                  <h4>建议复习点</h4>
                  {data.latest.reviewPoints.length ? (
                    <ul className="ds-list">
                      {data.latest.reviewPoints.slice(0, 4).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ds-empty">暂无。</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="ds-empty">暂无面试报告。</p>
          )}
        </div>
      </section>

      <section className="dossier-section">
        <SectionHead no="04" title="复盘与题库薄弱项" />
        <div className="ds-stats">
          <div><strong>{data.reviews.total}</strong><span>复盘记录</span></div>
          <div><strong>{data.bank.total}</strong><span>题库题目</span></div>
          <div><strong>{data.bank.weak}</strong><span>薄弱项</span></div>
        </div>

        <div className="ds-block">
          <h3>最近复盘</h3>
          {data.reviews.items.length ? (
            <ul className="ds-reviews">
              {data.reviews.items.map((r) => (
                <li key={r.id}>
                  <div className="ds-review-head">
                    <span className="ds-review-q">{r.question}</span>
                    <span className="ds-rating">
                      {'★'.repeat(r.rating)}
                      {'☆'.repeat(5 - r.rating)}
                    </span>
                  </div>
                  <p>{r.improvement || '（未填写改进点）'}</p>
                  <span className="ds-side">
                    {formatDate(r.created_at)}
                    {r.tags ? ` · ${r.tags}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ds-empty">暂无复盘记录。</p>
          )}
        </div>

        <div className="ds-block">
          <h3>题库薄弱项{data.bank.weak > data.bank.items.length ? `（列前 ${data.bank.items.length} 条）` : ''}</h3>
          {data.bank.items.length ? (
            <table className="ds-table">
              <thead>
                <tr>
                  <th>题目</th>
                  <th className="col-cat">分类</th>
                  <th className="col-num">上次分</th>
                  <th className="col-num">练习</th>
                  <th className="col-date">下次复习</th>
                </tr>
              </thead>
              <tbody>
                {data.bank.items.map((b) => (
                  <tr key={b.id}>
                    <td>{b.question}</td>
                    <td className="col-cat">{b.category}</td>
                    <td className="col-num">{b.last_score ?? '—'}</td>
                    <td className="col-num">{b.ask_count} 次</td>
                    <td className="col-date">{b.next_review_at ? formatDate(b.next_review_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ds-empty">暂无薄弱项。</p>
          )}
        </div>
      </section>

      <section className="dossier-section dossier-section-page">
        <SectionHead no="05" title="成长趋势" />
        <div className="ds-stats">
          <div><strong>{data.growth.count}</strong><span>口径内已完成</span></div>
          <div><strong>{latestScore ?? '—'}</strong><span>最新总分</span></div>
          <div><strong>{bestScore ?? '—'}</strong><span>最高总分</span></div>
          <div><strong>{data.growth.radar.recent ? data.growth.radar.recent.dims.expression : '—'}</strong><span>近期表达</span></div>
        </div>
        <p className="ds-note">
          口径：{data.scope.label}，按面试开始时间排序；总分来自报告，雷达为该分组前/后半程三维均值。
        </p>

        <div className="ds-block">
          <h3>总分趋势</h3>
          {data.growth.points.length >= 2 ? (
            <TrendSvg points={data.growth.points} />
          ) : data.growth.points.length === 1 ? (
            <p className="ds-empty">再练一场就能看到趋势（当前 1 场，总分 {data.growth.points[0].score}）。</p>
          ) : (
            <p className="ds-empty">暂无成长数据。</p>
          )}
        </div>

        <div className="ds-block">
          <h3>三维能力雷达</h3>
          {data.growth.radar.recent ? (
            <div className="ds-radar-wrap">
              <RadarSvg radar={data.growth.radar} />
              <div className="ds-radar-legend">
                <p>
                  <i className="dot recent" /> 近期 · {data.growth.radar.recent.label}：结构 {data.growth.radar.recent.dims.structure} ·
                  内容 {data.growth.radar.recent.dims.content} · 表达 {data.growth.radar.recent.dims.expression}
                </p>
                {data.growth.radar.early ? (
                  <p>
                    <i className="dot early" /> 早期 · {data.growth.radar.early.label}：结构 {data.growth.radar.early.dims.structure} ·
                    内容 {data.growth.radar.early.dims.content} · 表达 {data.growth.radar.early.dims.expression}
                  </p>
                ) : (
                  <p className="ds-empty">只有 1 场带三维评分的面试，再练一场即可形成前后对比。</p>
                )}
              </div>
            </div>
          ) : (
            <p className="ds-empty">暂无三维评分。</p>
          )}
        </div>
      </section>

      <footer className="dossier-foot">
        <span>丰麟云面 · 求职能力档案</span>
        <span>生成时间 {formatDateTime(data.generatedAt)} · 数据仅存本机，未上传云端</span>
      </footer>
    </>
  );
}

function SectionHead({ no, title }: { no: string; title: string }) {
  return (
    <div className="ds-head">
      <span className="ds-num">{no}</span>
      <h2>{title}</h2>
      <span className="ds-rule" />
    </div>
  );
}

const DIMS = [
  { key: 'structure', label: '结构' },
  { key: 'content', label: '内容' },
  { key: 'expression', label: '表达' },
] as const;

function TrendSvg({ points }: { points: { startedAt: string; score: number }[] }) {
  const W = 660;
  const H = 190;
  const pad = { l: 30, r: 16, t: 22, b: 34 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = points.length;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => pad.t + (1 - Math.max(0, Math.min(100, v)) / 100) * ih;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${pad.t + ih} L${x(0).toFixed(1)},${pad.t + ih} Z`;
  return (
    <div className="ds-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`共 ${n} 场面试的总分趋势`}>
        <defs>
          <linearGradient id="ds-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a6e7c" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#2a6e7c" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} className="ds-grid" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="ds-tick">{v}</text>
          </g>
        ))}
        <path d={area} fill="url(#ds-area)" />
        <path d={line} className="ds-line" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.score)} r="3.2" className="ds-dot" />
            <text x={x(i)} y={y(p.score) - 9} textAnchor="middle" className="ds-val">{p.score}</text>
            {(n <= 6 || i === 0 || i === n - 1) && (
              <text x={x(i)} y={pad.t + ih + 20} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="ds-xlabel">
                {formatDate(p.startedAt).slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function RadarSvg({ radar }: { radar: { early: GrowthRadarSide | null; recent: GrowthRadarSide | null } }) {
  const { early, recent } = radar;
  if (!recent) return null;
  const cx = 120;
  const cy = 104;
  const R = 68;
  const angle = (i: number) => ((-90 + i * 120) * Math.PI) / 180;
  const at = (r: number, i: number): [number, number] => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];
  const ring = (r: number) =>
    DIMS.map((_, i) => {
      const [px, py] = at(r, i);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(' ');
  const shape = (side: GrowthRadarSide | null) =>
    side
      ? DIMS.map((d, i) => {
          const v = Math.max(0, Math.min(100, side.dims[d.key as keyof GrowthDims])) / 100;
          const [px, py] = at(R * v, i);
          return `${px.toFixed(1)},${py.toFixed(1)}`;
        }).join(' ')
      : '';
  return (
    <svg viewBox="0 0 240 220" className="ds-radar" role="img" aria-label="结构、内容、表达三维雷达">
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={ring(R * r)} className="ds-ring" />
      ))}
      {DIMS.map((_, i) => {
        const [px, py] = at(R, i);
        return <line key={i} x1={cx} y1={cy} x2={px} y2={py} className="ds-axis" />;
      })}
      {early && <polygon points={shape(early)} className="ds-early" />}
      <polygon points={shape(recent)} className="ds-recent" />
      {DIMS.map((d, i) => {
        const [px, py] = at(R + 24, i);
        const anchor = i === 0 ? 'middle' : i === 1 ? 'start' : 'end';
        return (
          <text key={d.key} x={px} y={py + 4} textAnchor={anchor} className="ds-rlabel">
            {d.label} {recent.dims[d.key]}
          </text>
        );
      })}
    </svg>
  );
}
