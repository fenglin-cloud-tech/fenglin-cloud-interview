import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { JdAnalysisRecord, JdMatchResult, LlmMeta, SuggestionResult } from '../types';
import { diffLines } from '../lib/diff';
import { downloadFrom, downloadText, openPrintView, slugDate } from '../lib/download';
import { formatDateTime } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { ExperiencePicker } from '../components/ExperiencePicker';
import {
  Button,
  BusyProgress,
  Callout,
  Card,
  Chip,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  PageSkeleton,
  ScoreRing,
  SourceBadge,
  Tabs,
} from '../components/ui';

const CATEGORY_LABEL: Record<string, string> = {
  wording: '措辞',
  quantify: '量化',
  structure: '结构',
  redundancy: '冗余',
  content: '内容',
};

const STATUS_LABEL: Record<string, string> = {
  covered: '已覆盖',
  partial: '部分覆盖',
  missing: '缺失',
};

/** 建议任务进度存 sessionStorage：刷新页面后仍能接着轮询（任务本身已落库）。 */
const SUGGESTION_STORAGE_KEY = 'fenglin:suggestion-job';
const SUGGESTION_MAX_AGE_MS = 9 * 60 * 1000;

interface StoredSuggestionJob {
  jobId: string;
  resumeId: number | null;
  jobTitle: string;
  resumeText: string;
  startedAt: number;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function Optimize() {
  const [params] = useSearchParams();
  const { resumes, jobs, activeResume, activeJob, loading: ctxLoading, refreshResumes, setActiveResume, setActiveJob, toast } =
    useApp();

  const [resumeId, setResumeId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobTitle, setJobTitle] = useState(activeJob?.title ?? '');
  const [resumeText, setResumeText] = useState(activeResume?.content ?? '');
  const [jd, setJd] = useState(activeJob?.jd ?? '');
  const [tab, setTab] = useState('advice');

  const [sugLoading, setSugLoading] = useState(false);
  const [sugStart, setSugStart] = useState(0);
  const [sugError, setSugError] = useState<string | null>(null);
  const [sug, setSug] = useState<SuggestionResult | null>(null);
  const [sugMeta, setSugMeta] = useState<LlmMeta | null>(null);

  const [matchLoading, setMatchLoading] = useState(false);
  const [matchStart, setMatchStart] = useState(0);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [match, setMatch] = useState<JdMatchResult | null>(null);
  const [matchMeta, setMatchMeta] = useState<LlmMeta | null>(null);
  const [history, setHistory] = useState<JdAnalysisRecord[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);

  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [changes, setChanges] = useState<string[]>([]);
  const [draft, setDraft] = useState(activeResume?.content ?? '');
  const [baseline, setBaseline] = useState(activeResume?.content ?? '');
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStart, setChatStart] = useState(0);
  const [chatError, setChatError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const userTouched = useRef(false);
  const sugRunRef = useRef(0);
  const undoStack = useRef<string[]>([]);

  // 上下文异步加载：等简历/岗位到齐后再补默认值；用户手动切换后不再自动覆盖
  useEffect(() => {
    if (userTouched.current || resumeId !== null || resumes.length === 0) return;
    const rid = Number(params.get('resumeId'));
    const r = resumes.find((x) => x.id === rid) || activeResume || resumes[0];
    if (r) {
      setResumeId(r.id);
      setResumeText(r.content);
      setDraft(r.content);
      setBaseline(r.content);
    }
  }, [resumes, activeResume, params, resumeId]);

  useEffect(() => {
    if (userTouched.current || jobId !== null || jobs.length === 0) return;
    const j = jobs.find((x) => x.id === Number(params.get('jobId'))) || activeJob || jobs[0];
    if (j) {
      setJobId(j.id);
      setJobTitle(j.title);
      setJd(j.jd);
    }
  }, [jobs, activeJob, params, jobId]);

  const switchResume = (id: number | null) => {
    if (sugLoading && id !== resumeId) {
      const ok = window.confirm('建议任务正在生成，切换简历会取消本次任务。是否继续？');
      if (!ok) return;
    }
    userTouched.current = true;
    sugRunRef.current += 1; // 取消正在轮询的旧简历建议，避免结果串到新简历
    setSugLoading(false);
    sessionStorage.removeItem(SUGGESTION_STORAGE_KEY);
    setResumeId(id);
    const r = resumes.find((x) => x.id === id);
    if (r) {
      setResumeText(r.content);
      setDraft(r.content);
      setBaseline(r.content);
      setMessages([]);
      setChanges([]);
      setSug(null);
      setMatch(null);
      void setActiveResume(r.id);
    }
  };

  const switchJob = (id: number | null) => {
    if (sugLoading && id !== jobId) {
      const ok = window.confirm('建议任务正在生成，切换岗位会取消本次任务。是否继续？');
      if (!ok) return;
    }
    userTouched.current = true;
    setJobId(id);
    const j = jobs.find((x) => x.id === id);
    if (j) {
      setJobTitle(j.title);
      setJd(j.jd);
      void setActiveJob(j.id);
    }
  };

  useEffect(() => {
    if (!resumeId) return;
    api
      .jdAnalyses(resumeId)
      .then((r) => {
        setHistory(r.analyses);
        setHistoryCursor(r.nextCursor);
      })
      .catch(() => {
        setHistory([]);
        setHistoryCursor(null);
      });
  }, [resumeId]);

  const loadMoreHistory = () => {
    if (!resumeId || !historyCursor) return;
    api
      .jdAnalyses(resumeId, historyCursor)
      .then((r) => {
        setHistory((prev) => [...prev, ...r.analyses]);
        setHistoryCursor(r.nextCursor);
      })
      .catch(() => toast('加载更多诊断失败', 'err'));
  };

  /** 轮询建议任务：指数退避（1.2s 起，最多 5s），网络抖动最多连续容忍 2 次。 */
  const pollSuggestion = async (jobId: string, runId: number) => {
    let delay = 1200;
    let networkFailures = 0;
    try {
      for (let i = 0; i < 150; i += 1) {
        await sleep(delay);
        if (sugRunRef.current !== runId) return;
        try {
          const job = await api.suggestionJob(jobId);
          networkFailures = 0;
          if (sugRunRef.current !== runId) return;
          if (job.status === 'done' && job.result) {
            setSug(job.result);
            setSugMeta(job.meta ?? null);
            sessionStorage.removeItem(SUGGESTION_STORAGE_KEY);
            return;
          }
          if (job.status === 'error') {
            setSugError(job.error?.message || '生成失败');
            sessionStorage.removeItem(SUGGESTION_STORAGE_KEY);
            return;
          }
        } catch (e) {
          const transient = e instanceof ApiError && (e.code === 'TIMEOUT' || e.code === 'NETWORK');
          if (!transient || networkFailures >= 2) throw e;
          networkFailures += 1;
        }
        delay = Math.min(Math.round(delay * 1.3), 5000);
      }
      setSugError('生成超时，请稍后重试');
      sessionStorage.removeItem(SUGGESTION_STORAGE_KEY);
    } catch (e) {
      if (sugRunRef.current === runId) {
        setSugError(e instanceof ApiError ? e.message : '生成失败');
        sessionStorage.removeItem(SUGGESTION_STORAGE_KEY);
      }
    } finally {
      if (sugRunRef.current === runId) setSugLoading(false);
    }
  };

  const runSuggestions = async () => {
    if (resumeText.trim().length < 20) return toast('简历内容太短，至少 20 字', 'err');
    const runId = sugRunRef.current + 1;
    sugRunRef.current = runId;
    setSugLoading(true);
    setSugStart(Date.now());
    setSugError(null);
    setSug(null);
    try {
      const { jobId } = await api.suggestions({ resumeText, jobTitle });
      // 服务端已改为异步任务：这里轮询结果，避免单个请求被平台网关 30s 截断
      const stored: StoredSuggestionJob = {
        jobId,
        resumeId,
        jobTitle,
        resumeText,
        startedAt: Date.now(),
      };
      sessionStorage.setItem(SUGGESTION_STORAGE_KEY, JSON.stringify(stored));
      await pollSuggestion(jobId, runId);
    } catch (e) {
      if (sugRunRef.current === runId) setSugError(e instanceof ApiError ? e.message : '生成失败');
    } finally {
      if (sugRunRef.current === runId) setSugLoading(false);
    }
  };

  const cancelSuggestions = () => {
    sugRunRef.current += 1;
    setSugLoading(false);
    sessionStorage.removeItem(SUGGESTION_STORAGE_KEY);
    toast('已取消本次建议任务，后台结果不会再写入页面', 'ok');
  };

  // 刷新页面后恢复未完成的建议任务：任务状态在服务端 ai_job 表中，可以继续轮询。
  useEffect(() => {
    const raw = sessionStorage.getItem(SUGGESTION_STORAGE_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as StoredSuggestionJob;
      if (!stored.jobId || Date.now() - stored.startedAt > SUGGESTION_MAX_AGE_MS) {
        sessionStorage.removeItem(SUGGESTION_STORAGE_KEY);
        return;
      }
      if (stored.resumeId) {
        setResumeId(stored.resumeId);
        setResumeText(stored.resumeText);
      }
      setJobTitle(stored.jobTitle);
      const runId = sugRunRef.current + 1;
      sugRunRef.current = runId;
      setSugLoading(true);
      setSugStart(stored.startedAt);
      setSugError(null);
      void pollSuggestion(stored.jobId, runId);
    } catch {
      sessionStorage.removeItem(SUGGESTION_STORAGE_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runMatch = async () => {
    if (jd.trim().length < 30) return toast('JD 太短，请粘贴完整的岗位描述', 'err');
    setMatchLoading(true);
    setMatchStart(Date.now());
    setMatchError(null);
    try {
      const { result, meta, savedId } = await api.jdMatch({ resumeText, jd, resumeId, jobId });
      setMatch(result);
      setMatchMeta(meta);
      if (savedId) {
        const r = await api.jdAnalyses(resumeId);
        setHistory(r.analyses);
        setHistoryCursor(r.nextCursor);
      }
    } catch (e) {
      setMatchError(e instanceof ApiError ? e.message : '分析失败');
    } finally {
      setMatchLoading(false);
    }
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    if (resumeText.trim().length < 20) return toast('简历内容太短', 'err');
    const nextMessages = [...messages, { role: 'user' as const, content: text }];
    setMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);
    setChatStart(Date.now());
    setChatError(null);
    try {
      const { result } = await api.iterate({
        resumeText,
        currentResume: draft || resumeText,
        jobTitle,
        messages: nextMessages,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply }]);
      if (result.revisedResume && result.revisedResume.trim()) {
        setDraft(result.revisedResume);
        setChanges(result.changes || []);
      }
    } catch (e) {
      setChatError(e instanceof ApiError ? e.message : '迭代失败');
      setMessages((prev) => [...prev, { role: 'assistant', content: '这次没能改成功，你可以稍后重试，或手动调整右侧草稿。' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const saveVersion = async () => {
    if (!draft.trim()) return;
    if (!resumeId) return toast('请先选择一份简历', 'err');
    setSavingVersion(true);
    try {
      const base = resumes.find((r) => r.id === resumeId);
      const { resume } = await api.createResume({
        title: `${base?.title || '简历'} · 迭代 ${new Date().toLocaleDateString('zh-CN')}`,
        content: draft,
        jobId,
        parentId: resumeId,
        source: 'ai',
      });
      await refreshResumes();
      await setActiveResume(resume.id);
      setResumeId(resume.id);
      setBaseline(draft);
      setMessages([]);
      toast('已另存为新版本，可在「我的简历」查看', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSavingVersion(false);
    }
  };

  const applyAdvice = (original: string, advice: string) => {
    if (!original || !draft.includes(original)) {
      toast('草稿里找不到这条原文，可能已被改过，请手动调整', 'err');
      return;
    }
    undoStack.current.push(draft);
    setUndoDepth(undoStack.current.length);
    setDraft(draft.replace(original, advice));
    setTab('iterate');
    toast('已应用到当前草稿，可随时撤销', 'ok');
  };

  const insertExperience = (text: string) => {
    undoStack.current.push(draft);
    setUndoDepth(undoStack.current.length);
    setDraft((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
    setShowDiff(false);
    setTab('iterate');
    toast('已把素材片段追加到当前草稿，可随时撤销', 'ok');
  };

  const undoSuggestion = () => {    const prev = undoStack.current.pop();
    if (prev === undefined) return;
    setDraft(prev);
    setUndoDepth(undoStack.current.length);
    toast('已撤销上一次应用', 'ok');
  };

  const diff = useMemo(() => (showDiff ? diffLines(baseline, draft) : []), [showDiff, baseline, draft]);
  const exportDiff = useMemo(() => diffLines(baseline, draft), [baseline, draft]);
  const unsaved = draft !== baseline;
  const current = resumes.find((r) => r.id === resumeId);

  if (ctxLoading && resumes.length === 0) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="模块 1 · 简历优化"
          title="按板块批注，再按 JD 对标"
          desc="建议会告诉你「为什么改」；匹配分析会告诉你「缺什么」。多轮迭代后的版本可以另存，所有改动可对比。"
        />
        <PageSkeleton variant="cards" label="正在读取简历与岗位" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="模块 1 · 简历优化"
        title="按板块批注，再按 JD 对标"
        desc="建议会告诉你「为什么改」；匹配分析会告诉你「缺什么」。多轮迭代后的版本可以另存，所有改动可对比。"
      />

      <Card className="ctx-card">
        <div className="workbench-head">
          <span>
            <strong>WORKBENCH</strong> · 简历优化工作台
          </span>
          <span>JD / 原稿 / 建议</span>
        </div>
        <div className="workbench-grid">
          <div className="wb-col">
            <div className="wb-col-head">
              <strong>01</strong> JD <em>目标岗位</em>
            </div>
            <Field label="目标岗位">
              <select className="input" value={jobId ?? ''} onChange={(e) => switchJob(e.target.value ? Number(e.target.value) : null)}>
                <option value="">不关联</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="岗位名称（可手填）">
              <input className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="例如：Java 后端实习" />
            </Field>
            <Field label="JD 原文" counter={<span>{jd.replace(/\s/g, '').length} 字</span>} hint="建议包含「岗位职责」和「任职要求」两部分。">
              <textarea className="textarea" rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="把招聘启事整段粘进来…" />
            </Field>
          </div>

          <div className="wb-col">
            <div className="wb-col-head">
              <strong>02</strong> 原稿 <em>当前简历</em>
            </div>
            <Field label="使用简历">
              <select className="input" value={resumeId ?? ''} onChange={(e) => switchResume(e.target.value ? Number(e.target.value) : null)}>
                <option value="">未选择</option>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="本次分析使用的简历文本"
              counter={<span>{resumeText.replace(/\s/g, '').length} 字</span>}
              hint="默认带入所选简历，可临时粘贴另一版；此处修改不会覆盖原简历，除非另存新版本。"
            >
              <textarea className="textarea mono" rows={12} value={resumeText} onChange={(e) => setResumeText(e.target.value)} />
            </Field>
            {!current && <Callout tone="warn">还没有简历。先去「模板库」生成一份，或到「我的简历」粘贴文本。</Callout>}
          </div>

          <div className="wb-col">
            <div className="wb-col-head">
              <strong>03</strong> 建议 <em>本次产出</em>
            </div>
            <div className="wb-metric">
              <span>修改建议</span>
              <strong>{sug ? sug.sections.reduce((n, s) => n + s.items.length, 0) : '—'}</strong>
            </div>
            <div className="wb-metric">
              <span>JD 匹配度</span>
              <strong>{match ? match.score : '—'}</strong>
            </div>
            <div className="wb-metric">
              <span>历史诊断</span>
              <strong>{history.length}</strong>
            </div>
            <div className="wb-actions">
              <Button variant="ink" onClick={() => void runSuggestions()} loading={sugLoading}>
                生成修改建议
              </Button>
              <Button onClick={() => void runMatch()} loading={matchLoading}>
                开始匹配分析
              </Button>
            </div>
            <p className="wb-note">建议只基于原文改写法，不编造数据；先补齐原稿再做 JD 对标更准。</p>
          </div>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'advice', label: '逐条批注' },
          { key: 'match', label: 'JD 匹配' },
          { key: 'iterate', label: '对话迭代' },
          { key: 'export', label: '导出' },
        ]}
      />

      {tab === 'advice' && (
        <div className="stack">
          <div className="advice-toolbar">
            <div className="muted small">按板块给出修改建议，每条都说明为什么改；建议不会编造你原文没有的数据。</div>
            <span className="mono small muted">在 03 · 建议栏触发生成</span>
          </div>

          {sugLoading && (
            <div className="stack">
              <BusyProgress
                label="正在逐板块阅读简历，生成修改建议"
                start={sugStart}
                note="后台生成，通常 20-40 秒；刷新页面也会接着等"
              />
              <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
                <Button size="sm" variant="quiet" onClick={cancelSuggestions}>
                  取消任务
                </Button>
              </div>
            </div>
          )}
          {sugError && <ErrorState message={sugError} onRetry={() => void runSuggestions()} />}

          {sug && (
            <>
              <Card className="overall-card">
                <div className="overall-head">
                  <div>
                    <div className="overall-label">
                      总体判断 <SourceBadge source={sugMeta?.source} note={sugMeta?.note} />
                    </div>
                    <p className="overall-text">{sug.overall}</p>
                  </div>
                  <div className="stamp-wrap">
                    <span className="stamp stamp-red">已批注</span>
                  </div>
                </div>
                {sug.highlights.length > 0 && (
                  <div className="highlight-row">
                    {sug.highlights.map((h) => (
                      <span className="highlight" key={h}>
                        ✓ {h}
                      </span>
                    ))}
                  </div>
                )}
              </Card>

              {sug.sections.map((sec) => (
                <Card key={sec.name} title={sec.name} extra={<span className="muted small">{sec.items.length} 条</span>}>
                  <div className="advice-list">
                    {sec.items.map((item, i) => (
                      <div className="advice-item" key={i}>
                        <div className="advice-left">
                          {item.original && <blockquote className="advice-original">{item.original}</blockquote>}
                          <Chip tone={
                            item.category === 'quantify' ? 'amber' : item.category === 'structure' ? 'blue' : item.category === 'redundancy' ? 'red' : 'default'
                          }>
                            {CATEGORY_LABEL[item.category] || item.category}
                          </Chip>
                        </div>
                        <div className="advice-body">
                          <p className="advice-text">{item.advice}</p>
                          <p className="advice-reason">
                            <span>为什么改</span>
                            {item.reason}
                          </p>
                        </div>
                        <div className="advice-actions">
                          <CopyButton text={item.advice} label="复制改法" />
                          {item.original && draft.includes(item.original) && (
                            <Button
                              size="sm"
                              variant="quiet"
                              onClick={() => applyAdvice(item.original, item.advice)}
                            >
                              应用到草稿
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </>
          )}

          {!sug && !sugLoading && !sugError && (
            <Card>
              <EmptyState
                icon="✎"
                title="还没有生成建议"
                desc="点右上角「生成修改建议」，会按教育背景、项目经历、技能等板块逐条批注。"
              />
            </Card>
          )}
        </div>
      )}

      {tab === 'match' && (
        <div className="stack">
          <Card title="本次 JD" subtitle="在 01 · JD 栏修改原文，回到这里重新分析">
            <div className="job-jd">{jd || '（尚未填写 JD）'}</div>
            <div className="row between mt-12 wrap gap-8">
              <span className="muted small">分析结果会保存到历史，可对比多次投递的差距。</span>
              <Button variant="ink" onClick={() => void runMatch()} loading={matchLoading}>
                开始匹配分析
              </Button>
            </div>
          </Card>

          {matchLoading && <BusyProgress label="正在对齐 JD 要求与简历证据" start={matchStart} note="通常 10-30 秒" />}
          {matchError && <ErrorState message={matchError} onRetry={() => void runMatch()} />}

          {match && (
            <Card
              title="匹配结果"
              extra={
                <span className="row gap-8">
                  <SourceBadge source={matchMeta?.source} note={matchMeta?.note} />
                  <CopyButton
                    label="复制结论"
                    text={`匹配度 ${match.score}：${match.verdict}\n缺失：${match.missingKeywords.join('、') || '无'}\n动作：\n${match.actions.map((a) => `- ${a}`).join('\n')}`}
                  />
                </span>
              }
            >
              <div className="match-top">
                <ScoreRing value={match.score} label="匹配度" size={132} />
                <div className="match-verdict">
                  <p>{match.verdict}</p>
                  <div className="chip-row">
                    {match.missingKeywords.length ? (
                      match.missingKeywords.map((k) => (
                        <Chip key={k} tone="red">
                          缺 {k}
                        </Chip>
                      ))
                    ) : (
                      <Chip tone="green">关键词无缺失</Chip>
                    )}
                  </div>
                  {matchMeta?.source === 'local' && (
                    <Callout tone="warn">本次使用本地关键词比对（模型不可用），覆盖判断偏机械，建议稍后重跑。</Callout>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '38%' }}>JD 要求</th>
                      <th style={{ width: '14%' }}>状态</th>
                      <th>简历证据 / 缺失说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {match.covered.map((row, i) => (
                      <tr key={i}>
                        <td>{row.requirement}</td>
                        <td>
                          <span className={`status status-${row.status}`}>{STATUS_LABEL[row.status]}</span>
                        </td>
                        <td className="muted">{row.evidence || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {match.actions.length > 0 && (
                <div className="actions-box">
                  <div className="actions-title">补齐动作</div>
                  <ul>
                    {match.actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {history.length > 0 && (
            <Card title="历史诊断" subtitle="同一份简历的多次 JD 对比">
              <ul className="history-list">
                {history.map((h) => (
                  <li key={h.id}>
                    <div className="history-score">{h.score}</div>
                    <div className="history-body">
                      <div className="history-verdict">{h.result?.verdict || '（无结论）'}</div>
                      <div className="muted small">
                        {formatDateTime(h.created_at)} · {h.source === 'local' ? '本地降级' : 'AI'} · {h.jd.slice(0, 40)}…
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {historyCursor && (
                <div className="row gap-8" style={{ justifyContent: 'center', marginTop: 12 }}>
                  <Button size="sm" variant="quiet" onClick={loadMoreHistory}>
                    加载更多
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === 'iterate' && (
        <div className="iterate-grid">
          <Card title="和教练一起改" subtitle="说明你的修改意图，例如「项目经历太像流水账，帮我改成结果导向」" className="chat-card">
            <div className="chat-log">
              {messages.length === 0 && (
                <div className="chat-hint">
                  <p>可以这样说：</p>
                  <ul>
                    <li>把项目经历改得更量化，突出我负责的后端部分</li>
                    <li>这段实习太像打杂，帮我重写成有结果的动作</li>
                    <li>技能栏「精通」太多，按真实程度重排</li>
                  </ul>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`bubble bubble-${m.role}`}>
                  <div className="bubble-role">{m.role === 'user' ? '你' : '教练'}</div>
                  <div className="bubble-text">{m.content}</div>
                </div>
              ))}
              {chatLoading && (
                <div className="bubble bubble-assistant">
                  <div className="bubble-role">教练</div>
                  <BusyProgress compact label="正在按你的要求改写" start={chatStart} />
                </div>
              )}
            </div>
            {chatError && <ErrorState message={chatError} onRetry={() => void sendChat()} />}
            <div className="chat-input">
              <textarea
                className="textarea"
                rows={2}
                aria-label="修改要求"
                placeholder="输入修改要求，Enter 发送，Shift+Enter 换行"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
              />
              <Button variant="ink" onClick={() => void sendChat()} loading={chatLoading} disabled={!chatInput.trim()}>
                发送
              </Button>
            </div>
          </Card>

          <Card
            title="当前版本"
            subtitle={showDiff ? '绿色为新增，红色为删除' : '模型每次改写都会更新这里，确认后再另存'}
            extra={
              <div className="row gap-8">
                {undoDepth > 0 && (
                  <Button size="sm" variant="quiet" onClick={undoSuggestion}>
                    撤销应用（{undoDepth}）
                  </Button>
                )}
                <Button size="sm" variant="quiet" onClick={() => setPickerOpen(true)}>
                  素材库插入
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setShowDiff((v) => !v)}>
                  {showDiff ? '看正文' : '对比原始'}
                </Button>
                <Button size="sm" variant="ink" onClick={() => void saveVersion()} loading={savingVersion}>
                  另存新版
                </Button>
              </div>
            }
            className="draft-card"
          >
            {changes.length > 0 && (
              <div className="changes">
                <div className="changes-title">本轮改动</div>
                <ul>
                  {changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {showDiff ? (
              <pre className="diff-view">
                {diff.map((l, i) => (
                  <span key={i} className={`diff-line diff-${l.type}`}>
                    {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
                    {l.text || ' '}
                    {'\n'}
                  </span>
                ))}
              </pre>
            ) : (
              <div className="paper-scroll preview markdown-body">{renderMarkdown(draft || '（暂无内容）')}</div>
            )}
          </Card>
        </div>
      )}

      {tab === 'export' && (
        <div className="stack">
          <Card
            title="导出简历"
            subtitle="Markdown 便于复制到任意文档；Word 由服务端生成；PDF 走打印视图由浏览器另存"
            extra={
              <div className="row gap-8 wrap">
                <CopyButton text={draft || resumeText} label="复制全文" />
                <Button
                  size="sm"
                  onClick={() => downloadText(`简历-${(jobTitle || '通用').slice(0, 20)}-${slugDate()}.md`, draft || resumeText)}
                >
                  下载 .md
                </Button>
                <Button
                  size="sm"
                  variant="ink"
                  disabled={!resumeId}
                  onClick={() => {
                    if (unsaved) return toast('当前草稿尚未保存，请先另存新版再导出 Word', 'err');
                    if (resumeId) downloadFrom(`/api/resumes/${resumeId}/docx`);
                  }}
                >
                  下载 Word（.docx）
                </Button>
                <Button
                  size="sm"
                  disabled={!resumeId}
                  onClick={() => {
                    if (unsaved) return toast('当前草稿尚未保存，请先另存新版再打印', 'err');
                    if (resumeId) openPrintView(`/print/resume/${resumeId}`);
                  }}
                >
                  打印 / 存为 PDF
                </Button>
              </div>
            }
          >
            {unsaved && (
              <Callout tone="warn">
                当前草稿与已保存版本不一致（新增{' '}
                {exportDiff.filter((l) => l.type === 'add').length} 行 / 删除{' '}
                {exportDiff.filter((l) => l.type === 'del').length} 行）。Word 与打印读取已保存版本，
                请先{' '}
                <button className="link-btn" onClick={() => void saveVersion()}>
                  另存为新版本
                </button>
                ，MD 导出不受影响。
              </Callout>
            )}
            <div className="paper-scroll export-preview markdown-body">{renderMarkdown(draft || resumeText || '（暂无内容）')}</div>
            <Callout tone="info">
              Word 与打印视图读取的是<strong>已保存</strong>的简历版本；如果刚才在左侧改过内容，请先保存再导出。
              PDF 由浏览器打印对话框的「另存为 PDF」生成，A4 排版，板块与表格行不会被分页切断。
            </Callout>
          </Card>
        </div>
      )}

      <ExperiencePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(text) => insertExperience(text)}
        jobId={jobId}
      />
    </div>
  );
}
