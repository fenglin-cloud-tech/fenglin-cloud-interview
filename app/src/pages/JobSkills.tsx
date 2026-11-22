import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { JobSkillsData } from '../types';
import {
  Button,
  Callout,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSkeleton,
  Progress,
  SourceBadge,
  Stat,
} from '../components/ui';

const STATUS_LABEL: Record<string, string> = {
  covered: '已覆盖',
  partial: '部分覆盖',
  missing: '缺失',
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** MOD-06：一个岗位的技能标签与当前简历覆盖率。 */
export function JobSkills() {
  const { id } = useParams();
  const jobId = Number(id);
  const [data, setData] = useState<JobSkillsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyStart, setBusyStart] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .jobSkills(jobId)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(load, [load]);

  const extract = async (forceLocal: boolean) => {
    if (!data) return;
    if (data.job.jd.trim().length < 20) {
      setExtractError('这个岗位还没有有效 JD，请先到「目标岗位」补充岗位描述。');
      return;
    }
    setBusy(true);
    setBusyStart(Date.now());
    setExtractError(null);
    try {
      const { jobId: taskId } = await api.extractJobSkills(jobId, forceLocal);
      for (let i = 0; i < 150; i += 1) {
        await sleep(1000);
        const job = await api.jobSkillsJob(jobId, taskId);
        if (job.status === 'done') {
          setData(job.result);
          return;
        }
        if (job.status === 'error') {
          setExtractError(job.error?.message || '技能提取失败');
          return;
        }
      }
      setExtractError('提取仍在后台执行，请稍后刷新页面查看');
    } catch (e) {
      setExtractError(e instanceof ApiError ? e.message : '技能提取失败');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <PageSkeleton variant="cards" label="正在读取技能标签" />
      </div>
    );
  }
  if (error || !data) return <ErrorState message={error || '岗位不存在'} onRetry={load} />;

  return (
    <div className="page">
      <PageHeader
        eyebrow="岗位 · 技能图谱"
        title={data.job.title}
        desc={`${data.job.company || '未填写公司'} · 把 JD 拆成技能标签，并逐项对照当前简历的覆盖情况。`}
        actions={
          <Link to="/jobs" className="btn btn-quiet">
            ← 返回岗位
          </Link>
        }
      />

      <Card
        title="技能提取"
        subtitle={data.updatedAt ? `上次更新：${new Date(data.updatedAt).toLocaleString('zh-CN')}` : '还没有提取过技能标签'}
        extra={
          <div className="row gap-8 wrap">
            <Button size="sm" variant="ink" loading={busy} onClick={() => void extract(false)}>
              AI 提取技能
            </Button>
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => void extract(true)}>
              本地关键词提取
            </Button>
          </div>
        }
      >
        {busy && <Progress value={0} label={`正在从 JD 中提取技能标签… 已用时 ${Math.round((Date.now() - busyStart) / 1000)} 秒`} />}
        {extractError && <Callout tone="warn">{extractError}</Callout>}
        {!busy && !data.skills.length && (
          <EmptyState
            icon="◈"
            title="还没有技能标签"
            desc="点「AI 提取技能」把 JD 拆成可比较的标签；模型不可用时会自动改用本地关键词词典。"
          />
        )}
        {data.meta && (
          <p className="mt-8">
            <SourceBadge source={data.meta.source} note={data.meta.note} />
          </p>
        )}
      </Card>

      {data.skills.length > 0 && (
        <>
          <div className="stats-row tight">
            <Stat label="技能标签" value={data.skills.length} />
            <Stat label="简历覆盖率" value={`${data.percent}%`} hint="按技能权重加权" />
            <Stat
              label="对照简历"
              value={data.resume ? data.resume.title : '暂无简历'}
              hint={data.resume ? (data.resume.matchedByJob ? '岗位优先匹配' : '使用最近更新的简历') : '请先准备一份简历'}
            />
          </div>

          <Card title="覆盖率明细" subtitle="权重 3 为硬性要求，2 为重要加分，1 为一般提及">
            <Progress value={data.percent} label={`整体覆盖 ${data.percent}%`} />
            <div className="chip-row mt-12">
              {data.skills.map((s) => (
                <Chip key={s.id} tone={s.weight >= 3 ? 'red' : s.weight === 2 ? 'amber' : 'default'}>
                  {s.skill} · W{s.weight}
                </Chip>
              ))}
            </div>
            <div className="table-wrap mt-12">
              <table className="table">
                <thead>
                  <tr>
                    <th>技能</th>
                    <th style={{ width: 80 }}>权重</th>
                    <th style={{ width: 110 }}>简历覆盖</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.skill}>
                      <td>{item.skill}</td>
                      <td>{item.weight}</td>
                      <td>
                        <span className={`status status-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                      </td>
                      <td className="muted">{item.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Callout tone="info">
            覆盖率为关键词级判断：命中不等于能力被证明。缺失项应回到简历里补「真实做过什么」，而不是直接堆词。
          </Callout>
        </>
      )}
    </div>
  );
}
