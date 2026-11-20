import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { BankItem } from '../types';
import { formatDateTime } from '../lib/format';
import {
  Button,
  Callout,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  PageHeader,
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
  const [selected, setSelected] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [newCat, setNewCat] = useState('专业');
  const [newJob, setNewJob] = useState('');
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .bank({ category: category || undefined, weak: weakOnly })
      .then((r) => {
        setItems(r.items);
        setFacets(r.facets);
        setTotals(r.totals);
        setSelected((prev) => prev.filter((id) => r.items.some((i) => i.id === id)));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [category, weakOnly]);

  useEffect(load, [load]);

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
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'err');
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
      {loading && <Loading label="读取题库" lines={3} />}

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
                  {b.source === 'interview' ? '面试沉淀' : b.source === 'review' ? '复盘加入' : '手动添加'}
                </Chip>
                {b.last_score != null && <span className="muted small">上次 {b.last_score} 分</span>}
                <span className="muted small">练习 {b.ask_count} 次</span>
                {b.last_practiced_at && <span className="muted small">最近 {formatDateTime(b.last_practiced_at)}</span>}
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
              <button className="danger-link" onClick={() => void remove(b)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected.length > 0 && (
        <div className="dock">
          <span>已选 {selected.length} 道</span>
          <div className="row gap-8">
            <Button size="sm" variant="quiet" onClick={() => setSelected([])}>
              取消
            </Button>
            <Button size="sm" variant="ink" onClick={() => void practice()} loading={starting}>
              开始再练
            </Button>
          </div>
        </div>
      )}

      <Callout tone="info">
        题库里的题会作为「追问」的素材，也会在「从题库再练」里逐题重答；答完后分数会回写到这道题上。
      </Callout>
    </div>
  );
}
