import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import { ROUND_LABEL, formatDateTime } from '../lib/format';
import { Button, Card, Chip, EmptyState, ErrorState, Loading, PageHeader, Stat } from '../components/ui';

interface Dash {
  counts: {
    resumes: number;
    jobs: number;
    interviews: number;
    finished: number;
    bank: number;
    weak: number;
    reviews: number;
    analyses: number;
  };
  recent: {
    id: number;
    status: string;
    round_key: string;
    started_at: string;
    overall_score: number | null;
    job_title: string | null;
    answered: number;
  }[];
  activeResumeId: number | null;
  activeJobId: number | null;
  aiConfigured: boolean;
}

export function Home() {
  const { activeResume, activeJob, aiConfigured } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .dashboard()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const counts = data?.counts;
  const checklist = [
    { key: 'resume', label: '有一份简历', done: (counts?.resumes ?? 0) > 0, to: '/resumes' },
    { key: 'job', label: '有目标岗位', done: (counts?.jobs ?? 0) > 0, to: '/jobs' },
    { key: 'analysis', label: '做过 JD 匹配诊断', done: (counts?.analyses ?? 0) > 0, to: '/optimize' },
    { key: 'interview', label: '跑完一场模拟面试', done: (counts?.finished ?? 0) > 0, to: '/interviews' },
    { key: 'bank', label: '题库里有题', done: (counts?.bank ?? 0) > 0, to: '/bank' },
    { key: 'review', label: '写过复盘', done: (counts?.reviews ?? 0) > 0, to: '/reviews' },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="训练台 · 闭环起点"
        title="把不确定的面试，练成可复现的流程"
        desc="从一份简历出发：诊断差距 → 针对追问 → 模拟面试 → 复盘沉淀 → 再从题库反练。每一步的结果都会喂给下一步。"
      />

      <section className="hero">
        <div className="hero-main">
          <div className="hero-kicker">
            <span className="kicker-line" />
            简历是入场券，追问才是分水岭
          </div>
          <h2 className="hero-title">
            练一次，
            <br />
            少一次<span className="hero-mark">「回去等通知」</span>
          </h2>
          <p className="hero-desc">
            丰麟云面不改你的经历，只帮你说清楚：这段项目到底做了什么、数据从哪来、你个人贡献了什么。
          </p>
          <div className="hero-actions">
            <Button variant="ink" size="lg" onClick={() => navigate('/interviews')}>
              开始模拟面试
            </Button>
            <Button size="lg" onClick={() => navigate('/templates')}>
              用模板起草简历
            </Button>
          </div>
          <div className="hero-meta">
            <span className={`ai-dot ${aiConfigured ? 'on' : 'off'}`} />
            {aiConfigured ? '智谱模型在线，AI 结果均标注来源' : '模型未配置，当前仅能使用本地降级能力'}
          </div>
        </div>
        <div className="hero-side">
          <div className="hero-seal">闭环</div>
          <ol className="flow">
            {[
              ['简历', '/resumes'],
              ['岗位 / JD', '/optimize'],
              ['追问', '/interviews'],
              ['复盘', '/reviews'],
              ['题库', '/bank'],
            ].map(([label, to], i) => (
              <li key={label}>
                <Link to={to} className="flow-item">
                  <span className="flow-num">{String(i + 1).padStart(2, '0')}</span>
                  <span>{label}</span>
                </Link>
                {i < 4 && <span className="flow-arrow" aria-hidden>↘</span>}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {error && <ErrorState message={error} onRetry={load} />}

      {loading && !data ? (
        <Loading label="正在读取你的训练数据" />
      ) : (
        <>
          <div className="stats-row">
            <Stat label="简历" value={counts?.resumes ?? 0} hint="可维护多份，面向不同岗位" />
            <Stat label="目标岗位" value={counts?.jobs ?? 0} hint="关联 JD 与面试出题" />
            <Stat label="完成面试" value={counts?.finished ?? 0} hint={`共 ${counts?.interviews ?? 0} 场会话`} />
            <Stat label="题库沉淀" value={counts?.bank ?? 0} hint={`${counts?.weak ?? 0} 道标记为薄弱`} />
            <Stat label="复盘" value={counts?.reviews ?? 0} hint="可导出 Markdown / Word" />
          </div>

          <div className="grid-2">
            <Card title="闭环清单" subtitle="按顺序点亮，任何一环没数据都会卡住下一步">
              <ul className="checklist">
                {checklist.map((c) => (
                  <li key={c.key} className={c.done ? 'done' : ''}>
                    <span className="check-mark">{c.done ? '✓' : '○'}</span>
                    <span>{c.label}</span>
                    {!c.done && (
                      <Link to={c.to} className="check-link">
                        去完成 →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <div className="context-note">
                当前上下文：
                <strong>{activeResume?.title || '未选择简历'}</strong>
                <span>/</span>
                <strong>{activeJob?.title || '未选择岗位'}</strong>
                <span className="muted">（在顶部切换）</span>
              </div>
            </Card>

            <Card
              title="最近的面试"
              subtitle="点开可以继续作答或查看报告"
              extra={
                <Link to="/interviews" className="link">
                  全部 →
                </Link>
              }
            >
              {data?.recent?.length ? (
                <ul className="recent-list">
                  {data.recent.map((r) => (
                    <li key={r.id}>
                      <Link
                        to={r.status === 'finished' ? `/interviews/${r.id}/report` : `/interviews/${r.id}/session`}
                        className="recent-item"
                      >
                        <div>
                          <div className="recent-title">
                            {r.job_title || '未关联岗位'}
                            <Chip tone={r.status === 'finished' ? 'green' : 'amber'}>
                              {r.status === 'finished' ? '已完成' : ROUND_LABEL[r.round_key] || '进行中'}
                            </Chip>
                          </div>
                          <div className="recent-sub">
                            {formatDateTime(r.started_at)} · 已答 {r.answered} 题
                          </div>
                        </div>
                        <div className="recent-score">
                          {r.status === 'finished' && r.overall_score != null ? `${r.overall_score} 分` : '继续 →'}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="还没有面试记录"
                  desc="先补一份简历和目标岗位，再一键开始模拟面试。"
                  action={
                    <Button variant="ink" size="sm" onClick={() => navigate('/interviews')}>
                      去准备面试
                    </Button>
                  }
                />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
