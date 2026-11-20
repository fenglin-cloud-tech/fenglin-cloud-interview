import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import { Button } from './ui';

/**
 * 演示模式：一条 5 步的主链向导，不写数据库，不影响正常使用。
 * 状态只存 sessionStorage：刷新后从当前步骤继续，退出后清除，下次从第 1 步开始。
 */

const STORAGE_KEY = 'fenglin-demo-tour-v1';

interface TourData {
  counts: {
    resumes: number;
    jobs: number;
    analyses: number;
    finished: number;
    bank: number;
    reviews: number;
  };
  recent: { id: number; status: string; answered: number }[];
}

interface Step {
  key: string;
  title: string;
  desc: string;
  pages: string[];
  page: string;
  pageLabel: string;
  status: (d: TourData | null) => string;
  done: (d: TourData | null) => boolean;
  needsData: (d: TourData | null) => boolean;
  actionLabel: string;
}

const STEPS: Step[] = [
  {
    key: 'resume',
    title: '第 1 步 · 导入或选择简历',
    desc: '先有一份简历：可以粘贴、上传，也可以直接使用示例档案。简历是所有后续步骤的起点。',
    pages: ['/resumes', '/import'],
    page: '/resumes',
    pageLabel: '我的简历',
    actionLabel: '去我的简历',
    status: (d) => (d && d.counts.resumes > 0 ? `已检测到 ${d.counts.resumes} 份简历` : '还没有简历'),
    done: (d) => !!d && d.counts.resumes > 0,
    needsData: (d) => !d || d.counts.resumes === 0,
  },
  {
    key: 'match',
    title: '第 2 步 · 目标岗位与 JD 匹配',
    desc: '新建目标岗位并贴入 JD，在「简历优化」跑一次匹配诊断，看清已覆盖与缺失的要求。',
    pages: ['/jobs', '/optimize'],
    page: '/optimize',
    pageLabel: '简历优化',
    actionLabel: '去 JD 匹配',
    status: (d) =>
      d && d.counts.analyses > 0
        ? `已检测到 ${d.counts.analyses} 次 JD 匹配`
        : d && d.counts.jobs === 0
          ? '还没有目标岗位'
          : '还没有匹配记录',
    done: (d) => !!d && d.counts.analyses > 0,
    needsData: (d) => !d || d.counts.analyses === 0,
  },
  {
    key: 'question',
    title: '第 3 步 · 从简历生成面试题',
    desc: '进入模拟面试，系统按简历与岗位生成题目与轮次；这一步先看清会问什么。',
    pages: ['/interviews'],
    page: '/interviews',
    pageLabel: '模拟面试',
    actionLabel: '去模拟面试',
    status: (d) => (d && d.recent.length > 0 ? `已检测到 ${d.recent.length} 场面试` : '还没有面试记录'),
    done: (d) => !!d && d.recent.length > 0,
    needsData: (d) => !d || d.recent.length === 0,
  },
  {
    key: 'answer',
    title: '第 4 步 · 真实作答一道',
    desc: '选一道题，用自己的话作答；提交后能看到结构 / 内容 / 表达三维评分和改进建议。',
    pages: [],
    page: '/interviews',
    pageLabel: '模拟面试',
    actionLabel: '去作答',
    status: (d) => (d && d.recent.some((r) => r.answered > 0) ? '已有作答记录' : '还没有作答记录'),
    done: (d) => !!d && d.recent.some((r) => r.answered > 0),
    needsData: (d) => !d || d.recent.length === 0,
  },
  {
    key: 'review',
    title: '第 5 步 · 复盘并沉淀到题库',
    desc: '把答得不顺的题写成复盘、加入题库；系统会自动排进今日待复习。之后可在训练台一键生成求职档案。',
    pages: ['/reviews', '/bank'],
    page: '/reviews',
    pageLabel: '复盘记录',
    actionLabel: '去写复盘',
    status: (d) =>
      d ? `复盘 ${d.counts.reviews} 条 · 题库 ${d.counts.bank} 题` : '正在读取数据',
    done: (d) => !!d && (d.counts.reviews > 0 || d.counts.bank > 0),
    needsData: () => false,
  },
];

function onStepPage(step: Step, path: string): boolean {
  if (step.key === 'answer') return /^\/interviews\/\d+\/session/.test(path);
  if (step.key === 'question') return path === '/interviews' || /^\/interviews\/\d+\/session/.test(path);
  return step.pages.some((p) => path === p || path.startsWith(`${p}/`));
}

