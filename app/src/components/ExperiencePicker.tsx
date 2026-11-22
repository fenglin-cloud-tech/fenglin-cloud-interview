import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { ExperienceCard } from '../types';
import { Button, Chip, ErrorState, Modal, PageSkeleton } from './ui';

/** 把素材卡转成可直接写入简历 / 草稿的 Markdown 片段。 */
export function experienceText(card: ExperienceCard): string {
  const lines = [`### ${card.title}${card.role ? `（${card.role}）` : ''}`];
  if (card.situation) lines.push(`- 情境：${card.situation}`);
  if (card.task) lines.push(`- 任务：${card.task}`);
  if (card.action) lines.push(`- 行动：${card.action}`);
  if (card.result) lines.push(`- 结果：${card.result}`);
  if (card.metrics) lines.push(`- 指标：${card.metrics}`);
  return lines.join('\n');
}

/**
 * 素材库选择器：模板填写、简历优化共用。
 * 只读取 experience_card，不写库；插入动作由调用方决定写进哪个字段。
 */
export function ExperiencePicker({
  open,
  onClose,
  onPick,
  jobId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (text: string, card: ExperienceCard) => void;
  jobId?: number | null;
}) {
  const [items, setItems] = useState<ExperienceCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    api
      .experiences({ jobId: jobId || undefined, q: q || undefined })
      .then((r) => setItems(r.experiences))
      .catch((e) => setError(e instanceof ApiError ? e.message : '素材加载失败'))
      .finally(() => setLoading(false));
  }, [open, jobId, q, reload]);

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return items;
    return items.filter((c) =>
      [c.title, c.action, c.result, c.tags].some((v) => v.toLowerCase().includes(key)),
    );
  }, [items, q]);

  return (
    <Modal open={open} title="从素材库插入" onClose={onClose} wide>
      <div className="row gap-8 wrap">
        <input
          className="input search"
          placeholder="搜索素材标题、行动、结果或标签…"
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
              setQ('');
              setQInput('');
            }}
          >
            清空
          </Button>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />}
      {loading && <PageSkeleton variant="cards" label="正在读取素材卡" />}

      {!loading && !error && filtered.length === 0 && (
        <p className="muted">素材库还是空的。可以先去「经历素材」把一段项目拆成 STAR 卡。</p>
      )}

      <div className="stack">
        {filtered.map((card) => (
          <div key={card.id} className="card" style={{ padding: 14 }}>
            <div className="row between wrap gap-8">
              <div>
                <strong>{card.title}</strong>
                {card.role && <span className="muted small"> · {card.role}</span>}
                {card.job_title && <span className="muted small"> · {card.job_title}</span>}
              </div>
              <Button
                size="sm"
                variant="ink"
                onClick={() => {
                  onPick(experienceText(card), card);
                  onClose();
                }}
              >
                插入
              </Button>
            </div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              {card.tags
                .split(/[,，、\s]+/)
                .filter(Boolean)
                .slice(0, 6)
                .map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              {card.action || card.result || '（尚未填写行动与结果）'}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  );
}
