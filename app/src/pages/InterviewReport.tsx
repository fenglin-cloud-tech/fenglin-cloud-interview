import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Session } from '../types';
import { formatDateTime } from '../lib/format';
import { SHARE_PRIVACY_CONFIRM, buildInterviewShareHtml, downloadShareHtml } from '../lib/share';

/** FUNC-14：反问轮展示专用维度名。 */
function scoreLabels(roundKey: string | undefined, lang: 'zh' | 'en'): [string, string, string] {
  if (roundKey === 'reverse') {
    return lang === 'en' ? ['Relevance', 'Info value', 'Role fit'] : ['问题相关性', '信息获取价值', '岗位理解'];
  }
  return lang === 'en' ? ['Structure', 'Content', 'Expression'] : ['结构', '内容', '表达'];
}
import { downloadFrom, downloadText, openPrintView, slugDate } from '../lib/download';
import { Button, Card, Chip, CopyButton, ErrorState, PageSkeleton, ScoreRing } from '../components/ui';
import { useApp } from '../state';

export function InterviewReport() {
  const { id } = useParams();
  const ivId = Number(id);
  const navigate = useNavigate();
  const { toast } = useApp();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingReview, setCreatingReview] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .session(ivId)
      .then(setSession)
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [ivId]);

  const report = session?.interview.report;

  const makeReview = async (includeFollowups = false) => {
    setCreatingReview(true);
    try {
      const { created } = await api.reviewFromInterview(ivId, includeFollowups);
      toast(`已生成 ${created} 条复盘草稿${includeFollowups ? '（含追问）' : ''}，去补改进点`, 'ok');
      navigate('/reviews');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '生成失败', 'err');
    } finally {
      setCreatingReview(false);
    }
  };

  const toMarkdown = () => {
    if (!session || !report) return '';
    const lines = [
      `# 模拟面试报告`,
      '',
      `- 岗位：${session.job?.title || '未关联'}`,
      `- 简历：${session.resume?.title || '未关联'}`,
      `- 时间：${formatDateTime(session.interview.started_at)}`,
      `- 总分：${report.overallScore}`,
      '',
      '## 各轮得分',
      ...report.roundScores.map((r) => `- ${r.round}：${r.score} 分 — ${r.comment}`),
      '',
      '## 薄弱环节',
      ...report.weaknesses.map((w) => `- ${w}`),
      '',
      '## 建议复习点',
      ...report.reviewPoints.map((r) => `- ${r}`),
      '',
      '## 总评',
      report.summary,
      '',
      '## 问答记录',
      ...(session.turns
        .filter((t) => t.answer)
        .map(
          (t, i) =>
            `### ${i + 1}. ${t.question}\n\n**我的回答**：${t.answer}\n\n**得分**：${t.score ?? '—'}\n\n**反馈**：${t.feedback?.summary || ''}\n`,
        )),
    ];
    return lines.join('\n');
  };

  if (loading) {
    return (
      <div className="page">
        <PageSkeleton variant="cards" label="正在加载面试报告" />
      </div>
    );
  }
  if (error || !session) return <ErrorState message={error || '报告不存在'} onRetry={load} />;
  if (!report) {
    return (
      <div className="page">
        <ErrorState
          message="这场面试还没有生成报告"
          detail="需要先答完所有轮次，或主动结束并生成报告。"
          onRetry={() => navigate(`/interviews/${ivId}/session`)}
        />
      </div>
    );
  }

  const answeredTurns = session.turns.filter((t) => t.answer);
  const tagCounts = (() => {
    const map = new Map<string, number>();
    for (const t of answeredTurns) {
      for (const tag of t.tags || []) map.set(tag, (map.get(tag) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const timed = answeredTurns.filter((t) => typeof t.duration_sec === 'number');
  const avgSec = timed.length
    ? Math.round(timed.reduce((sum, t) => sum + (t.duration_sec || 0), 0) / timed.length)
    : null;

  return (
    <div className="page">
      <div className="report-head">
        <div>
          <Link to="/interviews" className="back-link">
            ← 返回面试列表
          </Link>
          <h1 className="report-title">面试报告</h1>
          <div className="muted">
            {session.job?.title || '未关联岗位'} · {formatDateTime(session.interview.started_at)} · 共作答{' '}
            {session.turns.filter((t) => t.answer).length} 题
          </div>
        </div>
        <div className="row gap-8 wrap">
          <CopyButton text={toMarkdown()} label="复制报告" />
          <Button size="sm" onClick={() => downloadText(`面试报告-${slugDate()}.md`, toMarkdown())}>
            下载 .md
          </Button>
          <Button size="sm" onClick={() => downloadFrom(`/api/interviews/${ivId}/report/docx`)}>
            下载 Word
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              if (!session || !report) return;
              if (!window.confirm(SHARE_PRIVACY_CONFIRM)) return;
              downloadShareHtml(`面试报告-${ivId}-${slugDate()}.html`, buildInterviewShareHtml(session));
              toast('分享快照已生成，可离线打开', 'ok');
            }}
          >
            导出分享快照
          </Button>
          <Button size="sm" onClick={() => openPrintView(`/print/interview/${ivId}`)}>
            打印 / 存为 PDF
          </Button>
        </div>
      </div>

      <div className="report-top">
        <Card className="report-score">
          <ScoreRing value={report.overallScore} size={168} label="总分" />
          <div className="report-seal">复盘</div>
          <p className="report-summary">{report.summary}</p>
        </Card>

        <Card title="各轮得分">
          <ul className="round-scores">
            {report.roundScores.map((r) => (
              <li key={r.round}>
                <div className="rs-row">
                  <span>{r.round}</span>
                  <strong className="mono">{r.score}</strong>
                </div>
                <div className="fb-bar">
                  <span style={{ width: `${r.score}%` }} />
                </div>
                <p className="muted small">{r.comment}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="report-cols">
        <Card title="薄弱环节" subtitle="下一场重点盯这几处">
          <ul className="bullet-list warn">
            {report.weaknesses.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
        <Card title="建议复习点" subtitle="可以直接写进复盘，或作为下一次的练习目标">
          <ul className="bullet-list ok">
            {report.reviewPoints.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="薄弱标签与节奏" subtitle="由逐题反馈的 issues 自动聚合，可回填旧数据">
        {tagCounts.length ? (
          <div className="chip-row">
            {tagCounts.map(([tag, n]) => (
              <Chip key={tag} tone={n >= 3 ? 'red' : 'amber'}>
                {tag} × {n}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="muted small">这场面试的反馈里还没有可聚合的薄弱标签。</p>
        )}
        {avgSec !== null && (
          <p className="muted small mt-8">
            平均每题用时 <strong>{avgSec} 秒</strong>
            {timed.length < answeredTurns.length ? `（${timed.length}/${answeredTurns.length} 题有计时数据）` : ''}
          </p>
        )}
      </Card>

      <Card title="下一步" paper>
        <div className="next-actions">
          <div>
            <strong>把这场面试沉淀下来</strong>
            <p className="muted small">
              一键生成复盘草稿（题目 + 你的回答 + 反馈要点），补完改进点后进入题库。追问通常暴露了最真实的问题，建议一并沉淀。
            </p>
          </div>
          <div className="row gap-8 wrap">
            <Button variant="ink" onClick={() => void makeReview()} loading={creatingReview}>
              生成复盘草稿
            </Button>
            <Button variant="quiet" onClick={() => void makeReview(true)} disabled={creatingReview}>
              含追问一起生成
            </Button>
            <Button onClick={() => navigate('/bank')}>去题库</Button>
            <Button variant="quiet" onClick={() => navigate('/interviews')}>
              再来一场
            </Button>
          </div>
        </div>
      </Card>

      <Card title="逐题记录" subtitle="展开可看每题的三维反馈">
        <div className="qa-list">
          {session.turns
            .filter((t) => t.answer)
            .map((t) => (
              <details key={t.id} className="qa-item">
                <summary>
                  <span className="qa-q">
                    {t.depth > 0 && <Chip tone="ink">追问 {t.depth}</Chip>}
                    {t.question}
                  </span>
                  {t.duration_sec != null && <span className="muted small">{t.duration_sec}s</span>}
                  <span className={`score-dot s${(t.score ?? 0) >= 80 ? '1' : (t.score ?? 0) >= 60 ? '2' : '3'}`}>
                    {t.score ?? '—'}
                  </span>
                </summary>
                <div className="qa-body">
                  <div className="qa-label">我的回答</div>
                  <p>{t.answer}</p>
                  {!!t.tags?.length && (
                    <div className="chip-row">
                      {t.tags.map((tag) => (
                        <Chip key={tag} tone="amber">
                          {tag}
                        </Chip>
                      ))}
                    </div>
                  )}
                  {t.feedback && (
                    <>
                      <div className="qa-label">反馈</div>
                      <p>{t.feedback.summary}</p>
                      <div className="fb-scores small">
                        {(() => {
                          const [a, b, c] = scoreLabels(t.round_key, session.interview.language || 'zh');
                          return (
                            <>
                              <span>
                                {a} {t.feedback.scores.structure}
                              </span>
                              <span>
                                {b} {t.feedback.scores.content}
                              </span>
                              <span>
                                {c} {t.feedback.scores.expression}
                              </span>
                            </>
                          );
                        })()}
                      </div>
                      {t.feedback.improvedAnswer && (
                        <>
                          <div className="qa-label">改写示范</div>
                          <p className="improved">{t.feedback.improvedAnswer}</p>
                        </>
                      )}
                    </>
                  )}
                </div>
              </details>
            ))}
        </div>
      </Card>
    </div>
  );
}
