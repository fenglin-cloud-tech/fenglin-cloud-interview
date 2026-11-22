import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Session } from '../types';
import { formatDateTime } from '../lib/format';

/** FUNC-03：面试报告打印视图，只读已保存的报告与问答，A4 打印由浏览器完成。 */
export function PrintInterview() {
  const { id } = useParams();
  const ivId = Number(id);
  const [params] = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .session(ivId)
      .then((s) => {
        if (!alive) return;
        setSession(s);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setError('加载面试报告失败');
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [ivId]);

  useEffect(() => {
    if (!loaded || error || params.get('auto') !== '1') return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loaded, error, params]);

  const report = session?.interview.report;

  return (
    <div className="print-page">
      <div className="print-actions">
        <button type="button" className="btn btn-ink" onClick={() => window.print()}>
          打印 / 另存为 PDF
        </button>
        <a className="btn btn-ghost" href={`/interviews/${ivId}/report`}>
          返回报告
        </a>
      </div>

      {error && <p className="muted">{error}</p>}
      {!loaded && !error && <p className="muted">正在生成打印视图…</p>}

      {report && session && (
        <article className="print-sheet">
          <header>
            <h1>模拟面试报告</h1>
            <p className="muted">
              {session.job?.title || '未关联岗位'} · {formatDateTime(session.interview.started_at)} · 总分{' '}
              {report.overallScore}
            </p>
          </header>

          <section>
            <h2>各轮得分</h2>
            <ul>
              {report.roundScores.map((r) => (
                <li key={r.round}>
                  <strong>{r.round}</strong>：{r.score} 分 — {r.comment}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>薄弱环节</h2>
            <ul>
              {report.weaknesses.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2>建议复习点</h2>
            <ul>
              {report.reviewPoints.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2>总评</h2>
            <p>{report.summary}</p>
          </section>

          <section>
            <h2>问答记录</h2>
            {session.turns
              .filter((t) => t.answer)
              .map((t, i) => (
                <div key={t.id} className="print-qa">
                  <h3>
                    {i + 1}. {t.question}
                  </h3>
                  <p>
                    <strong>我的回答：</strong>
                    {t.answer}
                  </p>
                  <p>
                    <strong>得分：</strong>
                    {t.score ?? '—'}
                  </p>
                  {t.feedback?.summary && (
                    <p>
                      <strong>反馈：</strong>
                      {t.feedback.summary}
                    </p>
                  )}
                </div>
              ))}
          </section>
        </article>
      )}
    </div>
  );
}
