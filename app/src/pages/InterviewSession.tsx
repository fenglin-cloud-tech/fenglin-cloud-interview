import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Session, Turn } from '../types';
import { elapsed, formatDateTime } from '../lib/format';
import { useSpeech } from '../lib/speech';
import {
  Button,
  Callout,
  Card,
  Chip,
  ErrorState,
  Loading,
  Progress,
  SourceBadge,
} from '../components/ui';
import { useApp } from '../state';

export function InterviewSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, refreshJobs } = useApp();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  const ivId = Number(id);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .session(ivId)
      .then((s) => {
        setSession(s);
        if (s.interview.status === 'finished') {
          navigate(`/interviews/${ivId}/report`, { replace: true });
        }
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [ivId, navigate]);

  useEffect(load, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const speech = useSpeech(
    useCallback((text: string) => {
      setAnswer((prev) => (prev ? `${prev}${prev.endsWith('\n') ? '' : ' '}${text}` : text));
    }, []),
  );

  const activeTurn: Turn | null = session?.pendingTurn ?? null;

  useEffect(() => {
    if (activeTurn) {
      setAnswer('');
      setAllDone(false);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeTurn?.id]);

  const submit = async () => {
    if (!activeTurn) return;
    if (answer.trim().length < 2) return toast('先写几句再提交', 'err');
    setSubmitting(true);
    try {
      const res = await api.answer(ivId, { turnId: activeTurn.id, answer: answer.trim() });
      setSession(res.session);
      setAllDone(res.allDone);
      window.setTimeout(() => feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      if (res.allDone) {
        toast('所有轮次已完成，可以生成报告', 'ok');
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '提交失败', 'err');
    } finally {
      setSubmitting(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      await api.finishInterview(ivId);
      await refreshJobs();
      navigate(`/interviews/${ivId}/report`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '报告生成失败', 'err');
    } finally {
      setFinishing(false);
    }
  };

  if (loading) return <Loading label="进入考场" lines={3} />;
  if (error || !session) return <ErrorState message={error || '面试不存在'} onRetry={load} />;

  const answered = session.turns.filter((t) => t.answer !== null);
  const lastAnswered = answered.length ? answered[answered.length - 1] : null;
  const feedback = lastAnswered?.feedback ?? null;
  const currentRound = session.currentRound;
  const answeredThisRound = session.turns.filter((t) => t.round_key === currentRound.key && t.depth === 0 && t.answer !== null).length;

  return (
    <div className="page">
      <header className="exam-head">
        <div>
          <Link to="/interviews" className="back-link">
            ← 返回面试列表
          </Link>
          <h1 className="exam-title">
            {session.job?.title || session.resume?.title || '模拟面试'}
            <span className="exam-mode">{session.interview.mode === 'bank' ? '题库再练' : '按简历出题'}</span>
          </h1>
          <div className="exam-sub">
            开始于 {formatDateTime(session.interview.started_at)} · 计时{' '}
            <strong className="mono clock">{elapsed(session.interview.started_at, new Date(now).toISOString())}</strong>
          </div>
        </div>
        <div className="exam-progress">
          <Progress
            value={session.progress.percent}
            label={
              <span>
                第 {currentRound.numeral} 轮 · {currentRound.name} · {Math.min(answeredThisRound + (activeTurn?.depth === 0 ? 1 : 0), currentRound.count)}/{currentRound.count}
              </span>
            }
          />
        </div>
      </header>

      <div className="round-track">
        {session.plan.map((r, i) => {
          const idx = session.plan.findIndex((p) => p.key === currentRound.key);
          const state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
          return (
            <div key={r.key} className={`round-step ${state}`}>
              <span className="rs-num">{state === 'done' ? '✓' : r.numeral}</span>
              <div>
                <div className="rs-name">{r.name}</div>
                <div className="rs-desc">{r.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="exam-grid">
        <div className="exam-main">
          {answered.length > 0 && (
            <Card title="已作答" subtitle={`共 ${answered.length} 题，含追问`} className="transcript">
              <ul className="turn-list">
                {answered.map((t) => (
                  <li key={t.id}>
                    <div className="turn-q">
                      {t.depth > 0 && <Chip tone="red">追问 {t.depth}</Chip>}
                      <span>{t.question}</span>
                    </div>
                    <div className="turn-a">{t.answer}</div>
                    <div className="turn-meta">
                      <span className={`score-dot s${scoreTone(t.score)}`}>{t.score ?? '—'}</span>
                      <span className="muted small">
                        {t.focusLabel} · {t.depth > 0 ? `第 ${t.depth} 层追问` : '主问题'}
                      </span>
                    </div>
                    {t.feedback?.issues?.length ? (
                      <div className="turn-issue">待改：{t.feedback.issues[0]}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {activeTurn ? (
            <Card className="question-card">
              <div className="q-head">
                <span className="q-round">{currentRound.numeral}</span>
                <div>
                  <div className="q-label">
                    {currentRound.name}
                    {activeTurn.depth > 0 && <Chip tone="red">追问 {activeTurn.depth}/2</Chip>}
                    {activeTurn.source === 'local' && <SourceBadge source="local" note="模型不可用，使用本地模板出题" />}
                  </div>
                  <div className="q-focus">考察点：{activeTurn.focusLabel || activeTurn.focus}</div>
                </div>
              </div>
              <p className="q-text">{activeTurn.question}</p>

              <div className="answer-box">
                <textarea
                  className="textarea answer-input"
                  rows={9}
                  placeholder="像真的面试一样说出来，再打成文字。建议：先给结论，再讲情境、你的动作、结果。"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <div className="answer-bar">
                  <div className="row gap-8 wrap">
                    {speech.supported ? (
                      <Button
                        size="sm"
                        variant={speech.listening ? 'danger' : 'ghost'}
                        onClick={() => (speech.listening ? speech.stop() : speech.start())}
                      >
                        {speech.listening ? '■ 停止录音' : '🎙 语音作答'}
                      </Button>
                    ) : (
                      <span className="speech-na" title="当前浏览器不支持 Web Speech API">
                        语音识别不可用，请用文字作答
                      </span>
                    )}
                    <span className="muted small">{answer.trim().length} 字</span>
                    {speech.interim && <span className="interim">识别中：{speech.interim}</span>}
                  </div>
                  <Button variant="ink" onClick={() => void submit()} loading={submitting}>
                    提交并看反馈
                  </Button>
                </div>
                {speech.error && <Callout tone="warn">{speech.error}</Callout>}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="finish-box">
                <h3>{allDone ? '所有轮次已完成' : '等待生成下一题'}</h3>
                <p>生成报告会汇总各轮得分、薄弱环节与复习点，并把题目沉淀到个人题库。</p>
                <Button variant="ink" size="lg" onClick={() => void finish()} loading={finishing}>
                  生成面试报告
                </Button>
              </div>
            </Card>
          )}

          {feedback && (
            <div ref={feedbackRef}>
              <Card
                title="本题反馈"
                className="feedback-card"
                extra={<SourceBadge source={lastAnswered?.source as 'llm' | 'local'} />}
              >
              <div className="fb-scores">
                {(
                  [
                    ['结构', feedback.scores.structure],
                    ['内容', feedback.scores.content],
                    ['表达', feedback.scores.expression],
                  ] as [string, number][]
                ).map(([label, v]) => (
                  <div className="fb-score" key={label}>
                    <div className="fb-score-num">{v}</div>
                    <div className="fb-score-label">{label}</div>
                    <div className="fb-bar">
                      <span style={{ width: `${v}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="fb-summary">{feedback.summary}</p>
              <div className="fb-cols">
                <div>
                  <div className="fb-col-title ok">做得好的</div>
                  <ul>
                    {feedback.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="fb-col-title warn">必须改</div>
                  <ul>
                    {feedback.issues.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {feedback.improvedAnswer ? (
                <div className="fb-improved">
                  <div className="fb-col-title">改写示范</div>
                  <p>{feedback.improvedAnswer}</p>
                </div>
              ) : (
                <Callout tone="warn">本地降级模式不生成改写示范，仅做规则评估；模型恢复后会给出示例答案。</Callout>
              )}
              {feedback.followup && (
                <div className="fb-followup">
                  下一题是追问（{feedback.followup.focus === 'project_detail' ? '项目细节' : feedback.followup.focus === 'data_source' ? '数据来源' : '个人贡献'}）：
                  「{feedback.followup.question}」
                </div>
              )}
            </Card>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <aside className="exam-side">
          <Card title="本场信息">
            <dl className="meta-list">
              <dt>简历</dt>
              <dd>{session.resume?.title || '未关联'}</dd>
              <dt>岗位</dt>
              <dd>{session.job?.title || '未关联'}</dd>
              <dt>进度</dt>
              <dd>
                {session.progress.answeredBase}/{session.progress.total} 主问题
              </dd>
              <dt>追问</dt>
              <dd>最多 2 层，方向限于项目细节 / 数据来源 / 个人贡献</dd>
            </dl>
          </Card>
          <Card title="答题提示" paper>
            <ul className="principles">
              <li>先给结论，再展开；不要从头讲到尾。</li>
              <li>行为题用 STAR：情境 → 任务 → 行动 → 结果。</li>
              <li>每个结果尽量带一个数字或对比。</li>
              <li>追问时不要改口，补充细节就好。</li>
            </ul>
          </Card>
          <Card title="轮次说明">
            <ol className="round-legend">
              {session.plan.map((r) => (
                <li key={r.key}>
                  <strong>{r.name}</strong>
                  <span>{r.count} 题</span>
                  <p>{r.desc}</p>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function scoreTone(score: number | null): string {
  if (score == null) return '0';
  if (score >= 80) return '1';
  if (score >= 60) return '2';
  return '3';
}
