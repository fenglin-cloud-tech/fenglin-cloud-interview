import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type AnswerJobResult, type FinishJobResult, type SkipJobResult } from '../api';
import type { Session, Turn } from '../types';
import { ROUND_LABEL, elapsed, formatDateTime } from '../lib/format';
import { useSpeech } from '../lib/speech';
import { useTts } from '../lib/tts';
import {
  Button,
  BusyProgress,
  Callout,
  Card,
  Chip,
  ErrorState,
  PageSkeleton,
  Progress,
  SourceBadge,
} from '../components/ui';
import { useApp } from '../state';

const DRAFT_PREFIX = 'fenglin:answer';

function draftKey(interviewId: number, turnId: number): string {
  return `${DRAFT_PREFIX}:${interviewId}:${turnId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** 后端把长任务改成 202 + 轮询；这里只轮询轻量状态接口，不占用网关长连接。 */
async function pollInterviewJob<T>(interviewId: number, jobId: string): Promise<T> {
  const started = Date.now();
  let delay = 700;
  while (Date.now() - started < 6 * 60 * 1000) {
    await sleep(delay);
    const job = await api.interviewJob<T>(interviewId, jobId);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') {
      throw new ApiError(503, job.error?.message || '任务执行失败，请重试', job.error?.code || 'JOB_FAILED', job.error?.detail);
    }
    delay = Math.min(3000, delay + 400);
  }
  throw new ApiError(504, '任务仍在处理中，请稍后刷新页面查看结果', 'JOB_TIMEOUT');
}

export function InterviewSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, refreshJobs } = useApp();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitStart, setSubmitStart] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [skipStart, setSkipStart] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishStart, setFinishStart] = useState(0);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [bankedTurns, setBankedTurns] = useState<number[]>([]);
  const [bankAdding, setBankAdding] = useState(false);
  const [now, setNow] = useState(Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  const ivId = Number(id);
  // 尊重系统的「减少动态效果」：滚动改为瞬时定位
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  const tts = useTts();
  const [timer, setTimer] = useState<{ turnId: number; startedAt: number } | null>(null);
  const [timedOutEmpty, setTimedOutEmpty] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [expandedTurns, setExpandedTurns] = useState<number[]>([]);
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const timeoutRef = useRef<number | null>(null);

  const activeTurn: Turn | null = session?.pendingTurn ?? null;
  const limit = limitFor(activeTurn?.round_key);
  // 用真实开始时间计算剩余秒数；后台标签页的定时器被节流也不会把倒计时算慢。
  const left =
    timer && activeTurn && timer.turnId === activeTurn.id
      ? Math.max(0, limit - Math.floor((now - timer.startedAt) / 1000))
      : limit;

  useEffect(() => {
    if (activeTurn) {
      let saved = '';
      try {
        saved = window.localStorage.getItem(draftKey(ivId, activeTurn.id)) || '';
      } catch {
        /* 隐私模式下 localStorage 可能不可用 */
      }
      setAnswer(saved);
      setDraftRestored(!!saved);
      setAllDone(false);
      setSubmitError(null);
      bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTurn?.id]);

  // 换题即重置计时与朗读状态；题干变化时不会沿用上一题的剩余时间
  useEffect(() => {
    if (!activeTurn) {
      setTimer(null);
      return;
    }
    setTimer({ turnId: activeTurn.id, startedAt: Date.now() });
    setTimedOutEmpty(false);
    timeoutRef.current = null;
    tts.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTurn?.id]);

  // 作答草稿本地保存：刷新、误关页面或切到别的页面后回来还能继续写。
  useEffect(() => {
    if (!activeTurn) return;
    const key = draftKey(ivId, activeTurn.id);
    const text = answer;
    const handle = window.setTimeout(() => {
      try {
        if (text.trim()) window.localStorage.setItem(key, text);
        else window.localStorage.removeItem(key);
      } catch {
        /* localStorage 不可用时静默降级 */
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [answer, activeTurn?.id, ivId]);

  const submit = async (opts: { auto?: boolean } = {}) => {
    if (!activeTurn) return;
    const text = answer.trim();
    if (text.length < 2) {
      if (!opts.auto) toast('先写几句再提交', 'err');
      return;
    }
    const submittedTurnId = activeTurn.id;
    const key = draftKey(ivId, submittedTurnId);
    tts.stop();
    setSubmitting(true);
    setSubmitStart(Date.now());
    setSubmitError(null);
    try {
      const started = await api.answer(ivId, { turnId: submittedTurnId, answer: text });
      const res = await pollInterviewJob<AnswerJobResult>(ivId, started.jobId);
      setSession(res.session);
      setAllDone(res.allDone);
      setDraftRestored(false);
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      window.setTimeout(
        () => feedbackRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }),
        120,
      );
      if (res.allDone) {
        toast('所有轮次已完成，可以生成报告', 'ok');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 另一个并发请求已经提交过这道题，刷新拿最新状态即可。
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        load();
      }
      setSubmitError(e instanceof ApiError ? e.message : '提交失败');
      toast(e instanceof ApiError ? e.message : '提交失败', 'err');
    } finally {
      setSubmitting(false);
    }
  };

  // UX-07：换一题。服务端限制每场最多 2 次，这里只负责发起与轮询。
  const skipTurn = async () => {
    if (!activeTurn || skipping || submitting) return;
    const skippedTurnId = activeTurn.id;
    tts.stop();
    setSkipping(true);
    setSkipStart(Date.now());
    setSubmitError(null);
    try {
      const started = await api.skipTurn(ivId, skippedTurnId);
      const res = await pollInterviewJob<SkipJobResult>(ivId, started.jobId);
      setSession(res.session);
      setAllDone(res.allDone);
      setAnswer('');
      setDraftRestored(false);
      try {
        window.localStorage.removeItem(draftKey(ivId, skippedTurnId));
      } catch {
        /* ignore */
      }
      toast(
        res.allDone ? '已跳过，所有轮次已完成' : `已跳过本题，本场还可跳过 ${res.remainingSkips} 题`,
        'ok',
      );
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : '换题失败');
      toast(e instanceof ApiError ? e.message : '换题失败', 'err');
    } finally {
      setSkipping(false);
    }
  };

  // 常见题答完后可一键沉淀到个人题库；重复题按题库既有规则提示，不重复入库。
  const addToBank = async (turn: Turn) => {
    if (!session) return;
    setBankAdding(true);
    try {
      await api.createBankItem({
        question: turn.question,
        category: ROUND_LABEL[turn.round_key] || '专业',
        jobId: session.interview.job_id,
        weak: (turn.score ?? 100) < 70,
        source: 'common',
      });
      setBankedTurns((prev) => (prev.includes(turn.id) ? prev : [...prev, turn.id]));
      toast('已加入个人题库，可在「个人题库」继续复习', 'ok');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setBankedTurns((prev) => (prev.includes(turn.id) ? prev : [...prev, turn.id]));
        toast('题库里已经有这道题了', 'ok');
      } else {
        toast(e instanceof ApiError ? e.message : '加入题库失败', 'err');
      }
    } finally {
      setBankAdding(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    setFinishStart(Date.now());
    setFinishError(null);
    try {
      const res = await api.finishInterview(ivId);
      if ('jobId' in res) {
        await pollInterviewJob<FinishJobResult>(ivId, res.jobId);
      }
      await refreshJobs();
      navigate(`/interviews/${ivId}/report`);
    } catch (e) {
      setFinishError(e instanceof ApiError ? e.message : '报告生成失败');
      toast(e instanceof ApiError ? e.message : '报告生成失败', 'err');
    } finally {
      setFinishing(false);
    }
  };

  // 限时：按真实开始时间计算剩余秒数；到点自动提交已写内容，未作答时只提示。
  useEffect(() => {
    if (!activeTurn || submitting || skipping || !timer || timer.turnId !== activeTurn.id) return;
    if (left > 0) return;
    if (timeoutRef.current === activeTurn.id) return;
    timeoutRef.current = activeTurn.id;
    const text = answerRef.current.trim();
    if (text.length >= 2) {
      toast('时间到，已自动提交当前作答内容', 'ok');
      void submit({ auto: true });
    } else {
      setTimedOutEmpty(true);
      toast('时间到：本题还没有有效作答，未自动提交', 'err');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, timer, activeTurn?.id, submitting, skipping]);

  const expired = !!activeTurn && left <= 0;

  if (loading) {
    return (
      <div className="page">
        <PageSkeleton variant="exam" label="正在进入考场" />
      </div>
    );
  }
  if (error || !session) return <ErrorState message={error || '面试不存在'} onRetry={load} />;

  const answered = session.turns.filter((t) => t.answer !== null);
  const lastAnswered = answered.length ? answered[answered.length - 1] : null;
  const feedback = lastAnswered?.feedback ?? null;
  // 只有后端真的把这道题的追问插成下一题时，才提示「下一题是追问」；否则模型给的 followup 只是候选
  const pendingFollowup =
    lastAnswered && session.pendingTurn && session.pendingTurn.depth > 0 && session.pendingTurn.parent_id === lastAnswered.id
      ? session.pendingTurn
      : null;
  const currentRound = session.currentRound;
  const answeredThisRound = session.turns.filter(
    (t) => t.round_key === currentRound.key && t.depth === 0 && (t.answer !== null || t.skipped === 1),
  ).length;
  const skipCount = session.turns.filter((t) => t.skipped).length;

  return (
    <div className="page">
      <header className="exam-head">
        <div>
          <Link to="/interviews" className="back-link">
            ← 返回面试列表
          </Link>
          <h1 className="exam-title">
            {session.job?.title || session.resume?.title || '模拟面试'}
            <span className="exam-mode">
              {session.interview.mode === 'bank'
                ? '题库再练'
                : session.interview.mode === 'common'
                  ? '常见题专项'
                  : session.interview.mode === 'mixed'
                    ? '简历 + 常见题'
                    : '按简历出题'}
            </span>
          </h1>
          <div className="exam-sub">
            开始于 {formatDateTime(session.interview.started_at)} · 计时{' '}
            <strong className="mono clock">{elapsed(session.interview.started_at, new Date(now).toISOString())}</strong>
            {skipCount > 0 && <span className="muted small"> · 已跳过 {skipCount}/2 题</span>}
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
                      {t.source === 'common' && <span className="common-mark">常见题</span>}
                      <span className="muted small">
                        {t.focusLabel} · {t.depth > 0 ? `第 ${t.depth} 层追问` : '主问题'}
                      </span>
                      {t.duration_sec != null && <span className="muted small">用时 {t.duration_sec}s</span>}
                      {!!t.tags?.length && <span className="muted small">标签：{t.tags.join('、')}</span>}
                    </div>
                    {t.feedback?.issues?.length ? (
                      <div className="turn-issue">待改：{t.feedback.issues[0]}</div>
                    ) : null}
                    {t.feedback && (
                      <div className="turn-feedback-detail">
                        <button
                          className="link-btn"
                          aria-expanded={expandedTurns.includes(t.id)}
                          onClick={() =>
                            setExpandedTurns((prev) =>
                              prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                            )
                          }
                        >
                          {expandedTurns.includes(t.id) ? '收起完整反馈' : '查看完整反馈'}
                        </button>
                        {expandedTurns.includes(t.id) && (
                          <div className="turn-feedback-body">
                            <div className="turn-meta">
                              <span>结构 {t.feedback.scores.structure}</span>
                              <span>内容 {t.feedback.scores.content}</span>
                              <span>表达 {t.feedback.scores.expression}</span>
                            </div>
                            <p>{t.feedback.summary}</p>
                            {t.feedback.strengths.length > 0 && (
                              <p className="muted small">亮点：{t.feedback.strengths.join('；')}</p>
                            )}
                            {t.feedback.issues.length > 0 && (
                              <p className="muted small">待改：{t.feedback.issues.join('；')}</p>
                            )}
                            {t.feedback.improvedAnswer && (
                              <p className="muted small">改进示例：{t.feedback.improvedAnswer}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
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
                    {activeTurn.source === 'common' && <Chip tone="ink">常见题</Chip>}
                    {activeTurn.source === 'local' && <SourceBadge source="local" note="模型不可用，使用本地模板出题" />}
                  </div>
                  <div className="q-focus">考察点：{activeTurn.focusLabel || activeTurn.focus}</div>
                  {activeTurn.source === 'common' && (
                    <div className="q-source-note">
                      题目来源：社区常见题型整理 / 通用高频题，非任何公司官方真题。
                    </div>
                  )}
                </div>
              </div>
              <p className="q-text">{activeTurn.question}</p>

              <div className="q-tools">
                <div className="row gap-8 wrap">
                  {tts.supported ? (
                    <>
                      <Button
                        size="sm"
                        variant={tts.speaking ? 'danger' : 'ghost'}
                        onClick={() => (tts.speaking ? tts.stop() : tts.speak(activeTurn.question))}
                        disabled={!tts.canSpeak && !tts.speaking}
                      >
                        {tts.speaking ? '■ 停止朗读' : '▶ 朗读题目'}
                      </Button>
                      <button type="button" className="q-rate" onClick={tts.cycleRate} title="切换朗读语速">
                        语速 {tts.rate === 1 ? '1.0' : tts.rate}×
                      </button>
                    </>
                  ) : (
                    <span className="speech-na">{tts.note || '语音朗读不可用'}</span>
                  )}
                  {tts.supported && !tts.canSpeak && <span className="speech-na">{tts.note}</span>}
                </div>
                <div className={`q-clock ${expired ? 'over' : left <= 30 ? 'warn' : ''}`} aria-live="polite">
                  <span>本题限时 {clockText(limit)}</span>
                  <strong>{expired ? '已超时' : clockText(left)}</strong>
                </div>
              </div>
              <p className="q-timer-note">最后 30 秒计时变色；时间到会自动提交已写内容，未作答不会提交空答案。</p>

              <div className="answer-box">
                <textarea
                  className="textarea answer-input"
                  rows={9}
                  aria-label="作答内容"
                  placeholder="像真的面试一样说出来，再打成文字。建议：先给结论，再讲情境、你的动作、结果。"
                  value={answer}
                  onChange={(e) => {
                    if (tts.speaking) tts.stop();
                    setAnswer(e.target.value);
                  }}
                />
                <div className="answer-bar">
                  <div className="row gap-8 wrap">
                    {speech.supported ? (
                      <Button
                        size="sm"
                        variant={speech.listening ? 'danger' : 'ghost'}
                        onClick={() => {
                          tts.stop();
                          speech.listening ? speech.stop() : speech.start();
                        }}
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
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={submitting || skipping || skipCount >= 2}
                    loading={skipping}
                    onClick={() => void skipTurn()}
                    title="跳过当前题，每场最多 2 次"
                  >
                    {skipCount >= 2 ? '本场已用完跳过次数' : `换一题（剩 ${2 - skipCount} 次）`}
                  </Button>
                  <Button variant="ink" onClick={() => void submit()} loading={submitting} disabled={skipping}>
                    提交并看反馈
                  </Button>
                </div>
                {timedOutEmpty && !submitting && (
                  <Callout tone="warn">
                    {answer.trim()
                      ? '本题已超时，但作答内容过短，未自动提交；确认后可以手动提交。'
                      : '本题已超时，且没有任何作答内容，因此没有自动提交；可以继续写完再手动提交。'}
                  </Callout>
                )}
                {draftRestored && !submitting && (
                  <Callout tone="info">已恢复上次未提交的草稿；提交成功后会自动清除。</Callout>
                )}
                {speech.error && <Callout tone="warn">{speech.error}</Callout>}
                {skipping && (
                  <BusyProgress label="正在换一题" start={skipStart} note="会跳过当前题并生成下一题" />
                )}
                {submitting && (
                  <BusyProgress label="正在生成单题反馈" start={submitStart} note="模型通常需要 10-30 秒" />
                )}
                {submitError && !submitting && (
                  <Callout tone="warn">
                    <div className="row between wrap gap-8">
                      <span>本题反馈没有生成成功：{submitError}</span>
                      <Button size="sm" variant="ink" onClick={() => void submit()}>
                        重试提交
                      </Button>
                    </div>
                  </Callout>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="finish-box">
                <h3>{allDone ? '所有轮次已完成' : '等待生成下一题'}</h3>
                <p>生成报告会汇总各轮得分、薄弱环节与复习点，并把题目沉淀到个人题库。</p>
                {finishing && (
                  <BusyProgress label="正在汇总各轮得分、薄弱环节与复习点" start={finishStart} note="模型通常需要 20-40 秒" />
                )}
                {finishError && !finishing && (
                  <Callout tone="warn">
                    <div className="row between wrap gap-8">
                      <span>报告生成失败：{finishError}</span>
                      <Button size="sm" variant="ink" onClick={() => void finish()}>
                        重试生成
                      </Button>
                    </div>
                  </Callout>
                )}
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
              {pendingFollowup && (
                <div className="fb-followup">
                  下一题是追问（{pendingFollowup.focusLabel || '追问'}）：「{pendingFollowup.question}」
                </div>
              )}
              {lastAnswered?.source === 'common' && (
                <div className="fb-bank">
                  <div>
                    <strong>这道常见题可以留作复习素材</strong>
                    <span>
                      来源：社区常见题型整理 / 通用高频题，非公司官方真题；加入后可在「个人题库」按记忆曲线重练。
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={bankedTurns.includes(lastAnswered.id) ? 'quiet' : 'ghost'}
                    disabled={bankedTurns.includes(lastAnswered.id)}
                    loading={bankAdding}
                    onClick={() => void addToBank(lastAnswered)}
                  >
                    {bankedTurns.includes(lastAnswered.id) ? '已加入个人题库' : '加入个人题库'}
                  </Button>
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

/** 按轮次设定单题限时（秒）：自我介绍 60s，专业 150s，行为 120s，反问 90s。 */
const ROUND_LIMITS: Record<string, number> = { intro: 60, professional: 150, behavioral: 120, reverse: 90 };

function limitFor(roundKey?: string): number {
  return (roundKey && ROUND_LIMITS[roundKey]) || 120;
}

function clockText(sec: number): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function scoreTone(score: number | null): string {
  if (score == null) return '0';
  if (score >= 80) return '1';
  if (score >= 60) return '2';
  return '3';
}
