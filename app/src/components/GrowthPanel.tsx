import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GrowthDims, GrowthGroup, GrowthPoint, GrowthRadarSide, GrowthStats } from '../types';
import { Card } from './ui';

/**
 * 能力成长面板：总分趋势 + 结构/内容/表达三维雷达。
 * 只用后端聚合的真实评分（interview.overall_score 与各题 feedback.scores），不插值、不补造数据。
 */

const DIMS = [
  { key: 'structure', label: '结构' },
  { key: 'content', label: '内容' },
  { key: 'expression', label: '表达' },
] as const;

function sameDay(points: GrowthPoint[]): boolean {
  if (!points.length) return false;
  const first = new Date(points[0].startedAt);
  return points.every((p) => {
    const d = new Date(p.startedAt);
    return (
      d.getFullYear() === first.getFullYear() && d.getMonth() === first.getMonth() && d.getDate() === first.getDate()
    );
  });
}

function axisLabel(iso: string, day: boolean, seconds = false): string {
  const d = new Date(iso);
  if (!day) return `${d.getMonth() + 1}/${d.getDate()}`;
  const base = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  // 同一天多场且分钟相同（连续自测）时补秒，避免横轴标签完全一样
  return seconds ? `${base}:${String(d.getSeconds()).padStart(2, '0')}` : base;
}

function fullLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

/* ---------------- 总分趋势 ---------------- */

