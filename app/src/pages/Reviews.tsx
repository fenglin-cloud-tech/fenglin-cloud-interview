import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { ReviewItem } from '../types';
import { formatDateTime } from '../lib/format';
import { downloadFrom, downloadText, openPrintView, slugDate } from '../lib/download';
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

const emptyForm = { question: '', myAnswer: '', performance: '', improvement: '', rating: 3, tags: '' };

export function Reviews() {
  const { jobs, activeJob, toast } = useApp();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  const [form, setForm] = useState({ ...emptyForm, jobId: '' as string });
  const [saving, setSaving] = useState(false);
  const [coaching, setCoaching] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ReviewItem | null>(null);

  const load = (keyword = q) => {
    setLoading(true);
    setError(null);
    api
      .reviews(keyword || undefined)
      .then((r) => setItems(r.reviews))
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(''), []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setForm({ ...emptyForm, jobId: activeJob?.id ? String(activeJob.id) : '' });
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (r: ReviewItem) => {
    setForm({
      question: r.question,
      myAnswer: r.my_answer,
      performance: r.performance,
      improvement: r.improvement,
      rating: r.rating,
      tags: r.tags,
      jobId: r.job_id ? String(r.job_id) : '',
    });
    setEditing(r);
    setOpen(true);
  };

  const save = async () => {
    if (!form.question.trim()) return toast('请填写题目', 'err');
    setSaving(true);
    try {
      const payload = {
        question: form.question.trim(),
        myAnswer: form.myAnswer,
        performance: form.performance,
        improvement: form.improvement,
        rating: form.rating,
        tags: form.tags,
        jobId: form.jobId ? Number(form.jobId) : null,
      };
      if (editing) {
        await api.updateReview(editing.id, {
          question: payload.question,
          myAnswer: payload.myAnswer,
          performance: payload.performance,
          improvement: payload.improvement,
          rating: payload.rating,
          tags: payload.tags,
        });
        toast('复盘已更新', 'ok');
      } else {
        await api.createReview(payload);
        toast('复盘已保存', 'ok');
      }
      setOpen(false);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  const coach = async () => {
    if (!form.question.trim()) return toast('先填写题目', 'err');
    setCoaching(true);
    try {
      const { result, meta } = await api.reviewCoach({
        question: form.question,
        answer: form.myAnswer,
        performance: form.performance,
      });
      setForm((f) => ({ ...f, improvement: result.improvement, tags: result.tags.join('、') }));
      toast(meta.source === 'llm' ? '已生成改进建议' : '模型不可用，未生成建议', meta.source === 'llm' ? 'ok' : 'err');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '生成失败', 'err');
    } finally {
      setCoaching(false);
    }
  };

  const remove = async () => {
    if (!confirmDel) return;
    try {
      await api.deleteReview(confirmDel.id);
      toast('已删除', 'ok');
      setConfirmDel(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'err');
    }
  };

  const toBank = async (r: ReviewItem) => {
    try {
      await api.createBankItem({
        question: r.question,
        category: '复盘',
        jobId: r.job_id,
        weak: r.rating <= 2,
      });
      toast('已加入题库', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '加入失败', 'err');
    }
  };

  const exportAll = async () => {
    try {
      const { markdown, count } = await api.exportReviews();
      if (!count) return toast('还没有可导出的复盘', 'err');
      downloadText(`复盘记录-${slugDate()}.md`, markdown);
      toast(`已导出 ${count} 条复盘`, 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '导出失败', 'err');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="模块 3 · 复盘"
        title="复盘记录"
        desc="面试结束不是终点：把「问题、我的回答、实际表现、改进点」写下来，再把反复答不好的题标进题库。"
        actions={
          <>
            <Button onClick={() => void exportAll()}>导出 Markdown</Button>
            <Button
              disabled={!items.length}
              onClick={() => {
                if (!items.length) return toast('还没有可导出的复盘', 'err');
                downloadFrom('/api/reviews/export/docx');
              }}
            >
              下载 Word
            </Button>
            <Button
              disabled={!items.length}
              onClick={() => {
                if (!items.length) return toast('还没有可导出的复盘', 'err');
                openPrintView('/print/reviews');
              }}
            >
              打印 / 存为 PDF
            </Button>
            <Button variant="ink" onClick={openCreate}>
              写一条复盘
            </Button>
          </>
        }
      />

      <Card className="filter-card">
        <div className="row gap-8 wrap">
          <input
            className="input search"
            placeholder="搜索题目或改进点…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
          <Button onClick={() => load()}>搜索</Button>
          {q && (
            <Button variant="quiet" onClick={() => { setQ(''); load(''); }}>
              清空
            </Button>
          )}
          <span className="muted small">共 {items.length} 条</span>
        </div>
      </Card>

      {error && <ErrorState message={error} onRetry={() => load()} />}
      {loading && <Loading label="读取复盘" lines={2} />}

      {!loading && items.length === 0 && (
        <Card>
          <EmptyState
            icon="✎"
            title={q ? '没有匹配的复盘' : '还没有复盘记录'}
            desc={q ? '换个关键词试试。' : '可以手动写，也可以在面试报告页一键生成复盘草稿。'}
            action={
              <Button variant="ink" onClick={openCreate}>
                写第一条
              </Button>
            }
          />
        </Card>
      )}

      <div className="review-list">
        {items.map((r) => (
          <Card key={r.id} className="review-card">
            <div className="review-head">
              <h3>{r.question}</h3>
              <div className="row gap-8 wrap">
                {r.job_title && <Chip tone="blue">{r.job_title}</Chip>}
                <span className="rating">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
              </div>
            </div>
            <div className="review-body">
              <div>
                <div className="rv-label">我的回答</div>
                <p>{r.my_answer || '（未填写）'}</p>
              </div>
              <div>
                <div className="rv-label">实际表现</div>
                <p>{r.performance || '（未填写）'}</p>
              </div>
              <div>
                <div className="rv-label">改进点</div>
                <p>{r.improvement || '（未填写）'}</p>
              </div>
            </div>
            <div className="review-foot">
              <span className="muted small">
                {formatDateTime(r.created_at)}
                {r.tags ? ` · ${r.tags}` : ''}
              </span>
              <div className="row gap-8 wrap">
                <Button size="sm" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Button size="sm" variant="quiet" onClick={() => void toBank(r)}>
                  加入题库
                </Button>
                <button className="danger-link" onClick={() => setConfirmDel(r)}>
                  删除
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        title={editing ? '编辑复盘' : '写一条复盘'}
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="ink" onClick={() => void save()} loading={saving}>
              保存
            </Button>
          </>
        }
      >
        <Field label="题目" required>
          <input
            className="input"
            value={form.question}
            onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
            placeholder="当时被问到的原题"
          />
        </Field>
        <div className="form-row">
          <Field label="关联岗位">
            <select className="input" value={form.jobId} onChange={(e) => setForm((f) => ({ ...f, jobId: e.target.value }))}>
              <option value="">不关联</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="自评（1-5 星）">
            <div className="rating-input">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={form.rating === n ? 'on' : ''}
                  onClick={() => setForm((f) => ({ ...f, rating: n }))}
                >
                  ★
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field label="我的回答">
          <textarea className="textarea" rows={4} value={form.myAnswer} onChange={(e) => setForm((f) => ({ ...f, myAnswer: e.target.value }))} />
        </Field>
        <Field label="实际表现" hint="当时卡在哪、面试官什么反应、结果如何">
          <textarea
            className="textarea"
            rows={3}
            value={form.performance}
            onChange={(e) => setForm((f) => ({ ...f, performance: e.target.value }))}
          />
        </Field>
        <Field label="改进点" hint="写可执行的下一步，不要写「多练习」">
          <textarea
            className="textarea"
            rows={3}
            value={form.improvement}
            onChange={(e) => setForm((f) => ({ ...f, improvement: e.target.value }))}
          />
        </Field>
        <div className="row between wrap gap-8">
          <Field label="标签" hint="用「、」分隔，例如：STAR、量化、项目细节">
            <input className="input" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </Field>
          <Button onClick={() => void coach()} loading={coaching}>
            AI 帮我想改进点
          </Button>
        </div>
        <Callout tone="info">AI 只给建议，不会自动写入；确认后再保存。</Callout>
      </Modal>

      <Modal
        open={!!confirmDel}
        title="删除复盘"
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
        <p>删除后不可恢复。如果只是想降低权重，可以把它留在题库里并取消「薄弱」标记。</p>
      </Modal>
    </div>
  );
}
