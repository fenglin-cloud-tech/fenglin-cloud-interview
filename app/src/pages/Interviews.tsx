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
  Loading,
  Modal,
  PageHeader,
} from '../components/ui';

export function Interviews() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { resumes, jobs, activeResume, activeJob, toast } = useApp();

  const [list, setList] = useState<InterviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [resumeId, setResumeId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [mode, setMode] = useState<'resume' | 'bank'>('resume');
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
    if (mode === 'resume' && !resumeId) return toast('请先选择一份简历', 'err');
    if (mode === 'bank' && selected.length === 0) return toast('请至少勾选 1 道题', 'err');
    setStarting(true);
    try {
      const session = await api.createInterview({
        mode,
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

  return (
    <div className="page">
      <PageHeader
        eyebrow="模块 2 · 模拟面试"
        title="开一场针对你简历的面试"
        desc="问题从你的项目经历和目标岗位里长出来，不是通用题库。四轮推进，追问最多两层，答完逐题给三维反馈。"
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

          <div className="seg">
            <button className={mode === 'resume' ? 'on' : ''} onClick={() => setMode('resume')}>
              按简历出题
            </button>
            <button className={mode === 'bank' ? 'on' : ''} onClick={() => setMode('bank')}>
              从题库再练
            </button>
          </div>

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
          {mode === 'resume' && !canResume && <Callout tone="warn">所选简历内容为空，先去「我的简历」补全。</Callout>}
        </Card>

        <Card title="过去 50 场" subtitle="未完成的可以继续作答" className="history-card">
          {error && <ErrorState message={error} onRetry={load} />}
          {loading && <Loading label="读取记录" lines={2} />}
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
                    {iv.mode === 'bank' ? '题库再练' : ROUND_LABEL[iv.round_key] || '面试'}
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