function TrendChart({ points }: { points: GrowthPoint[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setWidth(Math.max(240, Math.round(cw)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 236;
  const pad = { l: 34, r: 18, t: 22, b: 38 };
  const innerW = Math.max(40, width - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;
  const n = points.length;
  const xFor = (i: number) => pad.l + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const yFor = (v: number) => pad.t + (1 - Math.max(0, Math.min(100, v)) / 100) * innerH;
  const day = sameDay(points);
  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 72))));
  const plainLabels = points.map((p) => axisLabel(p.startedAt, day));
  const withSeconds = new Set(plainLabels).size < plainLabels.length;
  const labels = withSeconds ? points.map((p) => axisLabel(p.startedAt, day, true)) : plainLabels;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.score).toFixed(1)}`).join(' ');
  const baseY = pad.t + innerH;
  const area = `${line} L${xFor(n - 1).toFixed(1)},${baseY} L${xFor(0).toFixed(1)},${baseY} Z`;

  return (
    <div ref={hostRef} className="growth-svg-host">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="growth-svg"
          role="img"
          aria-label={`共 ${n} 场已完成面试的总分趋势`}
        >
          <defs>
            <linearGradient id="growth-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line className="growth-grid-line" x1={pad.l} y1={yFor(v)} x2={width - pad.r} y2={yFor(v)} />
              <text className="growth-tick" x={pad.l - 8} y={yFor(v) + 3.5} textAnchor="end">
                {v}
              </text>
            </g>
          ))}

          <path d={area} fill="url(#growth-area)" />
          <path d={line} className="growth-line" />

          {points.map((p, i) => (
            <g key={p.id}>
              <circle
                className={i === n - 1 ? 'growth-dot last' : 'growth-dot'}
                cx={xFor(i)}
                cy={yFor(p.score)}
                r={i === n - 1 ? 4.6 : 3.6}
              >
                <title>{`${fullLabel(p.startedAt)} · ${p.score} 分`}</title>
              </circle>
              <text
                className="growth-val"
                x={xFor(i)}
                y={yFor(p.score) - 10 < pad.t - 4 ? yFor(p.score) + 16 : yFor(p.score) - 10}
                textAnchor="middle"
              >
                {p.score}
              </text>
              {(i % labelStep === 0 || i === n - 1) && (
                <text
                  className="growth-xlabel"
                  x={xFor(i)}
                  y={baseY + 19}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                >
                  {labels[i]}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

function TrendEmpty({ point }: { point?: GrowthPoint }) {
  return (
    <div className="growth-empty-panel">
      <div className="growth-empty-score">
        {point ? point.score : '—'}
        <i>分</i>
      </div>
      <div>
        <strong>再练一场就能看到趋势</strong>
        <p>
          {point
            ? `当前分组只有 1 场已完成面试（${fullLabel(point.startedAt)}）。`
            : '当前分组还没有可用的总分。'}
          完成第二场后，这里会按时间画出真实曲线，不做任何补造。
        </p>
        <Link className="link" to="/interviews">
          去再练一场 →
        </Link>
      </div>
    </div>
  );
}

/* ---------------- 三维雷达 ---------------- */

function Radar({ radar }: { radar: GrowthGroup['radar'] }) {
  const { early, recent } = radar;
  const cx = 140;
  const cy = 114;
  const R = 74;
  const angle = (i: number) => ((-90 + i * 120) * Math.PI) / 180;
  const at = (r: number, i: number): [number, number] => [
    cx + Math.cos(angle(i)) * r,
    cy + Math.sin(angle(i)) * r,
  ];
  const ring = (r: number) =>
    DIMS.map((_, i) => {
      const [x, y] = at(r, i);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  const shape = (side: GrowthRadarSide | null) =>
    side
      ? DIMS.map((d, i) => {
          const v = Math.max(0, Math.min(100, side.dims[d.key as keyof GrowthDims])) / 100;
          const [x, y] = at(R * v, i);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ')
      : '';

  if (!recent) {
    return (
      <div className="growth-empty-panel compact">
        <div>
          <strong>暂无三维评分</strong>
          <p>该分组的作答还没有结构 / 内容 / 表达评分，完成一场带反馈的面试后显示。</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <svg
        viewBox="0 0 280 228"
        className="radar-svg"
        role="img"
        aria-label={`结构 ${recent.dims.structure} 分、内容 ${recent.dims.content} 分、表达 ${recent.dims.expression} 分的能力雷达`}
      >
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon key={r} className="radar-ring" points={ring(R * r)} />
        ))}
        {DIMS.map((_, i) => {
          const [x, y] = at(R, i);
          return <line key={i} className="radar-axis" x1={cx} y1={cy} x2={x} y2={y} />;
        })}

        {early && <polygon className="radar-early" points={shape(early)} />}
        <polygon className="radar-recent" points={shape(recent)} />
        {DIMS.map((d, i) => {
          const v = Math.max(0, Math.min(100, recent.dims[d.key])) / 100;
          const [x, y] = at(R * v, i);
          return <circle key={d.key} className="radar-dot" cx={x} cy={y} r="2.6" />;
        })}

        {DIMS.map((d, i) => {
          const [x, y] = at(R + 22, i);
          const anchor = i === 0 ? 'middle' : i === 1 ? 'start' : 'end';
          return (
            <text key={d.key} className="radar-label" x={x} y={y + 4} textAnchor={anchor}>
              {d.label} {recent.dims[d.key]}
            </text>
          );
        })}
      </svg>
      <div className="radar-legend">
        <span>
          <i className="sw-recent" />
          近期 · {recent.label}
        </span>
        {early ? (
          <span>
            <i className="sw-early" />
            早期 · {early.label}
          </span>
        ) : (
          <span className="muted">再练一场即可形成前后对比</span>
        )}
      </div>
    </div>
  );
}

/* ---------------- 面板 ---------------- */

function pickDefault(groups: GrowthGroup[], activeJobId: number | null): GrowthGroup | null {
  if (!groups.length) return null;
  const byJob = groups.find((g) => g.jobId !== null && g.jobId === activeJobId);
  if (byJob && byJob.count >= 2) return byJob;
  const all = groups.find((g) => g.key === 'all');
  if (all && all.count >= 2) return all;
  return [...groups].sort((a, b) => b.count - a.count)[0];
}

export function GrowthPanel({ data, activeJobId }: { data: GrowthStats; activeJobId: number | null }) {
  const jobGroups = data.groups.filter((g) => g.key !== 'all');
  // 只有一个岗位分组时，「全部岗位」与它数据完全相同，不重复展示
  const visible = jobGroups.length > 1 ? data.groups : jobGroups;
  const [picked, setPicked] = useState('');
  const active = visible.find((g) => g.key === picked) || pickDefault(visible, activeJobId);

  if (!active) {
    return (
      <Card
        title="能力成长"
        subtitle="用已完成面试的总分看趋势，用结构 / 内容 / 表达三维看短板。"
        className="growth-card"
      >
        <div className="growth-empty">
          <strong>还没有已完成的面试</strong>
          <p>完成第一场并生成报告后，这里会出现成长曲线；完成两场后开始显示趋势。</p>
          <Link className="link" to="/interviews">
            去开一场面试 →
          </Link>
        </div>
      </Card>
    );
  }

  const last = active.points[active.points.length - 1];
  const best = Math.max(...active.points.map((p) => p.score));

  return (
    <Card
      title="能力成长"
      subtitle="按已完成面试的真实评分聚合：总分看趋势，三维看短板；同一目标岗位可单独对比。"
      className="growth-card"
      extra={visible.length > 1 ? <span className="growth-count">{data.totalFinished} 场已完成</span> : undefined}
    >
      {visible.length > 1 && (
        <div className="growth-tabs" role="tablist" aria-label="按岗位分组查看能力成长">
          {visible.map((g) => (
            <button
              key={g.key}
              role="tab"
              aria-selected={active.key === g.key}
              className={`growth-tab ${active.key === g.key ? 'on' : ''}`}
              onClick={() => setPicked(g.key)}
            >
              {g.label}
              <i>{g.count}</i>
            </button>
          ))}
        </div>
      )}

      <div className="growth-grid">
        <div className="growth-chart">
          <div className="growth-chart-head">
            <span className="growth-chart-title">总分趋势</span>
            <span className="growth-chart-meta">
              {active.count} 场 · 最新 {last.score} · 最高 {best}
            </span>
          </div>
          {active.points.length >= 2 ? <TrendChart points={active.points} /> : <TrendEmpty point={active.points[0]} />}
          <p className="growth-note">
            口径：每个点是一场已完成面试的报告总分（面试结束时写入），按开始时间从左到右排列。
          </p>
        </div>

        <div className="growth-radar">
          <div className="growth-chart-head">
            <span className="growth-chart-title">三维能力雷达</span>
            <span className="growth-chart-meta">满分 100</span>
          </div>
          <Radar radar={active.radar} />
          <p className="growth-note">
            口径：单场取该场已作答题目三维评分的平均值；按时间排序后，前半为早期、后半为近期。
          </p>
        </div>
      </div>
    </Card>
  );
}
