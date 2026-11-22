import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../state';
import { giveAiConsent, hasAiConsent } from '../lib/consent';
import { lockBodyScroll } from '../lib/scrollLock';
import { DemoTour } from './DemoTour';

const ICONS: Record<string, ReactNode> = {
  home: (
    <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z" />
  ),
  template: <path d="M4 3h9l3 3v11H4zM13 3v3h3M6.5 9h7M6.5 12h7M6.5 15h4" />,
  doc: <path d="M5 3h7l3 3v11H5zM12 3v3h3M7.5 10h5M7.5 13h5M7.5 16h3" />,
  target: <path d="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 9.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z" />,
  send: <path d="M3 10 17 4l-3.2 13-4-5.2L3 10zM9.8 11.8 17 4" />,
  wand: <path d="m4 16 9-9M11.5 4.5l1.5-1.5M14 8l2-1M9 3.5 8 5M16 11l-1 2M4 16l-1 1" />,
  mic: <path d="M10 3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 10 3zM5 9.5a5 5 0 0 0 10 0M10 14.5V17M7.5 17h5" />,
  notebook: <path d="M5 3h10v14H5zM8 3v14M10.5 7h2.5M10.5 10.5h2.5" />,
  library: <path d="M4 4h3v12H4zM9 4h3v12H9zM14 5l2.5-1 2 11-2.5.6z" />,
  user: <path d="M10 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM4 17c0-3 2.7-5 6-5s6 2 6 5" />,
  shield: <path d="M10 3 4.5 5v5c0 3.2 2.2 5.6 5.5 7 3.3-1.4 5.5-3.8 5.5-7V5zM7.5 10l1.8 1.8 3.2-3.6" />,
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name] || ICONS.doc}
    </svg>
  );
}

const NAV = [
  {
    group: '起步',
    items: [
      { to: '/', label: '训练台', icon: 'home', end: true },
      { to: '/templates', label: '模板库', icon: 'template' },
    ],
  },
  {
    group: '简历与岗位',
    items: [
      { to: '/resumes', label: '我的简历', icon: 'doc' },
      { to: '/jobs', label: '目标岗位', icon: 'target' },
      { to: '/applications', label: '投递追踪', icon: 'send' },
      { to: '/optimize', label: '简历优化', icon: 'wand' },
    ],
  },
  {
    group: '面试',
    items: [
      { to: '/interviews', label: '模拟面试', icon: 'mic' },
      { to: '/reviews', label: '复盘记录', icon: 'notebook' },
      { to: '/bank', label: '个人题库', icon: 'library' },
    ],
  },
  {
    group: '其他',
    items: [
      { to: '/profile', label: '本地档案', icon: 'user' },
      { to: '/backup', label: '数据备份', icon: 'shield' },
      { to: '/privacy', label: '隐私说明', icon: 'shield' },
    ],
  },
];

