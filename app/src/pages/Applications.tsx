import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { Button, Callout, Card, Chip, EmptyState, Field, Modal, PageHeader, PageSkeleton } from '../components/ui';
import { useApp } from '../state';
import type { ApplicationRecord, ApplicationStage } from '../types';

const STAGES: { key: ApplicationStage; label: string; tone: 'default' | 'red' | 'green' | 'amber' | 'ink' | 'blue' }[] = [
  { key: 'applied', label: '已投递', tone: 'blue' },
  { key: 'written', label: '笔试', tone: 'blue' },
  { key: 'interview1', label: '一面', tone: 'amber' },
  { key: 'interview2', label: '二面', tone: 'amber' },
  { key: 'hr', label: 'HR 面', tone: 'ink' },
  { key: 'offer', label: '已发 offer', tone: 'green' },
  { key: 'rejected', label: '已拒', tone: 'red' },
  { key: 'withdrawn', label: '自己放弃', tone: 'default' },
];

const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<
  ApplicationStage,
  (typeof STAGES)[number]
>;

const IN_INTERVIEW: ApplicationStage[] = ['interview1', 'interview2', 'hr', 'offer'];
const ACTIVE: ApplicationStage[] = ['applied', 'written', 'interview1', 'interview2', 'hr'];

function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

function emptyForm() {
  return { company: '', title: '', jobId: '', appliedOn: today(), stage: 'applied' as ApplicationStage, note: '' };
}

