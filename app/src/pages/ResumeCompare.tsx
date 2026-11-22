import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Resume, ResumeDiff } from '../types';
import { diffLines } from '../lib/diff';
import { Card, CopyButton, PageHeader, PageSkeleton, ErrorState, Field } from '../components/ui';

/**
 * 两版简历对比：复用 lib/diff 的行级 LCS，不改动现有简历编辑页。
 * 入口来自「我的简历」的版本谱系 / 对比父版按钮。
 */
export function ResumeCompare() {
  const [params, setParams] = useSearchParams();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverDiff, setServerDiff] = useState<ResumeDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    api
      .resumes()
      .then((r) => setResumes(r.resumes))
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const aId = Number(params.get('a')) || resumes[0]?.id || 0;
  const bId = Number(params.get('b')) || resumes[resumes.length - 1]?.id || 0;
  const a = resumes.find((r) => r.id === aId) ?? null;
  const b = resumes.find((r) => r.id === bId) ?? null;

  useEffect(() => {
    if (!a || !b || a.id === b.id) {
      setServerDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    api
      .resumeDiff(a.id, b.id)
      .then((r) => !cancelled && setServerDiff(r))
      .catch(() => !cancelled && setServerDiff(null))
      .finally(() => !cancelled && setDiffLoading(false));
    return () => {
      cancelled = true;
    };
  }, [a, b]);

  const diff = useMemo(() => {
    if (serverDiff) return serverDiff.lines;
    return a && b && a.id !== b.id ? diffLines(a.content, b.content) : [];
  }, [serverDiff, a, b]);
  const added = diff.filter((l) => l.type === 'add').length;
  const removed = diff.filter((l) => l.type === 'del').length;
  const diffText = diff
    .map((l) => `${l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}${l.text}`)
    .join('\n');

  const setSide = (key: 'a' | 'b', value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="数据 · 简历版本"
        title="两版简历对比"
        desc="按行对比两个版本的内容差异：绿色为新增，红色为删除。对比只读，不会修改任何简历。"
      />

      {error && <ErrorState message={error} onRetry={() => location.reload()} />}
      {loading && <PageSkeleton variant="cards" label="正在读取简历版本" />}

      {!loading && resumes.length < 2 && (
        <Card>
          <p className="muted">至少需要两份简历才能对比。可以在「简历优化」里另存新版，系统会自动记录派生关系。</p>
        </Card>
      )}

      {!loading && resumes.length >= 2 && (
        <>
          <Card>
            <div className="form-row">
              <Field label="版本 A（较早）">
                <select className="input" value={aId || ''} onChange={(e) => setSide('a', e.target.value)}>
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} {r.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="版本 B（较新）">
                <select className="input" value={bId || ''} onChange={(e) => setSide('b', e.target.value)}>
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} {r.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="muted small">
              {a && b && a.id !== b.id
                ? `新增 ${added} 行 · 删除 ${removed} 行${diffLoading ? ' · 正在读取服务端差异…' : ''}`
                : '请选择两个不同的版本'}
            </p>
          </Card>

          {a && b && a.id !== b.id && (
            <Card
              title="差异"
              subtitle={`${a.title} → ${b.title}`}
              extra={<CopyButton text={diffText} label="复制差异文本" />}
            >
              <pre className="diff-view">
                {diff.map((l, i) => (
                  <span key={i} className={`diff-line diff-${l.type}`}>
                    {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
                    {l.text || ' '}
                    {'\n'}
                  </span>
                ))}
              </pre>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
