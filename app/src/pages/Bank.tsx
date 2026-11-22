import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { BankItem, ReviewPlan, ReviewResult, ReviewResultRecord, ReviewTask } from '../types';
import { formatDate, formatDateTime } from '../lib/format';
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
  Stat,
} from '../components/ui';

export function Bank() {
  const navigate = useNavigate();
  const { toast, jobs } = useApp();
  const [items, setItems] = useState<BankItem[]>([]);
  const [facets, setFacets] = useState<{ category: string; n: number }[]>([]);
  const [totals, setTotals] = useState({ total: 0, weak: 0, asks: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [weakOnly, setWeakOnly] = useState(false);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<BankItem | null>(null);
  const [editForm, setEditForm] = useState({ question: '', category: '专业', jobId: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [newCat, setNewCat] = useState('专业');
  const [newJob, setNewJob] = useState('');
  const [starting, setStarting] = useState(false);

  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [queue, setQueue] = useState<ReviewTask[]>([]);
  const [step, setStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [lastResult, setLastResult] = useState<ReviewResultRecord | null>(null);

  const load = useCallback(
    (cursor?: number | null) => {
      const appending = !!cursor;
      if (appending) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      api
        .bank({ category: category || undefined, weak: weakOnly, q: q || undefined, cursor, limit: 50 })
        .then((r) => {
          setItems((prev) => (appending ? [...prev, ...r.items] : r.items));
          setNextCursor(r.nextCursor);
          setFacets(r.facets);
          setTotals(r.totals);
          if (!appending) setSelected((prev) => prev.filter((id) => r.items.some((i) => i.id === id)));
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [category, weakOnly, q],
  );

  useEffect(() => load(), [load]);

  const loadPlan = useCallback(() => {
    setPlanError(null);
    api
      .reviewPlan()
      .then(setPlan)
      .catch((e) => setPlanError(e instanceof ApiError ? e.message : '排程读取失败'));
  }, []);

  useEffect(loadPlan, [loadPlan]);

  const startReview = () => {
    if (!plan?.tasks.length) return;
    setQueue(plan.tasks);
    setStep(0);
    setLastResult(null);
  };

  const closeReview = () => {
    setQueue([]);
    setStep(0);
    setLastResult(null);
  };

  const record = async (result: ReviewResult) => {
    const task = queue[step];
    if (!task || recording) return;
    setRecording(true);
    try {
      const rec = await api.recordReviewResult(task.kind, task.refId, result);
      setLastResult(rec);
      loadPlan();
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '记录失败', 'err');
    } finally {
      setRecording(false);
    }
  };

  const nextTask = () => {
    if (step + 1 >= queue.length) {
      closeReview();
      toast('今日复习完成', 'ok');
      return;
    }
    setStep((s) => s + 1);
    setLastResult(null);
  };

  const add = async () => {
    if (!newQ.trim()) return toast('请填写题目', 'err');
    try {
      await api.createBankItem({
        question: newQ.trim(),
        category: newCat,
        jobId: newJob ? Number(newJob) : null,
      });
      setNewQ('');
      setAdding(false);
      toast('已加入题库', 'ok');
      load();
      loadPlan();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '添加失败', 'err');
    }
  };

  const toggleWeak = async (item: BankItem) => {
    try {
      await api.updateBankItem(item.id, { weak: item.weak !== 1 });
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, weak: item.weak === 1 ? 0 : 1 } : x)));
      setTotals((t) => ({ ...t, weak: t.weak + (item.weak === 1 ? -1 : 1) }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '更新失败', 'err');
    }
  };

  const remove = async (item: BankItem) => {
    try {
      await api.deleteBankItem(item.id);
      toast('已删除', 'ok');
      load();
      loadPlan();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'err');
    }
  };

  const openEdit = (b: BankItem) => {
    setEditing(b);
    setEditForm({ question: b.question, category: b.category, jobId: b.job_id ? String(b.job_id) : '' });
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editForm.question.trim()) return toast('题目不能为空', 'err');
    setSavingEdit(true);
    try {
      await api.updateBankItem(editing.id, {
        question: editForm.question.trim(),
        category: editForm.category,
        jobId: editForm.jobId ? Number(editForm.jobId) : null,
      });
      toast('题目已更新', 'ok');
      setEditing(null);
      load();
      loadPlan();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSavingEdit(false);
    }
  };

  const batchSetWeak = async (weak: boolean) => {
    if (!selected.length) return;
    setBatchBusy(true);
    try {
      await Promise.all(selected.map((id) => api.updateBankItem(id, { weak })));
      toast(weak ? `已标记 ${selected.length} 道为薄弱` : `已取消 ${selected.length} 道的薄弱标记`, 'ok');
      setSelected([]);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '批量更新失败', 'err');
    } finally {
      setBatchBusy(false);
    }
  };

  const batchRemove = async () => {
    if (!selected.length) return;
    if (!window.confirm(`确认删除选中的 ${selected.length} 道题？删除后不可恢复。`)) return;
    setBatchBusy(true);
    try {
      await Promise.all(selected.map((id) => api.deleteBankItem(id)));
      toast(`已删除 ${selected.length} 道题`, 'ok');
      setSelected([]);
      load();
      loadPlan();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '批量删除失败', 'err');
    } finally {
      setBatchBusy(false);
    }
  };

  const practice = async () => {
    if (!selected.length) return;
    setStarting(true);
    try {
      const session = await api.createInterview({ mode: 'bank', bankIds: selected });
      navigate(`/interviews/${session.interview.id}/session`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '创建练习失败', 'err');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="模块 3 · 个人题库"
        title="个人题库"
        desc="每场面试结束，题目会自动沉淀到这里。标记薄弱项，再从题库抽题重练——这是闭环的最后一环，也是下一轮的开始。"
        actions={
          <>
            <Button onClick={() => setAdding((v) => !v)}>{adding ? '收起' : '手动加题'}</Button>
            <Button variant="ink" disabled={selected.length === 0} onClick={() => void practice()} loading={starting}>
              再练选中的 {selected.length} 道
            </Button>
          </>
        }
      />

      <section className="card sched-card">
        <div className="sched-info">
          <div className="sched-eyebrow">记忆曲线 · 今日待复习</div>
          {plan && plan.dueCount > 0 ? (
            <>
              <div className="sched-count">
                <strong>{plan.dueCount}</strong> 道题到期
                {plan.overdueCount > 0 && <span className="sched-badge">{plan.overdueCount} 道已逾期</span>}
              </div>
              <p className="sched-note">
                按上次练习时间、复盘自评（星级）与薄弱标记排期；间隔档位 {plan.ladder.join(' / ')} 天，记住了升一档，有点模糊保持当前档，没记住回到 1 天。
              </p>
            </>
          ) : (
            <>
              <div className="sched-count quiet">
                {plan ? '今天没有待复习的题' : planError ? '复习排程读取失败' : '正在读取今日排程…'}
              </div>
              <p className="sched-note">
                {plan
                  ? plan.scheduled > 0 && plan.nextDueAt
                    ? `下一批 ${formatDate(plan.nextDueAt)} 到期，届时再来。`
                    : '题库和复盘里还没有可排期的题，先沉淀几道题吧。'
                  : planError || '排程依据真实练习与复盘数据生成，不会凑数。'}
              </p>
            </>
          )}
        </div>
        <div className="sched-actions">
          {plan && plan.dueCount > 0 && (
            <Button variant="ink" onClick={startReview}>
              开始复习
            </Button>
          )}
          {planError && (
            <Button size="sm" onClick={loadPlan}>
              重试
            </Button>
          )}
        </div>
      </section>

      <div className="stats-row tight">
        <Stat label="题目总数" value={totals.total} />
        <Stat label="薄弱项" value={totals.weak} hint="反复答不好的题" />
        <Stat label="被练习次数" value={totals.asks} hint="含面试自动沉淀" />
      </div>

      {adding && (
        <Card title="手动添加题目" className="add-card">
          <div className="form-row">
            <Field label="分类">
              <select className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                {['专业', '行为', '自我介绍', '反问', '复盘'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="关联岗位">
              <select className="input" value={newJob} onChange={(e) => setNewJob(e.target.value)}>
                <option value="">不关联</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="题目" required>
            <textarea className="textarea" rows={3} value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="例如：你项目里的数据是怎么统计的？" />
          </Field>
          <Button variant="ink" onClick={() => void add()}>
            加入题库
          </Button>
        </Card>
      )}

      <Card className="filter-card">
        <div className="row gap-8 wrap">
          <input
            className="input search"
            aria-label="搜索题库"
            placeholder="搜索题目…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setQ(qInput)}
          />
          <Button size="sm" onClick={() => setQ(qInput)}>
            搜索
          </Button>
          {q && (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setQInput('');
                setQ('');
              }}
            >
              清空
            </Button>
          )}
          <button className={`filter-chip ${category === '' ? 'on' : ''}`} onClick={() => setCategory('')}>
            全部 {totals.total}
          </button>
          {facets.map((f) => (
            <button
              key={f.category}
              className={`filter-chip ${category === f.category ? 'on' : ''}`}
              onClick={() => setCategory(f.category)}
            >
              {f.category} {f.n}
            </button>
          ))}
          <label className="switch">
            <input type="checkbox" checked={weakOnly} onChange={(e) => setWeakOnly(e.target.checked)} />
            <span>只看薄弱</span>
          </label>
        </div>
      </Card>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <PageSkeleton variant="cards" label="正在读取题库" />}

      {!loading && items.length === 0 && (
        <Card>
          <EmptyState
            icon="▤"
            title={weakOnly ? '还没有薄弱项' : '题库还是空的'}
            desc={
              weakOnly
                ? '完成一场模拟面试后，低分题会自动标为薄弱；也可以在题目右上角手动标星。'
                : '完成一场模拟面试，题目会自动沉淀；也可以手动添加。'
            }
            action={
              <Button variant="ink" onClick={() => navigate('/interviews')}>
                去模拟面试
              </Button>
            }
          />
        </Card>
      )}

      {items.length > 0 && (
        <div className="bank-head">
          <label className="check-all">
            <input
              type="checkbox"
              checked={selected.length === items.length && items.length > 0}
              onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id) : [])}
            />
            全选本页
          </label>
          <span className="muted small">点题目标星可切换薄弱标记</span>
        </div>
      )}

      <div className="bank-list">
        {items.map((b) => (
          <div key={b.id} className={`bank-item ${selected.includes(b.id) ? 'on' : ''} ${b.weak ? 'weak' : ''}`}>
            <label className="bank-check">
              <input
                type="checkbox"
                checked={selected.includes(b.id)}
                onChange={(e) =>
                  setSelected((prev) => (e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id)))
                }
              />
            </label>
            <div className="bank-body">
              <p className="bank-q">{b.question}</p>
              <div className="bank-meta">
                <Chip tone="ink">{b.category}</Chip>
                <Chip tone={b.source === 'interview' ? 'blue' : b.source === 'review' ? 'amber' : 'default'}>
                  {b.source === 'interview'
                    ? '面试沉淀'
                    : b.source === 'review'
                      ? '复盘加入'
                      : b.source === 'common'
                        ? '常见题'
                        : '手动添加'}
                </Chip>
                {b.last_score != null && <span className="muted small">上次 {b.last_score} 分</span>}
                <span className="muted small">练习 {b.ask_count} 次</span>
                {b.last_practiced_at && <span className="muted small">最近 {formatDateTime(b.last_practiced_at)}</span>}
                {b.next_review_at &&
                  (plan && b.next_review_at <= plan.today ? (
                    <span className="bank-due">今日到期</span>
                  ) : (
                    <span className="muted small">下次复习 {formatDate(b.next_review_at)}</span>
                  ))}
              </div>
            </div>
            <div className="bank-actions">
              <button
                className={`star ${b.weak ? 'on' : ''}`}
                title={b.weak ? '取消薄弱标记' : '标记为薄弱'}
                onClick={() => void toggleWeak(b)}
              >
                {b.weak ? '★' : '☆'}
              </button>
              <button className="link-btn" onClick={() => openEdit(b)}>
                编辑
              </button>
              <button className="danger-link" onClick={() => void remove(b)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {nextCursor && (
        <div className="row gap-8" style={{ justifyContent: 'center', marginTop: 12 }}>
          <Button size="sm" variant="quiet" loading={loadingMore} onClick={() => load(nextCursor)}>
            加载更多
          </Button>
        </div>
      )}

      {selected.length > 0 && (
        <div className="dock">
          <span>已选 {selected.length} 道</span>
          <div className="row gap-8 wrap">
            <Button size="sm" variant="quiet" onClick={() => setSelected([])}>
              取消
            </Button>
            <Button size="sm" variant="quiet" disabled={batchBusy} onClick={() => void batchSetWeak(true)}>
              标为薄弱
            </Button>
            <Button size="sm" variant="quiet" disabled={batchBusy} onClick={() => void batchSetWeak(false)}>
              取消薄弱
            </Button>
            <Button size="sm" variant="quiet" disabled={batchBusy} onClick={() => void batchRemove()}>
              批量删除
            </Button>
            <Button size="sm" variant="ink" onClick={() => void practice()} loading={starting}>
              开始再练
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={queue.length > 0}
        title="今日复习"
        onClose={closeReview}
        wide
        footer={
          lastResult ? (
            <>
              <Button variant="quiet" onClick={closeReview}>
                先到这里
              </Button>
              <Button variant="ink" onClick={nextTask}>
                {step + 1 >= queue.length ? '完成' : '下一题'}
              </Button>
            </>
          ) : (
            <Button variant="quiet" onClick={closeReview}>
              关闭
            </Button>
          )
        }
      >
        {queue[step] && (
          <>
            <div className="sched-progress">
              第 {step + 1} / {queue.length} 题
              <span className="muted small">
                {queue[step].kind === 'bank' ? '题库' : '复盘'}
                {queue[step].jobTitle ? ` · ${queue[step].jobTitle}` : ''}
              </span>
            </div>
            <h3 className="sched-question">{queue[step].question}</h3>
            <div className="bank-meta sched-meta">
              {queue[step].category && <Chip tone="ink">{queue[step].category}</Chip>}
              {queue[step].weak === 1 && <Chip tone="amber">薄弱</Chip>}
              {queue[step].rating != null && <span className="muted small">复盘自评 {queue[step].rating} 星</span>}
              {queue[step].lastScore != null && <span className="muted small">上次 {queue[step].lastScore} 分</span>}
              <span className={queue[step].overdueDays > 0 ? 'bank-due' : 'muted small'}>
                {queue[step].overdueDays > 0 ? `逾期 ${queue[step].overdueDays} 天` : '今日到期'}
              </span>
              {queue[step].reps > 0 && <span className="muted small">已复习 {queue[step].reps} 次</span>}
            </div>

            {(queue[step].myAnswer || queue[step].improvement) && (
              <div className="sched-ref">
                {queue[step].myAnswer && (
                  <div>
                    <div className="rv-label">上次的回答</div>
                    <p>{queue[step].myAnswer}</p>
                  </div>
                )}
                {queue[step].improvement && (
                  <div>
                    <div className="rv-label">改进点</div>
                    <p>{queue[step].improvement}</p>
                  </div>
                )}
              </div>
            )}

            {lastResult ? (
              <div className="sched-result">
                <strong>{lastResult.resultLabel}</strong>
                <p>
                  下次复习：{formatDate(lastResult.dueAt)}（{lastResult.intervalDays} 天后 · 第 {lastResult.stage + 1} 档）
                </p>
              </div>
            ) : (
              <>
                <p className="sched-ask">先在心里过一遍这题，再如实选择掌握程度：</p>
                <div className="sched-btns">
                  <Button variant="ink" onClick={() => void record('good')} loading={recording}>
                    记住了
                  </Button>
                  <Button onClick={() => void record('ok')} disabled={recording}>
                    有点模糊
                  </Button>
                  <Button variant="quiet" onClick={() => void record('again')} disabled={recording}>
                    没记住
                  </Button>
                </div>
                <Callout tone="info">
                  记住了升一档、有点模糊保持当前档、没记住回到 1 天；档位依次为 {plan?.ladder.join(' / ') || '1 / 3 / 7 / 14 / 30'} 天。
                </Callout>
              </>
            )}
          </>
        )}
      </Modal>

      <Modal
        open={!!editing}
        title="编辑题目"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button variant="ink" loading={savingEdit} onClick={() => void saveEdit()}>
              保存
            </Button>
          </>
        }
      >
        <Field label="题目" required>
          <textarea
            className="textarea"
            rows={3}
            value={editForm.question}
            onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
          />
        </Field>
        <div className="form-row">
          <Field label="分类">
            <select
              className="input"
              value={editForm.category}
              onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
            >
              {['专业', '行为', '自我介绍', '反问', '复盘'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="关联岗位">
            <select
              className="input"
              value={editForm.jobId}
              onChange={(e) => setEditForm((f) => ({ ...f, jobId: e.target.value }))}
            >
              <option value="">不关联</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Modal>

      <Callout tone="info">
        题库里的题会作为「追问」的素材，也会在「从题库再练」里逐题重答；答完后分数会回写到这道题上。
      </Callout>
    </div>
  );
}
