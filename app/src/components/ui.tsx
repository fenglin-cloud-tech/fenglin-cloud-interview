import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { copyText } from '../lib/download';

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
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
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