export function DemoTour() {
  const { refresh, toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [data, setData] = useState<TourData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { active?: boolean; step?: number };
        if (saved.active) {
          setActive(true);
          setIdx(Math.max(0, Math.min(STEPS.length - 1, Number(saved.step) || 0)));
        }
      }
    } catch {
      /* 忽略损坏的本地状态 */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (active) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, step: idx }));
    else sessionStorage.removeItem(STORAGE_KEY);
  }, [active, idx, hydrated]);

  const loadData = useCallback(() => {
    api
      .dashboard()
      .then((d) => setData({ counts: d.counts, recent: d.recent.map((r) => ({ id: r.id, status: r.status, answered: r.answered })) }))
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    if (!active) return;
    loadData();
  }, [active, idx, location.pathname, loadData]);

  useEffect(() => {
    const start = () => {
      setActive(true);
      setIdx(0);
    };
    window.addEventListener('fenglin:start-tour', start);
    return () => window.removeEventListener('fenglin:start-tour', start);
  }, []);

  const step = STEPS[idx];
  const done = step.done(data);
  const here = onStepPage(step, location.pathname);

  const targetPath = useMemo(() => {
    if (step.key === 'answer') {
      const open = data?.recent.find((r) => r.status === 'active');
      if (open) return `/interviews/${open.id}/session`;
    }
    return step.page;
  }, [step, data]);

  const loadDemo = async () => {
    setBusy(true);
    try {
      await api.loadDemo();
      await refresh();
      loadData();
      toast('示例档案已载入，可以继续演示', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '示例数据载入失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const exit = () => {
    setActive(false);
    setIdx(0);
    toast('已退出演示指引，页面可正常使用', 'ok');
  };

  if (!active) {
    // 考场页不接受悬浮入口：会遮住「提交并看反馈」等主操作；需要演示时从「模拟面试」页进入。
    if (/^\/interviews\/\d+\/session/.test(location.pathname)) return null;
    return (
      <button type="button" className="guide-fab" onClick={() => setActive(true)}>
        <span className="guide-fab-dot" />
        演示指引
        <span className="guide-fab-sub">5 步走完主链</span>
      </button>
    );
  }

  return (
    <aside className="guide-panel" aria-label="演示指引">
      <header className="guide-head">
        <span className="guide-eyebrow">DEMO WALKTHROUGH · 演示模式</span>
        <button type="button" className="guide-close" onClick={exit} aria-label="退出演示指引">
          退出
        </button>
      </header>

      <div className="guide-dots" role="tablist" aria-label="演示步骤">
        {STEPS.map((s, i) => {
          const isDone = s.done(data);
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === idx}
              aria-label={`第 ${i + 1} 步：${s.title.replace(/^第 \d 步 · /, '')}`}
              className={`guide-dot ${i === idx ? 'current' : ''} ${isDone ? 'done' : ''}`}
              onClick={() => setIdx(i)}
            >
              {i + 1}
            </button>
          );
        })}
        <span className="guide-progress">{idx + 1} / {STEPS.length}</span>
      </div>

      <div className={`guide-where ${here ? 'here' : ''}`}>
        {here ? `当前位置：${step.pageLabel} ✓` : `本步页面：${step.pageLabel}`}
      </div>

      <h3 className="guide-title">{step.title}</h3>
      <p className="guide-desc">{step.desc}</p>

      <div className={`guide-status ${done ? 'ok' : ''}`}>
        <span className="guide-status-dot" />
        {step.status(data)}
      </div>

      <div className="guide-actions">
        {!here && (
          <Button size="sm" variant="ink" onClick={() => navigate(targetPath)}>
            {step.key === 'answer' ? '去作答' : step.actionLabel}
          </Button>
        )}
        {!done && step.needsData(data) && (
          <Button size="sm" variant="ghost" onClick={() => void loadDemo()} loading={busy}>
            载入示例档案
          </Button>
        )}
        {step.key === 'review' && (
          <Button size="sm" variant="ghost" onClick={() => window.open('/print/profile', '_blank', 'noopener')}>
            顺便生成求职档案
          </Button>
        )}
      </div>

      <footer className="guide-foot">
        <button type="button" className="guide-nav" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
          上一步
        </button>
        {idx < STEPS.length - 1 ? (
          <button type="button" className="guide-nav primary" onClick={() => setIdx((i) => Math.min(STEPS.length - 1, i + 1))}>
            下一步
          </button>
        ) : (
          <button type="button" className="guide-nav primary" onClick={exit}>
            完成演示
          </button>
        )}
      </footer>
    </aside>
  );
}
