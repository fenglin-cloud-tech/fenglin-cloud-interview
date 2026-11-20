import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { renderMarkdown } from '../lib/markdown';

/** 复盘记录打印视图：与 Markdown 导出同源内容，A4 分页防切断。 */
export function PrintReviews() {
  const [params] = useSearchParams();
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .exportReviews()
      .then(({ markdown: md }) => {
        if (!alive) return;
        setMarkdown(md);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setError('加载复盘记录失败，请确认后端已启动');
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || error || params.get('auto') !== '1') return;
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, [loaded, error, params]);

  return (
    <div className="print-page">
      <div className="print-actions">
        <button type="button" className="btn btn-ink" onClick={() => window.print()}>
          打印 / 另存为 PDF
        </button>
        <a className="btn btn-ghost" href="/reviews">
          返回复盘
        </a>
      </div>
      <article className="print-sheet">
        <div className="print-head">
          <span className="print-brand">
            <img src="/brand/logo.png" alt="丰麟云面" />
            丰麟云面 · 复盘记录
          </span>
          <span>{new Date().toLocaleDateString('zh-CN')}</span>
        </div>
        {error && <p className="print-error">{error}</p>}
        {!error && !loaded && <p className="print-muted">正在加载…</p>}
        {!error && loaded && <div className="markdown-body print-body">{renderMarkdown(markdown)}</div>}
      </article>
    </div>
  );
}
