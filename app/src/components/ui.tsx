import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from '../lib/download';
import { lockBodyScroll } from '../lib/scrollLock';

/* ---------------- 按钮 ---------------- */

type BtnVariant = 'primary' | 'ghost' | 'quiet' | 'danger' | 'ink';

export function Button({
  variant = 'ghost',
  size,
  loading,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'lg'; loading?: boolean }) {
  return (
    <button
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${loading ? ' is-loading' : ''} ${className}`}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------------- 容器 ---------------- */

export function PageHeader({
  eyebrow,
  title,
  desc,
  actions,
}: {
  eyebrow?: string;
  title: string;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  extra,
  children,
  className = '',
  paper,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  paper?: boolean;
}) {
  return (
    <section className={`card ${paper ? 'card-paper' : ''} ${className}`}>
      {(title || extra) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {extra && <div className="card-extra">{extra}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
  counter,
}: {
  label: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  counter?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <i className="req">*</i>}
        {counter && <span className="field-counter">{counter}</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Chip({
  children,
  tone = 'default',
  title,
}: {
  children: ReactNode;
  tone?: 'default' | 'red' | 'green' | 'amber' | 'ink' | 'blue';
  title?: string;
}) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Stamp({ children, tone = 'red' }: { children: ReactNode; tone?: 'red' | 'green' | 'ink' }) {
  return <span className={`stamp stamp-${tone}`}>{children}</span>;
}

/* ---------------- 状态 ---------------- */

const EMPTY_ICONS: Record<string, ReactNode> = {
  '○': <circle cx="10" cy="10" r="6" />,
  '✎': <path d="M4 16l1-4 9-9 3 3-9 9-4 1zM12 5l3 3" />,
  '▤': (
    <>
      <rect x="3.5" y="4" width="13" height="4" rx="1" />
      <rect x="3.5" y="11" width="13" height="5" rx="1" />
    </>
  ),
  '◎': (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="2" />
    </>
  ),
  '◷': (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6v4.3l2.8 1.5" />
    </>
  ),
};

export function EmptyState({
  title,
  desc,
  action,
  icon = '○',
}: {
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  const glyph = typeof icon === 'string' ? EMPTY_ICONS[icon] : null;
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {glyph ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {glyph}
          </svg>
        ) : (
          icon
        )}
      </div>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Loading({ label = '准备中…', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <div className="loading-label">
        <span className="spinner" /> {label}
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <div className="skeleton" key={i} style={{ width: `${92 - i * 13}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  detail,
  onRetry,
  onFallback,
  fallbackLabel,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
  onFallback?: () => void;
  fallbackLabel?: string;
}) {
  return (
    <div className="error-box" role="alert">
      <div className="error-title">出了点问题</div>
      <p>{message}</p>
      {detail && <details className="error-detail"><summary>查看技术细节</summary><pre>{detail}</pre></details>}
      <div className="row gap-8">
        {onRetry && <Button size="sm" variant="ink" onClick={onRetry}>重试</Button>}
        {onFallback && <Button size="sm" onClick={onFallback}>{fallbackLabel || '换个方式'}</Button>}
      </div>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: ReactNode }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-wrap">
      {label && <div className="progress-label">{label}</div>}
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ScoreRing({
  value,
  size = 120,
  label,
  tone,
}: {
  value: number;
  size?: number;
  label?: string;
  tone?: 'red' | 'green' | 'amber';
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const t = tone || (v >= 80 ? 'green' : v >= 60 ? 'amber' : 'red');
  return (
    <div className={`ring ring-${t}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
        <circle cx="60" cy="60" r="52" className="ring-track" />
        <circle
          cx="60"
          cy="60"
          r="52"
          className="ring-value"
          strokeDasharray={`${(v / 100) * 327} 327`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="ring-text">
        <strong>{v}</strong>
        {label && <span>{label}</span>}
      </div>
    </div>
  );
}

/* ---------------- 交互 ---------------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const host = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    // 视口内固定 + 背景滚动锁，关闭时恢复原滚动位置
    const release = lockBodyScroll();
    const raf = requestAnimationFrame(() => {
      const target =
        host?.querySelector<HTMLElement>('[data-autofocus]') ??
        host?.querySelector<HTMLElement>(FOCUSABLE) ??
        host;
      target?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !host) return;
      const nodes = [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!nodes.length) {
        e.preventDefault();
        host.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === host)) {
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
      release();
      // preventScroll：避免关闭时把页面滚回触发元素而破坏刚恢复的滚动位置
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: string; label: string; hint?: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          className={`tab ${value === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.hint && <span className="tab-hint">{t.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="quiet"
      onClick={async () => {
        const ok = await copyText(text);
        setDone(ok);
        window.setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? '已复制' : label}
    </Button>
  );
}

export function SourceBadge({ source, note }: { source?: 'llm' | 'local' | string; note?: string }) {
  if (!source) return null;
  if (source === 'local') {
    return (
      <span className="source-badge local" title={note || '模型不可用时的本地规则结果'}>
        本地降级
      </span>
    );
  }
  if (source === 'common') {
    return (
      <span className="source-badge common" title={note || '社区常见题型整理 / 通用高频题，非公司官方真题'}>
        常见题
      </span>
    );
  }
  return (
    <span className="source-badge llm" title={note || '由智谱模型生成'}>
      AI 生成
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Callout({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  return <div className={`callout callout-${tone}`}>{children}</div>;
}
