import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { Job } from '../types';
import { formatDateTime } from '../lib/format';
import { Button, Card, Chip, EmptyState, ErrorState, Field, Modal, PageHeader, PageSkeleton } from '../components/ui';

export function Jobs() {
  const navigate = useNavigate();
  const { jobs, refreshJobs, setActiveJob, activeJob, toast } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [confirming, setConfirming] = useState<Job | null>(null);
  const [form, setForm] = useState({ title: '', company: '', jd: '' });
  const [saving, setSaving] = useState(false);
  const [jdUrl, setJdUrl] = useState('');
  const [jdFetching, setJdFetching] = useState(false);
  const [jdMsg, setJdMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [jdUndo, setJdUndo] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    refreshJobs()
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => {
    setForm({ title: '', company: '', jd: '' });
    setEditing(null);
    setJdUrl('');
    setJdMsg(null);
    setJdUndo(null);
    setOpen(true);
  };
  const openEdit = (j: Job) => {
    setForm({ title: j.title, company: j.company, jd: j.jd });
    setEditing(j);
    setJdUrl('');
    setJdMsg(null);
    setJdUndo(null);
    setOpen(true);
  };

  const fetchJd = async () => {
    const raw = jdUrl.trim();
    if (!raw) return toast('请先粘贴招聘页面链接', 'err');
    setJdFetching(true);
    setJdMsg(null);
    const prev = form.jd;
    try {
      const r = await api.fetchJd(raw);
      if (!r.ok) {
        setJdMsg({ tone: 'err', text: r.message });
        return;
      }
      setForm((f) => ({ ...f, jd: r.jd }));
      setJdUndo(prev.trim() ? prev : null);
      const label = r.title ? `《${r.title.slice(0, 36)}》` : '';
      setJdMsg({
        tone: 'ok',
        text: `已抓取${label} ${r.chars} 字${r.truncated ? '（超长部分已截断）' : ''}，请核对后再保存，未写入数据库。`,
      });
    } catch (e) {
      setJdMsg({ tone: 'err', text: e instanceof ApiError ? e.message : '抓取失败，请直接粘贴 JD' });
    } finally {
      setJdFetching(false);
    }
  };

  const save = async () => {
    if (!form.title.trim()) return toast('请填写岗位名称', 'err');
    setSaving(true);
    try {
      if (editing) {
        await api.updateJob(editing.id, { title: form.title.trim(), company: form.company, jd: form.jd });
        toast('岗位已更新', 'ok');
      } else {
        await api.createJob({ title: form.title.trim(), company: form.company, jd: form.jd });
        toast('岗位已创建', 'ok');
      }
      await refreshJobs();
      setOpen(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirming) return;
    try {
      await api.deleteJob(confirming.id);
      await refreshJobs();
      toast('已删除', 'ok');
      setConfirming(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'err');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="数据 · 多岗位"
        title="目标岗位"
        desc="一个岗位配一份 JD。JD 用于匹配度诊断，也用于模拟面试的出题方向。"
        actions={
          <Button variant="ink" onClick={openCreate}>
            新建岗位
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <PageSkeleton variant="cards" label="正在读取岗位" />}

      {!loading && jobs.length === 0 && (
        <Card>
          <EmptyState
            icon="◎"
            title="还没有目标岗位"
            desc="把招聘启事里的「岗位职责 + 任职要求」整段粘进来，后面的匹配分析和面试出题都靠它。"
            action={
              <Button variant="ink" onClick={openCreate}>
                粘贴第一份 JD
              </Button>
            }
          />
        </Card>
      )}

      <div className="job-grid">
        {jobs.map((j) => (
          <Card key={j.id} className={`job-card ${activeJob?.id === j.id ? 'is-active' : ''}`}>
            <div className="job-head">
              <div>
                <h3>{j.title}</h3>
                <div className="job-company">{j.company || '未填写公司'}</div>
              </div>
              <div className="chip-row">
                {activeJob?.id === j.id && <Chip tone="green">当前</Chip>}
                <Chip tone="ink">{j.jd ? `${j.jd.replace(/\s/g, '').length} 字 JD` : '暂无 JD'}</Chip>
              </div>
            </div>
            <p className="job-jd">{j.jd ? j.jd.slice(0, 150) : '还没有粘贴 JD，匹配分析会不准确。'}</p>
            <div className="job-foot">
              <span className="muted small">
                {j.resume_count ?? 0} 份简历 · {j.interview_count ?? 0} 场面试 · {formatDateTime(j.updated_at)}
              </span>
            </div>
            <div className="row gap-8 wrap">
              <Button size="sm" variant="ink" onClick={() => navigate(`/optimize?jobId=${j.id}`)}>
                做匹配分析
              </Button>
              <Button size="sm" onClick={() => openEdit(j)}>
                编辑
              </Button>
              {activeJob?.id !== j.id && (
                <Button size="sm" variant="quiet" onClick={() => void setActiveJob(j.id).then(() => toast('已设为当前岗位', 'ok'))}>
                  设为当前
                </Button>
              )}
              <button className="danger-link" onClick={() => setConfirming(j)}>
                删除
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        title={editing ? '编辑岗位' : '新建岗位'}
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
        <div className="form-row">
          <Field label="岗位名称" required hint="例如：Java 后端实习、新媒体运营校招">
            <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="公司 / 来源">
            <input
              className="input"
              value={form.company}
              onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              placeholder="可选"
            />
          </Field>
        </div>
        <div className="jd-import">
          <div className="jd-import-head">
            <span className="jd-import-label">从招聘页面抓取</span>
            <span className="jd-import-note">可选 · 抓取后仍可编辑</span>
          </div>
          <div className="jd-import-row">
            <input
              className="input"
              value={jdUrl}
              onChange={(e) => setJdUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void fetchJd();
                }
              }}
              placeholder="粘贴招聘页面链接，例如 https://jobs.xxx.com/..."
              aria-label="招聘页面链接"
            />
            <Button size="sm" variant="ghost" onClick={() => void fetchJd()} loading={jdFetching}>
              解析链接
            </Button>
          </div>
          <p className="jd-import-hint">
            由服务端抓取公开页面正文：仅支持 http/https、10 秒超时、1.5 MB 上限；内网与登录页会被拒绝。抓取结果先填入下方，确认后再保存。
          </p>
          {jdMsg && (
            <div className={`jd-import-msg ${jdMsg.tone}`} role="status">
              <span>{jdMsg.text}</span>
              {jdMsg.tone === 'ok' && jdUndo !== null && (
                <button
                  type="button"
                  className="jd-undo"
                  onClick={() => {
                    setForm((f) => ({ ...f, jd: jdUndo }));
                    setJdUndo(null);
                    setJdMsg(null);
                  }}
                >
                  撤销替换
                </button>
              )}
            </div>
          )}
        </div>
        <Field label="JD 原文" hint="建议把「岗位职责」「任职要求」都粘进来，至少 50 字">
          <textarea
            className="textarea"
            rows={14}
            value={form.jd}
            onChange={(e) => setForm((f) => ({ ...f, jd: e.target.value }))}
            placeholder={'岗位职责：\n1. ...\n任职要求：\n1. ...'}
          />
        </Field>
      </Modal>

      <Modal
        open={!!confirming}
        title="删除岗位"
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
        <p>确定删除「{confirming?.title}」吗？关联简历会解除绑定，历史面试记录仍保留。</p>
      </Modal>
    </div>
  );
}
