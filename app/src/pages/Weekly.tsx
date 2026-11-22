import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { WeeklyReport } from '../types';
import { formatDateTime } from '../lib/format';
import { openPrintView } from '../lib/download';
import {
  Button,
  Card,
  Chip,
  CopyButton,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSkeleton,
  Stat,
} from '../components/ui';

const STAGE_LABEL: Record<string, string> = {
  applied: '已投递',
  written: '笔试',
  interview1: '一面',
  interview2: '二面',
  hr: 'HR 面',
  offer: '已发 offer',
  rejected: '已拒',
  withdrawn: '自己放弃',
};

export function Weekly() {
  const { toast } = useApp();
  const [data, setData] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = (range?: { from: string; to: string }) => {
    setLoading(true);
    setError(null);
    api
      .weeklyReport(range)
      .then((r) => {
        setData(r);
        setFrom(r.from);
        setTo(r.to);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '周报生成失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const metrics = data?.metrics;
  const delta = metrics?.interviews.delta;

  return (
    <div className="page">
      <PageHeader
        eyebrow="数据回顾 · 周报"
        title="用一周的数据，决定下一周练什么"
        desc="聚合本周的模拟面试、投递阶段变化、复盘与题库沉淀。只读现有记录，不会改动任何数据。"
        actions={
          <div className="row gap-8 wrap">
            <Button size="sm" variant="quiet" onClick={() => load()}>
              刷新
            </Button>
            <Button
              size="sm"
              variant="ink"
              disabled={!data}
              onClick={() => data && openPrintView(`/print/weekly?from=${data.from}&to=${data.to}`)}
            >
              打印 / 存为 PDF
            </Button>
          </div>
        }
      />

      <div className="weekly-range">
        <label className="weekly-date">
          <span>开始</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="weekly-date">
          <span>结束</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button
          size="sm"
          onClick={() => {
            if (!from || !to) return toast('请选择完整的日期范围', 'err');
            if (from > to) return toast('开始日期不能晚于结束日期', 'err');
            load({ from, to });
          }}
        >
          生成周报
        </Button>
        <span className="muted small">默认本周一至今天</span>
      </div>

      {error && <ErrorState message={error} onRetry={() => load()} />}

      {loading && !data ? (
        <PageSkeleton variant="cards" label="正在汇总本周数据" />
      ) : !data || !metrics ? null : (
        <>
          <div className="stats-row">
            <Stat
              label="完成面试"
              value={metrics.interviews.finished}
              hint={`本周开始 ${metrics.interviews.started} 场`}
            />
            <Stat
              label="平均分"
              value={metrics.interviews.avgScore ?? '—'}
              hint={
                delta == null
                  ? '上一周期暂无可比数据'
                  : `较上一周期 ${delta >= 0 ? '+' : ''}${delta} 分`
              }
            />
            <Stat label="新增投递" value={metrics.applications.newCount} hint={`阶段推进 ${metrics.applications.stageChanges.length} 次`} />
            <Stat label="复盘 / 题库" value={`${metrics.reviews.count} / ${metrics.bank.added}`} hint="本周新增" />
            <Stat
              label="7 天计划"
              value={`${metrics.plan.done}/${metrics.plan.total}`}
              hint="本周计划完成情况"
            />
          </div>

          <div className="grid-2">
            <Card title="本周面试" subtitle="点开可查看报告或继续作答">
              {metrics.interviews.items.length === 0 ? (
                <EmptyState icon="◷" title="本周还没有面试" desc="安排一场模拟面试，下周周报就有数据了。" />
              ) : (
                <ul className="recent-list">
                  {metrics.interviews.items.map((i) => (
                    <li key={i.id}>
                      <Link
                        to={i.status === 'finished' ? `/interviews/${i.id}/report` : `/interviews/${i.id}/session`}
                        className="recent-item"
                      >
                        <div>
                          <div className="recent-title">
                            {i.jobTitle || '未关联岗位'}
                            <Chip tone={i.status === 'finished' ? 'green' : 'amber'}>
                              {i.status === 'finished' ? '已完成' : '进行中'}
                            </Chip>
                          </div>
                          <div className="recent-sub">{formatDateTime(i.startedAt)}</div>
                        </div>
                        <div className="recent-score">
                          {i.status === 'finished' && i.score != null ? `${i.score} 分` : '继续 →'}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="投递阶段变化" subtitle="只统计本周真实发生的阶段推进">
              {metrics.applications.stageChanges.length === 0 ? (
                <p className="muted small">本周没有阶段变化。给在投岗位设置下次跟进日期，避免断线。</p>
              ) : (
                <ul className="bullet-list ok">
                  {metrics.applications.stageChanges.map((l, i) => (
                    <li key={i}>
                      {l.changedAt.slice(0, 10)} · {l.company} · {l.title}：{l.fromStage ? STAGE_LABEL[l.fromStage] || l.fromStage : '创建'} →{' '}
                      {STAGE_LABEL[l.toStage] || l.toStage}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card
            title="周报正文"
            subtitle="Markdown 可直接粘到飞书 / Notion；打印视图为 A4 排版"
            extra={<CopyButton text={data.markdown} label="复制 Markdown" />}
          >
            <pre className="weekly-md">{data.markdown}</pre>
          </Card>
        </>
      )}
    </div>
  );
}