export function Layout() {
  const { activeResume, activeJob, resumes, jobs, setActiveResume, setActiveJob, aiConfigured, sharedDemo, toasts, dismissToast } =
    useApp();
  const [open, setOpen] = useState(false);
  const [aiConsent, setAiConsent] = useState(() => hasAiConsent());
  const asideRef = useRef<HTMLElement>(null);
  const location = useLocation();

  // 移动端抽屉打开时锁住背景滚动，抽屉自身是唯一滚动容器
  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  // 移动端抽屉关闭时把侧栏移出可聚焦树，避免 Tab 进入屏幕外的导航
  useEffect(() => {
    const host = asideRef.current;
    if (!host) return;
    const mq = window.matchMedia('(max-width: 980px)');
    const apply = () => {
      if (mq.matches && !open) host.setAttribute('inert', '');
      else host.removeAttribute('inert');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [open]);

  // 抽屉焦点圈闭：打开后聚焦首个可操作项，Tab 循环，Esc 关闭并把焦点还给菜单按钮
  useEffect(() => {
    if (!open) return;
    const host = asideRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      host?.querySelector<HTMLElement>('.sidebar-close, .nav-item')?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !host) return;
      const nodes = [...host.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
        (el) => el.getClientRects().length > 0,
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className={`sidebar ${open ? 'open' : ''}`} id="app-sidebar" ref={asideRef} aria-label="主导航">
        <div className="brand">
          <img className="brand-logo" src="/brand/logo.png" alt="丰麟云面" />
          <div>
            <div className="brand-name">丰麟云面</div>
            <div className="brand-sub">求职陪练 · 闭环训练</div>
          </div>
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="收起菜单">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <nav className="nav">
          {NAV.map((g) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-group-title">{g.group}</div>
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className={`ai-dot ${aiConfigured ? 'on' : 'off'}`} />
          <div>
            <div className="ai-label">{aiConfigured ? '智谱模型已就绪' : '模型未配置'}</div>
            <div className="ai-sub">{aiConfigured ? '所有 AI 结果均标注来源' : '将只能使用本地降级能力'}</div>
          </div>
        </div>
      </aside>

      {open && <div className="sidebar-mask" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div className="main">
        {sharedDemo && (
          <div className="demo-banner">
            公网演示实例：所有访问者共享同一份数据，实例重启后数据会清空，请勿填写真实隐私信息。
          </div>
        )}
        {!aiConsent && (
          <div className="demo-banner" role="status">
            使用 AI 功能前，请确认会将简历、JD 与作答内容发送给模型服务；不会上传到其他第三方。
            <NavLink to="/privacy">查看隐私说明</NavLink>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                giveAiConsent();
                setAiConsent(true);
              }}
            >
              同意并继续
            </button>
          </div>
        )}
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            onClick={() => setOpen(true)}
            aria-label="打开菜单"
            aria-expanded={open}
            aria-controls="app-sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
            </svg>
          </button>
          <img className="topbar-logo" src="/brand/logo.png" alt="丰麟云面" />
          <div className="topbar-title">
            <span className="topbar-path">{pathLabel(location.pathname)}</span>
          </div>
          <div className="status-chips" aria-hidden>
            <span className={`status-chip ${aiConfigured ? 'on' : 'off'}`}>
              {aiConfigured ? 'MODEL · 在线' : 'MODEL · 本地降级'}
            </span>
            <span className="status-chip">{sharedDemo ? 'STORE · 共享演示' : 'STORE · 本机'}</span>
          </div>
          <div className="context">
            <label className="ctx-field">
              <span>简历</span>
              <select
                value={activeResume?.id ?? ''}
                onChange={(e) => void setActiveResume(e.target.value ? Number(e.target.value) : null)}
              >
                {resumes.length === 0 && <option value="">暂无简历</option>}
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctx-field">
              <span>岗位</span>
              <select
                value={activeJob?.id ?? ''}
                onChange={(e) => void setActiveJob(e.target.value ? Number(e.target.value) : null)}
              >
                {jobs.length === 0 && <option value="">暂无岗位</option>}
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <main className="content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>

        <footer className="run-bar" aria-label="运行状态">
          <span className="run-item">
            <i className={aiConfigured ? '' : 'off'} />
            运行状态 <b>{aiConfigured ? '正常' : '降级'}</b>
          </span>
          <span className="run-item">
            数据 <b>{sharedDemo ? '公网共享演示 · 重启清空' : '仅存本机 SQLite'}</b>
          </span>
          <span className="run-item">
            模型 <b>{aiConfigured ? '智谱 GLM · 结果标注来源' : '未配置 · 本地规则'}</b>
          </span>
          <span className="run-spacer" />
          <span className="run-item">FENGLIN CLOUD INTERVIEW · TRAINING CONSOLE</span>
        </footer>
      </div>

      <DemoTour />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function pathLabel(path: string): string {
  const map: [string, string][] = [
    ['/templates/', '模板库 / 引导填写'],
    ['/interviews/', '模拟面试 / 考场'],
    ['/templates', '模板库'],
    ['/import', '简历导入'],
    ['/resumes', '我的简历'],
    ['/jobs', '目标岗位'],
    ['/optimize', '简历优化'],
    ['/interviews', '模拟面试'],
    ['/reviews', '复盘记录'],
    ['/bank', '个人题库'],
    ['/profile', '本地档案'],
    ['/applications', '投递追踪'],
    ['/backup', '数据备份'],
    ['/privacy', '隐私说明'],
    ['/', '训练台'],
  ];
  for (const [prefix, label] of map) {
    if (prefix === '/' ? path === '/' : path.startsWith(prefix)) return label;
  }
  return '丰麟云面';
}
