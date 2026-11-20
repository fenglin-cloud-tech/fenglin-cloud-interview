import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { BankItem, InterviewListItem } from '../types';
import { ROUND_LABEL, formatDateTime, relativeTime } from '../lib/format';
import {
  Button,
  Callout,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  PageSkeleton,
} from '../components/ui';

const FALLBACK_DIRECTIONS = [
  { key: 'backend', label: '后端开发', desc: '', count: 12 },
  { key: 'frontend', label: '前端开发', desc: '', count: 12 },
  { key: 'data', label: '数据分析', desc: '', count: 12 },
  { key: 'product', label: '产品经理', desc: '', count: 12 },
  { key: 'operations', label: '运营', desc: '', count: 12 },
];

export function Interviews() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { resumes, jobs, activeResume, activeJob, toast } = useApp();

  const [list, setList] = useState<InterviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [resumeId, setResumeId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [mode, setMode] = useState<'resume' | 'bank' | 'common' | 'mixed'>('resume');
  const [direction, setDirection] = useState('backend');
  const [common, setCommon] = useState<Awaited<ReturnType<typeof api.commonQuestions>> | null>(null);
  const [bankItems, setBankItems] = useState<BankItem[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [starting, setStarting] = useState(false);
  const [confirmDel, setConfirmDel] = useState<InterviewListItem | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .interviews()
      .then((r) => setList(r.interviews))
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // 上下文是异步加载的：等简历/岗位到齐后再补默认值，避免一进来就点「开始」却提示未选简历
  useEffect(() => {
    if (resumeId !== null || resumes.length === 0) return;
    const rid = params.get('resumeId');
    const r = (rid ? resumes.find((x) => x.id === Number(rid)) : null) || activeResume || resumes[0];
    if (r) setResumeId(r.id);
  }, [resumes, activeResume, params, resumeId]);

  useEffect(() => {
    if (jobId !== null || jobs.length === 0) return;
    const j = activeJob || jobs[0];
    if (j) setJobId(j.id);
  }, [jobs, activeJob, jobId]);

  useEffect(() => {
    api.commonQuestions().then(setCommon).catch(() => setCommon(null));
  }, []);

  useEffect(() => {
    if (mode !== 'bank') return;
    api
      .bank()
      .then((r) => {
        setBankItems(r.items);
        setSelected(r.items.filter((i) => i.weak === 1).map((i) => i.id).slice(0, 5));
      })
      .catch(() => setBankItems([]));
  }, [mode]);

  const start = async () => {
    if ((mode === 'resume' || mode === 'mixed') && !resumeId) return toast('请先选择一份简历', 'err');
    if (mode === 'bank' && selected.length === 0) return toast('请至少勾选 1 道题', 'err');
    if ((mode === 'common' || mode === 'mixed') && !direction) return toast('请选择一个常见题方向', 'err');
    setStarting(true);
    try {
      const session = await api.createInterview({
        mode,
        direction: mode === 'common' || mode === 'mixed' ? direction : undefined,
        resumeId,
        jobId,
        bankIds: mode === 'bank' ? selected : undefined,
      });
      navigate(`/interviews/${session.interview.id}/session`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '创建面试失败', 'err');
    } finally {
      setStarting(false);
    }
  };

  const remove = async () => {
    if (!confirmDel) return;
    try {
      await api.deleteInterview(confirmDel.id);
      toast('已删除该场面试', 'ok');
      setConfirmDel(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'err');
    }
  };

  const canResume = resumeId && resumes.find((r) => r.id === resumeId)?.content.trim();
  const dirs = common?.directions ?? FALLBACK_DIRECTIONS;
  const dirLabel = dirs.find((d) => d.key === direction)?.label ?? '后端开发';
  const samples = common?.questions.filter((q) => q.direction === direction).slice(0, 3) ?? [];
  const commonSource = common?.source ?? '社区常见题型整理 / 通用高频题';

  return (
    <div className="page">
      <PageHeader
        eyebrow="模块 2 · 模拟面试"
        title="开一场针对你简历的面试"
        desc="可以只用简历题，也可以混入按岗位方向整理的常见题。四轮推进，追问最多两层，答完逐题给三维反馈。"
      />

      <div className="interview-top">
        <Card className="setup-card" title="新建面试" subtitle="选简历 → 选岗位 → 开始。岗位可留空，题目会更通用。">
          <div className="form-row">
            <Field label="使用简历" required>
              <select className="input" value={resumeId ?? ''} onChange={(e) => setResumeId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">请选择</option>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="目标岗位">
              <select className="input" value={jobId ?? ''} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">不关联</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="seg seg-wrap" role="group" aria-label="出题方式">
            <button className={mode === 'resume' ? 'on' : ''} aria-pressed={mode === 'resume'} onClick={() => setMode('resume')}>
              只用简历题
            </button>
            <button className={mode === 'mixed' ? 'on' : ''} aria-pressed={mode === 'mixed'} onClick={() => setMode('mixed')}>
              简历 + 常见题
            </button>
            <button className={mode === 'common' ? 'on' : ''} aria-pressed={mode === 'common'} onClick={() => setMode('common')}>
              只用常见题
            </button>
            <button className={mode === 'bank' ? 'on' : ''} aria-pressed={mode === 'bank'} onClick={() => setMode('bank')}>
              从题库再练
            </button>
          </div>

          {(mode === 'common' || mode === 'mixed') && (
            <div className="common-panel">
              <div className="common-panel-head">
                <span className="common-panel-title">常见面试题 · 按岗位方向</span>
                <span className="common-panel-count">
                  {commonSource} · 共 {common?.total ?? 60} 题
                </span>
              </div>
              <p className="common-panel-note">
                来源性质：社区常见题型整理 / 通用高频题，由本项目人工整理；不是任何公司的官方真题，也不含「公司名 + 年份」的出处标签。
              </p>
              <Field label="岗位方向" required hint="按方向抽取技术基础、项目深挖与行为面试题">
                <select className="input" value={direction} onChange={(e) => setDirection(e.target.value)}>
                  {dirs.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}（{d.count} 题）
                    </option>
                  ))}
                </select>
              </Field>
              {samples.length > 0 && (
                <ul className="common-samples" aria-label={`${dirLabel}常见题示例`}>
                  {samples.map((q) => (
                    <li key={q.id}>
                      <span className="common-kind">
                        {q.kind === 'technical' ? '技术基础' : q.kind === 'project' ? '项目深挖' : '行为面试'}
                      </span>
                      <span>{q.question}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mode === 'bank' && (
            <div className="bank-picker">
              {bankItems.length === 0 ? (
                <Callout tone="warn">
                  题库还是空的。先跑一场按简历出题的面试，结束后题目会自动沉淀到题库。
                </Callout>
              ) : (
                <>
                  <div className="muted small">勾选要练的题（默认选中薄弱项，最多建议 5 道）</div>
                  <div className="pick-list">
                    {bankItems.slice(0, 20).map((b) => (
                      <label key={b.id} className={`pick ${selected.includes(b.id) ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selected.includes(b.id)}
                          onChange={(e) =>
                            setSelected((prev) => (e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id)))
                          }
                        />
                        <span className="pick-q">{b.question}</span>
                        <span className="pick-meta">
                          {b.weak === 1 && <Chip tone="red">薄弱</Chip>}
                          <span className="muted small">{b.category}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="setup-foot">
            <div className="rounds-preview">
              {['自我介绍', '专业能力', '行为面试', '反问环节'].map((r, i) => (
                <span key={r} className="round-pill">
                  <i>{['壹', '貳', '參', '肆'][i]}</i>
                  {r}
                </span>
              ))}
            </div>
            <Button variant="ink" size="lg" onClick={() => void start()} loading={starting}>
              开始面试
            </Button>
          </div>
          {(mode === 'resume' || mode === 'mixed') && !canResume && (
            <Callout tone="warn">所选简历内容为空，先去「我的简历」补全。</Callout>
          )}
          {mode === 'common' && (
            <p className="common-foot">常见题专项不需要简历，会按所选方向抽题；答完可在反馈区一键加入个人题库。</p>
          )}
        </Card>

        <Card title="过去 50 场" subtitle="未完成的可以继续作答" className="history-card">
          {error && <ErrorState message={error} onRetry={load} />}
          {loading && <PageSkeleton variant="cards" label="正在读取面试记录" />}
          {!loading && list.length === 0 && (
            <EmptyState icon="◷" title="还没有面试记录" desc="左边选好简历，点「开始面试」即可。" />
          )}
          <ul className="interview-list">
            {list.map((iv) => (
              <li key={iv.id}>
                <div className="iv-main">
                  <div className="iv-title">
                    {iv.job_title || iv.resume_title || '未命名面试'}
                    <Chip tone={iv.status === 'finished' ? 'green' : 'amber'}>
                      {iv.status === 'finished' ? '已完成' : '进行中'}
                    </Chip>
                  </div>
                  <div className="iv-sub">
                    {formatDateTime(iv.started_at)} · {relativeTime(iv.started_at)} · 已答 {iv.answered} 题 ·{' '}
                    {iv.mode === 'bank'
                      ? '题库再练'
                      : iv.mode === 'common'
                        ? '常见题专项'
                        : iv.mode === 'mixed'
                          ? '简历 + 常见题'
                          : ROUND_LABEL[iv.round_key] || '面试'}
                  </div>
                </div>
                <div className="iv-actions">
                  {iv.status === 'finished' ? (
                    <>
                      <span className="iv-score">{iv.overall_score ?? '—'} 分</span>
                      <Button size="sm" onClick={() => navigate(`/interviews/${iv.id}/report`)}>
                        报告
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ink" onClick={() => navigate(`/interviews/${iv.id}/session`)}>
                      继续
                    </Button>
                  )}
                  <button className="danger-link" onClick={() => setConfirmDel(iv)}>
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Modal
        open={!!confirmDel}
        title="删除面试"
        onClose={() => setConfirmDel(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmDel(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              确认删除
            </Button>
          </>
        }
      >
        <p>删除后本场问答与反馈不可恢复，已沉淀到题库的题目会保留。</p>
      </Modal>
    </div>
  );
}
