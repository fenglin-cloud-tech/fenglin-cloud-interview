import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { ResumeTemplate } from '../types';
import { renderMarkdown } from '../lib/markdown';
import { Button, Card, Chip, ErrorState, Modal, PageHeader, PageSkeleton } from '../components/ui';

export function Templates() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ResumeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ResumeTemplate | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .templates()
      .then((r) => setItems(r.templates))
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="page">
      <PageHeader
        eyebrow="模块 0 · 新手入口"
        title="先选一个「像你」的模板"
        desc="模板不是让你照抄，而是告诉你：这个岗位的简历，先写什么、后写什么、每一栏该长什么样。选好后按引导逐项填写，生成初稿直接进入优化。"
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <PageSkeleton variant="cards" label="正在加载模板" />}

      <div className="template-grid">
        {items.map((t, i) => (
          <article className={`template-card accent-${t.accent}`} key={t.id}>
            <div className="template-top">
              <div className="template-num">{['壹', '貳', '參', '肆'][i] || i + 1}</div>
              <div>
                <h3>{t.name}</h3>
                <p className="template-tagline">{t.tagline}</p>
              </div>
            </div>
            <div className="chip-row">
              {t.roles.map((r) => (
                <Chip key={r} tone="ink">
                  {r}
                </Chip>
              ))}
            </div>
            <div className="section-list">
              {t.sections.map((s) => (
                <div className="section-chip" key={s.key}>
                  <span className="section-name">{s.name}</span>
                  {!s.required && <span className="section-opt">可选</span>}
                </div>
              ))}
            </div>
            <div className="template-actions">
              <Button size="sm" onClick={() => navigate(`/templates/${t.id}`)}>
                按引导填写
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setPreview(t)}>
                看示例全文
              </Button>
            </div>
          </article>
        ))}
      </div>

      <Card title="怎么用最省力" subtitle="三步走，不要跳">
        <ol className="steps">
          <li>
            <strong>选模板</strong>：按你投的岗位类型选，跨类型的简历会显得「什么都做过，什么都不深」。
          </li>
          <li>
            <strong>逐项填</strong>：每栏都有填法说明和正反例。写不出数字就先写「待补充」，不要编。
          </li>
          <li>
            <strong>带入优化</strong>：生成初稿后自动保存到简历库，直接进入{' '}
            <Link to="/optimize" className="link">
              简历优化
            </Link>
            ，让 AI 按目标岗位逐条批注。
          </li>
        </ol>
      </Card>

      <Modal open={!!preview} title={preview ? `${preview.name} · 示例全文` : ''} onClose={() => setPreview(null)} wide>
        {preview && (
          <>
            <div className="notice-line">
              下面是该岗位一份「合格线以上」的示例，<strong>只借鉴结构与写法，不要复制经历</strong>。
            </div>
            <div className="paper-scroll markdown-body">{renderMarkdown(preview.sample)}</div>
            <div className="modal-foot-inline">
              <Button variant="ink" onClick={() => navigate(`/templates/${preview.id}`)}>
                用这个模板开始填写
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
