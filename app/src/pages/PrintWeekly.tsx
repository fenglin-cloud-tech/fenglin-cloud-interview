import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { WeeklyReport } from '../types';
import { renderMarkdown } from '../lib/markdown';

/** MOD-10：周报打印视图，复用打印页样式，A4 直接输出。 */
export function PrintWeekly() {
  const [params] = useSearchParams();
  const [data, setData] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const from = params.get('from') || undefined;
    const to = params.get('to') || undefined;
    api
      .weeklyReport({ from, to })
      .then(setData)
      .catch(() => setError('加载周报失败，请确认后端已启动'));
  }, [params]);

  useEffect(() => {
    if (!data || error) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [data, error]);

  return (
    <div className="print-page">
      <div className="print-actions">
        <button type="button" className="btn btn-ink" onClick={() => window.print()}>
          打印 / 另存为 PDF
        </button>
        <a className="btn btn-ghost" href="/weekly">
          返回周报
        </a>
      </div>
      {error && <p className="print-error">{error}</p>}
      {!error && !data && <p className="print-muted">正在汇总本周数据…</p>}
      {data && (
        <article className="print-sheet">
          <div className="print-head">
            <span className="print-brand">
              <img src="/brand/logo.png" alt="丰麟云面" />
              丰麟云面 · 求职周报
            </span>
            <span>
              {data.from} ~ {data.to}
            </span>
          </div>
          <div className="print-body markdown-body">{renderMarkdown(data.markdown)}</div>
        </article>
      )}
    </div>
  );
}
