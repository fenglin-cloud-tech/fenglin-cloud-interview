import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import { Button, Callout, Card, Field, PageHeader, PageSkeleton, Stat } from '../components/ui';

export function ProfilePage() {
  const { profile, saveProfile, resumes, jobs, activeResume, activeJob, aiConfigured, model, loading, toast } = useApp();
  const [form, setForm] = useState({ nickname: '', school: '', major: '', grade: '' });
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState<{ interviews: number; reviews: number; bank: number } | null>(null);

  useEffect(() => {
    if (profile) {
      setForm({
        nickname: profile.nickname,
        school: profile.school,
        major: profile.major,
        grade: profile.grade,
      });
    }
  }, [profile]);

  useEffect(() => {
    api
      .dashboard()
      .then((d) => setCounts({ interviews: d.counts.interviews, reviews: d.counts.reviews, bank: d.counts.bank }))
      .catch(() => setCounts(null));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveProfile(form);
      toast('档案已保存', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="模块 4 · 账号与数据"
        title="本地档案"
        desc="丰麟云面不要求注册。这里只有一份「本机档案」，用于给模板预填姓名与学校；所有数据都在你自己的数据库文件里。"
      />

      {loading && !profile ? (
        <PageSkeleton variant="profile" label="正在读取本地档案" />
      ) : (
      <div className="profile-grid">
        <Card title="档案信息" subtitle="仅用于模板预填与简历抬头，不会发送给模型除非出现在简历正文里">
          <div className="form-row">
            <Field label="昵称 / 姓名">
              <input className="input" value={form.nickname} onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))} placeholder="张同学" />
            </Field>
            <Field label="学校">
              <input className="input" value={form.school} onChange={(e) => setForm((f) => ({ ...f, school: e.target.value }))} placeholder="XX 大学" />
            </Field>
          </div>
          <div className="form-row">
            <Field label="专业">
              <input className="input" value={form.major} onChange={(e) => setForm((f) => ({ ...f, major: e.target.value }))} placeholder="计算机科学与技术" />
            </Field>
            <Field label="届别 / 年级">
              <input className="input" value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))} placeholder="2027 届" />
            </Field>
          </div>
          <Button variant="ink" onClick={() => void save()} loading={saving}>
            保存档案
          </Button>
          <Callout tone="info">
            这是轻量方案：不做注册、不做密码、不做多用户隔离。同一台机器上的所有访问者共享这份数据，适合个人使用与比赛演示。
          </Callout>
        </Card>

        <div className="stack">
          <Card title="数据概览">
            <div className="stats-row tight">
              <Stat label="简历" value={resumes.length} />
              <Stat label="岗位" value={jobs.length} />
              <Stat label="面试" value={counts?.interviews ?? '—'} />
              <Stat label="复盘" value={counts?.reviews ?? '—'} />
              <Stat label="题库" value={counts?.bank ?? '—'} />
            </div>
            <dl className="meta-list">
              <dt>当前简历</dt>
              <dd>{activeResume?.title || '未选择'}</dd>
              <dt>当前岗位</dt>
              <dd>{activeJob?.title || '未选择'}</dd>
              <dt>模型</dt>
              <dd>{aiConfigured ? model || '已配置' : '未配置'}</dd>
            </dl>
          </Card>

          <Card title="数据在哪">
            <ul className="principles">
              <li>存储：服务端 SQLite 文件（默认 <code>app/data/fenglin.sqlite</code>）。</li>
              <li>浏览器端只保留界面状态，不落简历正文。</li>
              <li>备份 = 复制这个数据库文件；清空 = 删除它（应用会重建空库）。</li>
            </ul>
            <div className="mt-12">
              <Link to="/privacy" className="link">
                查看完整隐私说明 →
              </Link>
            </div>
          </Card>
        </div>
      </div>
      )}
    </div>
  );
}
