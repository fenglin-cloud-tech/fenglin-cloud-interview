import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Resume } from '../types';
import { renderMarkdown } from '../lib/markdown';

/** 简历打印视图：A4 版式，浏览器「另存为 PDF」即得到 PDF。 */
export function PrintResume() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [resume, setResume] = useState<Resume | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .resumes()
      .then(({ resumes }) => {
        if (!alive) return;
        const found = resumes.find((r) => String(r.id) === id) || null;
        if (found) setResume(found);
        else setError('没有找到这份简历，可能已被删除');
      })
      .catch(() => {
        if (alive) setError('加载简历失败，请确认后端已启动');
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!resume || params.get('auto') !== '1') return;
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, [resume, params]);

  return (
    <div className="print-page">
      <div className="print-actions">
        <button type="button" className="btn btn-ink" onClick={() => window.print()}>
          打印 / 另存为 PDF
        </button>
        <a className="btn btn-ghost" href={`/resumes`}>
          返回简历库
        </a>
      </div>
      <article className="print-sheet">
        <div className="print-head">
          <span className="print-brand">
            <img src="/brand/logo.png" alt="丰麟云面" />
            丰麟云面 · 简历
          </span>
          <span>{new Date().toLocaleDateString('zh-CN')}</span>
        </div>
        {error && <p className="print-error">{error}</p>}
        {!error && !resume && <p className="print-muted">正在加载…</p>}
        {resume && <div className="markdown-body print-body">{renderMarkdown(resume.content)}</div>}
      </article>
    </div>
  );
}