export function Applications() {
  const { jobs, toast } = useApp();
  const [apps, setApps] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | ApplicationStage>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApplicationRecord | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.applicationDetail>> | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [pickInterview, setPickInterview] = useState('');
  const [pickReview, setPickReview] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ApplicationRecord | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.applications();
      setApps(r.applications);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '投递记录加载失败', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const loadDetail = async (id: number) => {
    try {
      const r = await api.applicationDetail(id);
      setDetail(r);
      setDetailId(id);
      setPickInterview('');
      setPickReview('');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '投递详情加载失败', 'err');
    }
  };

  const stats = useMemo(() => {
    const total = apps.length;
    const interviewed = apps.filter((a) => IN_INTERVIEW.includes(a.stage)).length;
    const offers = apps.filter((a) => a.stage === 'offer').length;
    const active = apps.filter((a) => ACTIVE.includes(a.stage)).length;
    const closed = apps.filter((a) => a.stage === 'rejected' || a.stage === 'withdrawn').length;
    return {
      total,
      interviewed,
      offers,
      active,
      closed,
      interviewRate: total ? Math.round((interviewed / total) * 100) : 0,
      offerRate: total ? Math.round((offers / total) * 100) : 0,
    };
  }, [apps]);

  const filtered = filter === 'all' ? apps : apps.filter((a) => a.stage === filter);
  const countOf = (s: ApplicationStage) => apps.filter((a) => a.stage === s).length;

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };
  const openEdit = (a: ApplicationRecord) => {
    setEditing(a);
    setForm({
      company: a.company,
      title: a.title,
      jobId: a.jobId ? String(a.jobId) : '',
      appliedOn: a.appliedOn,
      stage: a.stage,
      note: a.note,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.company.trim()) return toast('请填写公司名称', 'err');
    if (!form.title.trim()) return toast('请填写岗位名称', 'err');
    setSaving(true);
    try {
      const body = {
        company: form.company.trim(),
        title: form.title.trim(),
        jobId: form.jobId ? Number(form.jobId) : null,
        appliedOn: form.appliedOn,
        stage: form.stage,
        note: form.note,
      };
      if (editing) await api.updateApplication(editing.id, body);
      else await api.createApplication(body);
      setFormOpen(false);
      toast(editing ? '投递记录已更新' : '投递记录已新增', 'ok');
      await load();
      if (detailId) await loadDetail(detailId);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: ApplicationRecord) => {
    try {
      await api.deleteApplication(a.id);
      setConfirmDelete(null);
      if (detailId === a.id) {
        setDetailId(null);
        setDetail(null);
      }
      toast('投递记录已删除，关联关系一并移除', 'ok');
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'err');
    }
  };

  const link = async (kind: 'interview' | 'review') => {
    if (!detail) return;
    const raw = kind === 'interview' ? pickInterview : pickReview;
    if (!raw) return;
    setLinkBusy(true);
    try {
      await api.linkApplication(detail.application.id, kind, Number(raw));
      await loadDetail(detail.application.id);
      await load();
      toast(kind === 'interview' ? '已关联面试' : '已关联复盘', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '关联失败', 'err');
    } finally {
      setLinkBusy(false);
    }
  };

  const unlink = async (kind: 'interview' | 'review', refId: number) => {
    if (!detail) return;
    setLinkBusy(true);
    try {
      await api.unlinkApplication(detail.application.id, kind, refId);
      await loadDetail(detail.application.id);
      await load();
      toast('已解除关联', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '解除关联失败', 'err');
    } finally {
      setLinkBusy(false);
    }
  };

  const latestProgress = (a: ApplicationRecord): string => {
    const i = a.links.interviews[0];
    const r = a.links.reviews[0];
    if (i && (!r || new Date(i.started_at) >= new Date(r.created_at))) {
      return `最近面试 ${fmtDate(i.started_at)}${i.overall_score != null ? ` · ${i.overall_score} 分` : ''}`;
    }
    if (r) return `最近复盘 ${fmtDate(r.created_at)} · ${r.question.slice(0, 24)}`;
    return `更新于 ${fmtDateTime(a.updatedAt)}`;
  };

  const availableInterviews =
    detail?.options.interviews.filter(
      (i) =>
        !detail.application.links.interviews.some((x) => x.id === i.id) &&
        (!i.linkedApplicationId || i.linkedApplicationId === detail.application.id),
    ) ?? [];
  const availableReviews =
    detail?.options.reviews.filter(
      (r) =>
        !detail.application.links.reviews.some((x) => x.id === r.id) &&
        (!r.linkedApplicationId || r.linkedApplicationId === detail.application.id),
    ) ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="求职进度 · 投递追踪"
        title="每一次投递，都有下文"
        desc="目标岗位用来沉淀 JD 与匹配；投递记录用来跟踪你实际投出去的每一次申请。两者可以关联，也可以独立存在。"
      />

      {!loading && (
        <>
      <div className="app-stats">
        <div className="app-stat">
          <span>投递总数</span>
          <b>{stats.total}</b>
          <em>全部记录</em>
        </div>
        <div className="app-stat">
          <span>进入面试</span>
          <b>{stats.interviewed}</b>
          <em>当前阶段在一面及以后</em>
        </div>
        <div className="app-stat">
          <span>已发 offer</span>
          <b>{stats.offers}</b>
          <em>当前阶段为 offer</em>
        </div>
        <div className="app-stat">
          <span>进行中 / 已结束</span>
          <b>
            {stats.active} / {stats.closed}
          </b>
          <em>按当前阶段统计，不保留阶段历史</em>
        </div>
        <div className="app-stat rates">
          <span>转化概览</span>
          <b>
            面试 {stats.interviewRate}% · offer {stats.offerRate}%
          </b>
          <em>分母为投递总数，数字来自真实记录</em>
        </div>
      </div>

      <div className="app-toolbar">
        <div className="app-filters" role="group" aria-label="按阶段筛选投递">
          <button
            className={`app-filter ${filter === 'all' ? 'on' : ''}`}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            全部 <b>{apps.length}</b>
          </button>
          {STAGES.map((s) => (
            <button
              key={s.key}
              className={`app-filter ${filter === s.key ? 'on' : ''}`}
              aria-pressed={filter === s.key}
              onClick={() => setFilter(s.key)}
            >
              {s.label} <b>{countOf(s.key)}</b>
            </button>
          ))}
        </div>
        <Button onClick={openCreate}>新增投递</Button>
      </div>
        </>
      )}

      <h2 className="sr-only">投递记录列表</h2>

      {loading ? (
        <PageSkeleton variant="board" label="正在读取投递记录" />
      ) : apps.length === 0 ? (
        <Card>
          <EmptyState
            title="还没有投递记录"
            desc="先把最近一次真实投递记下来：公司、岗位、日期和当前阶段。"
            action={<Button onClick={openCreate}>新增第一条投递</Button>}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={`当前没有「${STAGE_MAP[filter as ApplicationStage].label}」阶段的投递`}
            desc="切换筛选，或新增一条投递记录。"
            action={
              <Button variant="ghost" onClick={() => setFilter('all')}>
                查看全部
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="app-grid">
          {filtered.map((a) => (
            <article className="app-card" key={a.id}>
              <div className="app-card-head">
                <div>
                  <h3>{a.title}</h3>
                  <p>{a.company}</p>
                </div>
                <Chip tone={STAGE_MAP[a.stage].tone}>{STAGE_MAP[a.stage].label}</Chip>
              </div>
              <div className="app-card-meta">
                <span>投递 {fmtDate(a.appliedOn)}</span>
                {a.jobTitle ? <span>目标岗位 · {a.jobTitle}</span> : <span>未关联目标岗位</span>}
              </div>
              {a.note && <p className="app-note">{a.note}</p>}
              <div className="app-card-links">
                <span>面试 {a.links.interviews.length}</span>
                <span>复盘 {a.links.reviews.length}</span>
                <span className="app-latest">{latestProgress(a)}</span>
              </div>
              <div className="app-card-actions">
                <button className="link-btn" onClick={() => void loadDetail(a.id)}>
                  查看详情
                </button>
                <button className="link-btn" onClick={() => openEdit(a)}>
                  编辑
                </button>
                <button className="link-btn danger" onClick={() => setConfirmDelete(a)}>
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="app-hint">
        统计口径：进入面试 = 当前阶段为一面 / 二面 / HR 面 / offer；由于不保存阶段变更历史，曾被拒但面试过的记录不会回溯计入。
      </p>

      <Modal
        open={formOpen}
        title={editing ? '编辑投递' : '新增投递'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              保存
            </Button>
          </>
        }
      >
        <Field label="公司" required>
          <input
            className="input"
            aria-label="公司"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            placeholder="例如：云海科技"
          />
        </Field>
        <Field label="岗位名称" required>
          <input
            className="input"
            aria-label="岗位名称"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="例如：Java 后端开发实习生"
          />
        </Field>
        <Field label="关联目标岗位" hint="可选；关联后可在详情里看到该岗位的 JD 背景，不会自动带入面试">
          <select
            className="input"
            aria-label="关联目标岗位"
            value={form.jobId}
            onChange={(e) => {
              const job = jobs.find((j) => String(j.id) === e.target.value);
              setForm({
                ...form,
                jobId: e.target.value,
                company: job?.company || form.company,
                title: job?.title || form.title,
              });
            }}
          >
            <option value="">不关联</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {j.company ? ` · ${j.company}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-row">
          <Field label="投递日期" required>
            <input
              className="input"
              type="date"
              aria-label="投递日期"
              value={form.appliedOn}
              onChange={(e) => setForm({ ...form, appliedOn: e.target.value })}
            />
          </Field>
          <Field label="当前阶段" required>
            <select
              className="input"
              aria-label="当前阶段"
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value as ApplicationStage })}
            >
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="笔记" hint="记录投递渠道、联系人、下一步准备等">
          <textarea
            className="input"
            rows={3}
            aria-label="笔记"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="例如：内推投递，一周内等笔试通知"
          />
        </Field>
      </Modal>

      <Modal
        open={!!detail}
        title={detail ? `${detail.application.company} · ${detail.application.title}` : '投递详情'}
        onClose={() => {
          setDetail(null);
          setDetailId(null);
        }}
        wide
        footer={
          detail && (
            <>
              <Button variant="ghost" onClick={() => openEdit(detail.application)}>
                编辑
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(detail.application)}>
                删除
              </Button>
              <Button
                onClick={() => {
                  setDetail(null);
                  setDetailId(null);
                }}
              >
                关闭
              </Button>
            </>
          )
        }
      >
        {detail && (
          <div className="app-detail">
            <div className="app-detail-head">
              <Chip tone={STAGE_MAP[detail.application.stage].tone}>
                {STAGE_MAP[detail.application.stage].label}
              </Chip>
              <span>投递 {fmtDate(detail.application.appliedOn)}</span>
              <span>更新 {fmtDateTime(detail.application.updatedAt)}</span>
            </div>
            <div className="app-detail-grid">
              <div>
                <span className="app-detail-label">目标岗位</span>
                <p>{detail.application.jobTitle || '未关联（投递可以独立存在）'}</p>
              </div>
              <div>
                <span className="app-detail-label">最新进展</span>
                <p>{latestProgress(detail.application)}</p>
              </div>
            </div>
            {detail.application.note && (
              <div>
                <span className="app-detail-label">笔记</span>
                <p className="app-detail-note">{detail.application.note}</p>
              </div>
            )}

            <div className="app-link-block">
              <div className="app-link-title">
                <h4>关联的模拟面试</h4>
                <span>{detail.application.links.interviews.length} 场</span>
              </div>
              {detail.application.links.interviews.length === 0 && <p className="muted small">还没有关联面试。</p>}
              <ul className="app-link-list">
                {detail.application.links.interviews.map((i) => (
                  <li key={i.id}>
                    <span>
                      面试 #{i.id} · {fmtDateTime(i.started_at)}
                      {i.overall_score != null ? ` · ${i.overall_score} 分` : ''}
                    </span>
                    <div>
                      <a className="link-btn" href={`/interviews/${i.id}/report`} target="_blank" rel="noreferrer">
                        看报告
                      </a>
                      <button className="link-btn danger" disabled={linkBusy} onClick={() => void unlink('interview', i.id)}>
                        解除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="app-link-add">
                <select
                  className="input"
                  aria-label="选择一场未关联的面试"
                  value={pickInterview}
                  onChange={(e) => setPickInterview(e.target.value)}
                >
                  <option value="">选择一场未关联的面试</option>
                  {availableInterviews.map((i) => (
                    <option key={i.id} value={i.id}>
                      面试 #{i.id} · {fmtDate(i.started_at)}
                      {i.overall_score != null ? ` · ${i.overall_score} 分` : ''}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" loading={linkBusy} disabled={!pickInterview} onClick={() => void link('interview')}>
                  关联面试
                </Button>
              </div>
            </div>

            <div className="app-link-block">
              <div className="app-link-title">
                <h4>关联的复盘</h4>
                <span>{detail.application.links.reviews.length} 条</span>
              </div>
              {detail.application.links.reviews.length === 0 && <p className="muted small">还没有关联复盘。</p>}
              <ul className="app-link-list">
                {detail.application.links.reviews.map((r) => (
                  <li key={r.id}>
                    <span>
                      复盘 #{r.id} · {r.question.slice(0, 40)}
                      {r.question.length > 40 ? '…' : ''}
                    </span>
                    <div>
                      <button className="link-btn danger" disabled={linkBusy} onClick={() => void unlink('review', r.id)}>
                        解除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="app-link-add">
                <select
                  className="input"
                  aria-label="选择一条未关联的复盘"
                  value={pickReview}
                  onChange={(e) => setPickReview(e.target.value)}
                >
                  <option value="">选择一条未关联的复盘</option>
                  {availableReviews.map((r) => (
                    <option key={r.id} value={r.id}>
                      复盘 #{r.id} · {r.question.slice(0, 30)}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" loading={linkBusy} disabled={!pickReview} onClick={() => void link('review')}>
                  关联复盘
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirmDelete}
        title="删除投递记录"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              取消
            </Button>
            <Button onClick={() => confirmDelete && void remove(confirmDelete)}>确认删除</Button>
          </>
        }
      >
        {confirmDelete && (
          <Callout tone="warn">
            将删除「{confirmDelete.company} · {confirmDelete.title}」及其面试 / 复盘关联。面试与复盘本身不会被删除。
          </Callout>
        )}
      </Modal>
    </div>
  );
}
