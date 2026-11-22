import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { ExperienceCard } from '../types';
import { formatDateTime } from '../lib/format';
import { experienceText } from '../components/ExperiencePicker';
import {
  Button,
  Callout,
  Card,
  Chip,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  PageSkeleton,
} from '../components/ui';

const EMPTY_FORM = {
  title: '',
  role: '',
  jobId: '',
  tags: '',
  situation: '',
  task: '',
  action: '',
  result: '',
  metrics: '',
};

type FormState = typeof EMPTY_FORM;

export function Experiences() {
  const { jobs, activeJob, toast } = useApp();
  const [items, setItems] = useState<ExperienceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExperienceCard | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<ExperienceCard | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .experiences({ q: q || undefined, jobId: jobFilter ? Number(jobFilter) : undefined })
      .then((r) => setItems(r.experiences))
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [q, jobFilter]);

  useEffect(load, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, jobId: activeJob ? String(activeJob.id) : '' });
    setOpen(true);
  };

  const openEdit = (card: ExperienceCard) => {
    setEditing(card);
    setForm({
      title: card.title,
      role: card.role,
      jobId: card.job_id ? String(card.job_id) : '',
      tags: card.tags,
      situation: card.situation,
      task: card.task,
      action: card.action,
      result: card.result,
      metrics: card.metrics,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) return toast('请填写素材标题', 'err');
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        role: form.role,
        situation: form.situation,
        task: form.task,
        action: form.action,
        result: form.result,
        metrics: form.metrics,
        tags: form.tags,
        jobId: form.jobId ? Number(form.jobId) : null,
      };
      if (editing) {
        await api.updateExperience(editing.id, body);
        toast('素材卡已更新', 'ok');
      } else {
        await api.createExperience(body);
        toast('素材卡已创建', 'ok');
      }
      setOpen(false);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirming) return;
    try {
      await api.deleteExperience(confirming.id);
      toast('已删除', 'ok');
      setConfirming(null);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'err');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="数据 · 经历素材"
        title="STAR 经历素材库"
        desc="把一段项目或实习拆成情境、任务、行动、结果。一张卡可在模板填写、简历优化和面试出题三处复用，避免每次从零回忆。"
        actions={
          <Button variant="ink" onClick={openCreate}>
            新建素材卡
          </Button>
        }
      />

      <Card className="filter-card">
        <div className="row gap-8 wrap">
          <input
            className="input search"
            aria-label="搜索素材"
            placeholder="搜索标题、行动、结果或标签…"
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
              清空搜索
            </Button>
          )}
          <select className="input" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
            <option value="">全部岗位</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <PageSkeleton variant="cards" label="正在读取素材卡" />}

      {!loading && items.length === 0 && (
        <Card>
          <EmptyState
            icon="◇"
            title={q || jobFilter ? '没有匹配的素材卡' : '还没有经历素材'}
            desc={
              q || jobFilter
                ? '换个关键词或岗位筛选试试。'
                : '先写下你真实做过的一段项目或实习：当时什么背景、你要解决什么、你具体做了什么、结果如何。'
            }
            action={
              <Button variant="ink" onClick={openCreate}>
                新建第一张素材卡
              </Button>
            }
          />
        </Card>
      )}

      <div className="stack">
        {items.map((card) => (
          <Card
            key={card.id}
            title={card.title}
            subtitle={[card.role, card.job_title].filter(Boolean).join(' · ') || undefined}
            extra={<span className="muted small">更新于 {formatDateTime(card.updated_at)}</span>}
          >
            <div className="chip-row">
              {card.tags
                .split(/[,，、\s]+/)
                .filter(Boolean)
                .map((t) => (
                  <Chip key={t} tone="ink">
                    {t}
                  </Chip>
                ))}
              {card.metrics && <Chip tone="amber">指标：{card.metrics.slice(0, 40)}</Chip>}
            </div>
            <dl className="meta-list">
              <dt>情境 S</dt>
              <dd>{card.situation || '—'}</dd>
              <dt>任务 T</dt>
              <dd>{card.task || '—'}</dd>
              <dt>行动 A</dt>
              <dd>{card.action || '—'}</dd>
              <dt>结果 R</dt>
              <dd>{card.result || '—'}</dd>
            </dl>
            <div className="row gap-8 wrap">
              <CopyButton text={experienceText(card)} label="复制 STAR 片段" />
              <Button size="sm" onClick={() => openEdit(card)}>
                编辑
              </Button>
              <button className="danger-link" onClick={() => setConfirming(card)}>
                删除
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        title={editing ? '编辑素材卡' : '新建素材卡'}
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="ink" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </>
        }
      >
        <div className="form-row">
          <Field label="素材标题" required hint="例如：校园二手平台后端重构">
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              data-autofocus
            />
          </Field>
          <Field label="我的角色">
            <input
              className="input"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              placeholder="例如：后端负责人"
            />
          </Field>
        </div>
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
          <Field label="标签" hint="用逗号分隔，例如：后端、性能、团队协作">
            <input className="input" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </Field>
        </div>
        <Field label="情境 S" hint="当时的背景与约束">
          <textarea
            className="textarea"
            rows={2}
            value={form.situation}
            onChange={(e) => setForm((f) => ({ ...f, situation: e.target.value }))}
          />
        </Field>
        <Field label="任务 T" hint="你要解决的具体问题">
          <textarea
            className="textarea"
            rows={2}
            value={form.task}
            onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
          />
        </Field>
        <Field label="行动 A" hint="你个人做了什么，避免只写团队">
          <textarea
            className="textarea"
            rows={3}
            value={form.action}
            onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
          />
        </Field>
        <div className="form-row">
          <Field label="结果 R">
            <textarea
              className="textarea"
              rows={2}
              value={form.result}
              onChange={(e) => setForm((f) => ({ ...f, result: e.target.value }))}
            />
          </Field>
          <Field label="量化指标" hint="没有精确数据时写「待补充：xx%」">
            <textarea
              className="textarea"
              rows={2}
              value={form.metrics}
              onChange={(e) => setForm((f) => ({ ...f, metrics: e.target.value }))}
            />
          </Field>
        </div>
        <Callout tone="info">保存后可在「模板填写」「简历优化」里点「从素材库插入」，面试出题也会参考最近 1-2 张卡。</Callout>
      </Modal>

      <Modal
        open={!!confirming}
        title="删除素材卡"
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirming(null)}>
              再想想
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              确认删除
            </Button>
          </>
        }
      >
        <p>确定删除「{confirming?.title}」吗？已经插入简历的内容不会自动删除。</p>
      </Modal>
    </div>
  );
}
