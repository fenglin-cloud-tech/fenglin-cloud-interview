import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { PitchResultData } from '../types';
import { useTts } from '../lib/tts';
import {
  Button,
  BusyProgress,
  Callout,
  Card,
  Chip,
  CopyButton,
  ErrorState,
  Field,
  PageHeader,
  PageSkeleton,
  Progress,
  SourceBadge,
  Tabs,
} from '../components/ui';

const STORAGE_KEY = 'fenglin:pitch-draft';

type StoredDraft = {
  resumeId: number | null;
  jobId: number | null;
  result: PitchResultData;
  texts: Record<string, string>;
  savedAt: number;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function clockText(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** MOD-02：自我介绍 60 / 90 / 120 秒三版，可朗读、可计时、草稿存 localStorage。 */
export function Pitch() {
  const { resumes, jobs, activeResume, activeJob, toast } = useApp();
  const tts = useTts();

  const [resumeId, setResumeId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [result, setResult] = useState<PitchResultData | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('60');
  const [generating, setGenerating] = useState(false);
  const [start, setStart] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const [practice, setPractice] = useState<{ duration: number; startedAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  // 初始化上下文：默认当前简历 / 当前岗位
  useEffect(() => {
    if (resumeId !== null || !resumes.length) return;
    const r = activeResume || resumes[0];
    setResumeId(r.id);
  }, [resumes, activeResume, resumeId]);

  useEffect(() => {
    if (jobId !== null || !jobs.length) return;
    const j = activeJob || jobs[0];
    setJobId(j.id);
  }, [jobs, activeJob, jobId]);

  // 恢复本地草稿
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as StoredDraft;
      if (!draft?.result?.versions?.length) return;
      setResult(draft.result);
      setTexts(draft.texts || {});
      if (draft.resumeId) setResumeId(draft.resumeId);
      if (draft.jobId) setJobId(draft.jobId);
      setRestored(true);
    } catch {
      /* localStorage 不可用时静默降级 */
    }
  }, []);

  // 草稿持久化
  useEffect(() => {
    if (!result) return;
    const draft: StoredDraft = { resumeId, jobId, result, texts, savedAt: Date.now() };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* 隐私模式可能写入失败 */
    }
  }, [result, texts, resumeId, jobId]);

  useEffect(() => {
    if (!practice) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [practice]);

  const elapsed = practice ? Math.floor((now - practice.startedAt) / 1000) : 0;
  const remaining = practice ? Math.max(0, practice.duration - elapsed) : 0;

  useEffect(() => {
    if (!practice || remaining > 0) return;
    setPractice(null);
    toast('计时结束，看看这一版是否说完整了', 'ok');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, practice]);

  const generate = async () => {
    if (!resumeId) return toast('请先选择一份简历', 'err');
    setGenerating(true);
    setStart(Date.now());
    setError(null);
    tts.stop();
    try {
      const { jobId: taskId } = await api.generatePitch({ resumeId, jobId });
      for (let i = 0; i < 180; i += 1) {
        await sleep(1200);
        const job = await api.pitchJob(taskId);
        if (job.status === 'done') {
          setResult(job.result);
          setTexts(Object.fromEntries(job.result.versions.map((v) => [String(v.duration), v.text])));
          setTab(String(job.result.versions[0]?.duration || 60));
          setPractice(null);
          setRestored(false);
          toast(job.result.meta.source === 'llm' ? '三版自我介绍已生成' : '模型不可用，已用本地模板生成', job.result.meta.source === 'llm' ? 'ok' : 'err');
          return;
        }
        if (job.status === 'error') {
          setError(job.error?.message || '生成失败');
          return;
        }
      }
      setError('生成仍在后台执行，请稍后重试');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const selected = useMemo(() => {
    const duration = Number(tab);
    return result?.versions.find((v) => v.duration === duration) || result?.versions[0] || null;
  }, [result, tab]);

  const text = selected ? texts[String(selected.duration)] ?? selected.text : '';

  const togglePractice = () => {
    if (!selected) return;
    if (practice) {
      setPractice(null);
      return;
    }
    tts.stop();
    setNow(Date.now());
    setPractice({ duration: selected.duration, startedAt: Date.now() });
  };

  const toggleSpeak = () => {
    if (!selected) return;
    if (tts.speaking) {
      tts.stop();
      return;
    }
    setPractice(null);
    tts.speak(text);
  };

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setResult(null);
    setTexts({});
    setRestored(false);
    setPractice(null);
    tts.stop();
  };

  if (!resumes.length) {
    return (
      <div className="page">
        <PageHeader eyebrow="模块 2 · 自我介绍" title="自我介绍与背稿卡" desc="先生成或导入一份简历，再来生成 60/90/120 秒三版。" />
        <Card>
          <p className="muted">还没有简历。可以先去「模板库」生成初稿，或在「我的简历」粘贴文本。</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="模块 2 · 自我介绍"
        title="自我介绍与背稿卡"
        desc="读取当前简历、目标岗位与 STAR 素材，生成 60 / 90 / 120 秒三版。可逐版修改、朗读、计时，草稿只保存在本机。"
      />

      <Card title="生成设置" subtitle="素材来自简历、目标岗位与经历素材库；缺少事实时会保留「待补充」占位">
        <div className="form-row">
          <Field label="使用简历">
            <select className="input" value={resumeId ?? ''} onChange={(e) => setResumeId(Number(e.target.value) || null)}>
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="目标岗位">
            <select className="input" value={jobId ?? ''} onChange={(e) => setJobId(Number(e.target.value) || null)}>
              <option value="">不关联</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row between wrap gap-8">
          <span className="muted small">
            {result ? `当前草稿对应：${result.resume.title}${result.job ? ` · ${result.job.title}` : ''}` : '还没有生成草稿'}
          </span>
          <div className="row gap-8 wrap">
            {result && (
              <Button size="sm" variant="quiet" onClick={clearDraft}>
                清空本地草稿
              </Button>
            )}
            <Button variant="ink" loading={generating} onClick={() => void generate()}>
              {result ? '重新生成三版' : '生成三版自我介绍'}
            </Button>
          </div>
        </div>
        {generating && <BusyProgress label="正在结合简历与岗位整理三版自我介绍" start={start} note="后台生成，通常 20-40 秒" />}
        {error && <ErrorState message={error} onRetry={() => void generate()} />}
        {restored && !generating && <Callout tone="info">已恢复上次保存在本机的自我介绍草稿。</Callout>}
      </Card>

      {!result && !generating && (
        <Card>
          <p className="muted">点击「生成三版自我介绍」，会按 60 / 90 / 120 秒分别组织内容；生成后可逐版修改并朗读计时。</p>
        </Card>
      )}

      {result && selected && (
        <>
          <Tabs
            value={tab}
            onChange={(key) => {
              setTab(key);
              setPractice(null);
              tts.stop();
            }}
            tabs={result.versions.map((v) => ({ key: String(v.duration), label: `${v.duration} 秒` }))}
          />

          <Card
            title={`${selected.duration} 秒版`}
            subtitle={`约 ${text.replace(/\s/g, '').length} 字 · 按中文口语约 3.5 字/秒估算`}
            extra={
              <span className="row gap-8 wrap">
                <SourceBadge source={result.meta.source} note={result.meta.note} />
                <CopyButton text={text} label="复制全文" />
              </span>
            }
          >
            <div className="row gap-8 wrap">
              <Button size="sm" variant={tts.speaking ? 'danger' : 'ghost'} onClick={toggleSpeak} disabled={!tts.supported}>
                {tts.speaking ? '■ 停止朗读' : '▶ 朗读这一版'}
              </Button>
              {tts.supported && (
                <button type="button" className="q-rate" onClick={tts.cycleRate} title="切换朗读语速">
                  语速 {tts.rate === 1 ? '1.0' : tts.rate}×
                </button>
              )}
              <Button size="sm" variant={practice ? 'danger' : 'quiet'} onClick={togglePractice}>
                {practice ? '结束计时' : `开始 ${selected.duration} 秒计时`}
              </Button>
              {!tts.supported && <span className="speech-na">{tts.note || '当前浏览器不支持语音朗读'}</span>}
            </div>

            {practice && (
              <div className="mt-12">
                <Progress
                  value={Math.min(100, Math.round((elapsed / practice.duration) * 100))}
                  label={
                    <span>
                      已用 {clockText(elapsed)} · 剩余 <strong className="mono">{clockText(remaining)}</strong>
                    </span>
                  }
                />
              </div>
            )}

            <Field label="背稿正文" hint="可以直接在这里改；修改会自动保存在本机，不会上传。">
              <textarea
                className="textarea"
                rows={11}
                value={text}
                onChange={(e) => setTexts((prev) => ({ ...prev, [String(selected.duration)]: e.target.value }))}
              />
            </Field>

            <div className="fb-cols">
              <div>
                <div className="fb-col-title ok">结构要点</div>
                <ul>
                  {(selected.outline || []).map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="fb-col-title warn">朗读建议</div>
                <ul>
                  {(selected.tips || []).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="chip-row mt-12">
              <Chip>{selected.duration} 秒</Chip>
              <Chip tone="ink">草稿存本机</Chip>
              {result.job && <Chip tone="blue">{result.job.title}</Chip>}
            </div>
          </Card>

          <Callout tone="info">
            朗读与计时都只在本机浏览器执行；建议先照着念两遍，再关掉稿子用计时背一遍，最后把不熟的一句改写得更口语。
          </Callout>
        </>
      )}

      {generating && !result && <PageSkeleton variant="cards" label="正在生成三版草稿" />}
    </div>
  );
}
