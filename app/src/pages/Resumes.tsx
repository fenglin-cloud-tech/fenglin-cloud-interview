import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { Resume } from '../types';
import { formatDateTime } from '../lib/format';
import { Button, Card, Chip, EmptyState, ErrorState, Field, Loading, Modal, PageHeader } from '../components/ui';

const SOURCE_LABEL: Record<string, string> = {
  manual: '手动创建',
  template: '模板生成',
  ai: 'AI 修改',
};

export function Resumes() {
  const navigate = useNavigate();
  const { resumes, jobs, refreshResumes, setActiveResume, activeResume, toast } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Resume | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Resume | null>(null);
  const [form, setForm] = useState({ title: '', content: '', jobId: '' });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    refreshResumes()
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => {
    setForm({ title: '', content: '', jobId: '' });
    setEditing(null);
    setCreating(true);
  };
  const openEdit = (r: Resume) => {
    setForm({ title: r.title, content: r.content, jobId: r.job_id ? String(r.job_id) : '' });
    setEditing(r);
    setCreating(true);
  };

  const save = async () => {
    if (!form.title.trim()) return toast('请填写简历标题', 'err');
    if (form.content.trim().length < 20) return toast('简历内容至少 20 字', 'err');
    setSaving(true);
    try {
      if (editing) {
        await api.updateResume(editing.id, {
          title: form.title.trim(),
          content: form.content,
          jobId: form.jobId ? Number(form.jobId) : null,
        });
        toast('已保存修改', 'ok');
      } else {
        await api.createResume({
          title: form.title.trim(),
          content: form.content,
          jobId: form.jobId ? Number(form.jobId) : null,
          source: 'manual',
        });
        toast('简历已创建', 'ok');
      }
      await refreshResumes();
      setCreating(false);
      setEditing(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirming) return;
    try {
      await api.deleteResume(confirming.id);
      await refreshResumes();
      toast('已删除', 'ok');
      setConfirming(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败', 'err');
    }
  };

  const importFile = async (file: File) => {
    let text = '';
    try {
      text = await file.text();
    } catch {
      return toast('文件读取失败，请换一个文件重试', 'err');
    }
    if (!text.trim()) return toast('文件是空的，请换一个文件', 'err');
    // 直接打开编辑弹窗并填好内容；不能只写 form，否则用户再点「新建简历」会被 openCreate 重置掉
    setEditing(null);
    setForm({ title: file.name.replace(/\.[^.]+$/, ''), content: text, jobId: '' });
    setCreating(true);
    toast('文件已读入，确认内容后保存', 'ok');
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="数据 · 多份简历"
        title="我的简历"
        desc="同一份经历可以针对不同岗位改出多个版本。面试出题会读取当前选中的简历。"
        actions={
          <>
            <input
              type="file"
              accept=".md,.markdown,.txt"
              hidden
              ref={fileRef}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
            <Button onClick={() => fileRef.current?.click()}>导入 .md/.txt</Button>
            <Button onClick={() => navigate('/import')}>导入 PDF / 图片</Button>
            <Button variant="ink" onClick={openCreate}>
              新建简历
            </Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <Loading label="读取简历" lines={2} />}

      {!loading && resumes.length === 0 && (
        <Card>
          <EmptyState
            icon="✎"
            title="还没有简历"
            desc="第一次用？从模板库按引导填一份，比对着空白页硬写快得多。"
            action={
              <div className="row gap-8">
                <Button variant="ink" onClick={() => navigate('/templates')}>
                  去模板库
                </Button>
                <Button onClick={openCreate}>我自己粘贴</Button>
              </div>
            }
          />
        </Card>
      )}

      <div className="resume-grid">
        {resumes.map((r) => (
          <Card key={r.id} className={`resume-card ${activeResume?.id === r.id ? 'is-active' : ''}`}>
            <div className="resume-head">
              <div>
                <h3>{r.title}</h3>
                <div className="chip-row">
                  <Chip tone="ink">{SOURCE_LABEL[r.source] || r.source}</Chip>
                  {r.job_title && <Chip tone="blue">{r.job_title}</Chip>}
                  {activeResume?.id === r.id && <Chip tone="green">当前使用</Chip>}
                </div>
              </div>
              <div className="resume-date">{formatDateTime(r.updated_at)}</div>
            </div>
            <p className="resume-excerpt">{r.content.replace(/[#*]/g, '').slice(0, 120)}…</p>
            <div className="resume-stats">
              <span>{r.content.replace(/\s/g, '').length} 字</span>
              <span>{r.analysis_count ?? 0} 次 JD 诊断</span>
              <span>{r.interview_count ?? 0} 场面试</span>
            </div>
            <div className="row gap-8 wrap">
              <Button size="sm" variant="ink" onClick={() => navigate(`/optimize?resumeId=${r.id}`)}>
                去优化
              </Button>
              <Button size="sm" onClick={() => openEdit(r)}>
                编辑
              </Button>
              {activeResume?.id !== r.id && (
                <Button size="sm" variant="quiet" onClick={() => void setActiveResume(r.id).then(() => toast('已设为当前简历', 'ok'))}>
                  设为当前
                </Button>
              )}
              <Button size="sm" variant="quiet" onClick={() => navigate(`/interviews?resumeId=${r.id}`)}>
                用它面试
              </Button>
              <button className="danger-link" onClick={() => setConfirming(r)}>
                删除
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={creating}
        title={editing ? '编辑简历' : '新建简历'}
        onClose={() => setCreating(false)}
        wide
        footer={
          <>
            <Button variant="quiet" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button variant="ink" onClick={() => void save()} loading={saving}>
              保存
            </Button>
          </>
        }
      >
        <Field label="简历标题" required hint="例如：Java 后端实习 · 第 3 版">
          <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="关联目标岗位" hint="关联后，JD 分析与会话会默认带上这个岗位">
          <select className="input" value={form.jobId} onChange={(e) => setForm((f) => ({ ...f, jobId: e.target.value }))}>
            <option value="">不关联</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="简历正文" required hint="支持 Markdown 标题（## 板块名），也支持纯文本">
          <textarea
            className="textarea mono"
            rows={16}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder={'# 张同学\n\n## 教育背景\n...\n\n## 项目经历\n...'}
          />
        </Field>
      </Modal>

      <Modal
        open={!!confirming}
        title="删除简历"
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
        <p>
          确定删除「{confirming?.title}」吗？关联的 JD 分析记录会保留，但面试出题将无法再使用这份简历。
        </p>
      </Modal>
    </div>
  );
}
