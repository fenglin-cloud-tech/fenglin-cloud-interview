import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { PlanData, PlanDay, TrainingTask } from '../types';
import { Button, Callout, Card, ErrorState, PageHeader, PageSkeleton, Stat } from '../components/ui';

function dateLabel(date: string, today: string): string {
  if (date === today) return '今天';
  const t = new Date(`${today}T00:00:00`).getTime();
  const d = new Date(`${date}T00:00:00`).getTime();
  const diff = Math.round((d - t) / 86_400_000);
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return week[new Date(`${date}T00:00:00`).getDay()] || date;
}

function taskTarget(task: TrainingTask): string {
  const kind = task.kind.replace(/^plan:/, '');
  if (kind === 'followup') return '/applications';
  if (kind === 'review') return '/bank';
  if (kind === 'starter') {
    if (/简历/.test(task.title)) return '/resumes';
    if (/岗位|JD/.test(task.title)) return '/jobs';
    if (/模拟面试/.test(task.title)) return '/interviews';
    if (/题库/.test(task.title)) return '/bank';
    if (/复盘/.test(task.title)) return '/reviews';
    if (/投递/.test(task.title)) return '/applications';
    return '/';
  }
  if (kind === 'weakness' || kind === 'review_point' || kind === 'practice') return '/interviews';
  return '/';
}

function taskActionLabel(task: TrainingTask): string {
  const target = taskTarget(task);
  if (target === '/applications') return '去跟进';
  if (target === '/resumes') return '去完善';
  if (target === '/jobs') return '去设置';
  if (target === '/bank') return '去复习';
  if (target === '/reviews') return '去复盘';
  if (target === '/interviews') return '去练习';
  return '去看看';
}

export function Plan() {
  const { toast } = useApp();
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .planToday()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggle = async (task: TrainingTask) => {
    if (busyId) return;
    setBusyId(task.id);
    try {
      const { task: next } = await api.completePlanTask(task.id);
      setData((prev) =>
        prev
          ? {
              ...prev,
              done: prev.done + (next.status === 'done' ? 1 : -1),
              days: prev.days.map((d) => ({
                ...d,
                done: d.tasks.reduce(
                  (n, t) => n + (t.id === next.id ? (next.status === 'done' ? 1 : 0) : t.status === 'done' ? 1 : 0),
                  0,
                ),
                tasks: d.tasks.map((t) => (t.id === next.id ? next : t)),
              })),
            }
          : prev,
      );
      toast(next.status === 'done' ? '已完成，继续保持' : '已恢复为待办', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '更新失败', 'err');
    } finally {
      setBusyId(null);
    }
  };

  const today = data?.days.find((d) => d.isToday) || null;
  const weekDone = data?.done ?? 0;
  const weekTotal = data?.total ?? 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="训练计划 · 7 天"
        title="把复盘结论，拆成今天就能做的三件事"
        desc="完成一场面试报告后，系统会把薄弱项、复习点、到期复习和投递跟进排进未来 7 天。每天最多 3 条，做完打勾即可。"
        actions={
          <Button variant="quiet" onClick={load} loading={loading}>
            刷新计划
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {loading && !data ? (
        <PageSkeleton variant="cards" label="正在生成 7 天计划" />
      ) : !data ? null : (
        <>
          <div className="stats-row">
            <Stat label="本周任务" value={weekTotal} hint="今天起 7 天" />
            <Stat label="已完成" value={weekDone} hint={weekTotal ? `完成率 ${Math.round((weekDone / weekTotal) * 100)}%` : '—'} />
            <Stat
              label="今日进度"
              value={today ? `${today.done}/${today.total}` : '0/0'}
              hint="完成当天任务后可直接进入下一项"
            />
          </div>

          {today && today.tasks.length === 0 && (
            <Callout tone="info">今天没有安排任务，可以先去完成一场模拟面试，系统会自动补充薄弱项练习。</Callout>
          )}

          <div className="plan-days">
            {data.days.map((day) => (
              <PlanDayCard key={day.date} day={day} today={data.today} busyId={busyId} onToggle={toggle} />
            ))}
          </div>

          <p className="app-hint">
            计划由最近一份面试报告的薄弱项与复习点、到期复习任务、投递跟进日期自动生成；任务完成状态保存在本机数据库，
            换设备或清空前请先导出备份。
          </p>
        </>
      )}
    </div>
  );
}

function PlanDayCard({
  day,
  today,
  busyId,
  onToggle,
}: {
  day: PlanDay;
  today: string;
  busyId: number | null;
  onToggle: (task: TrainingTask) => void;
}) {
  return (
    <Card className={`plan-day ${day.isToday ? 'plan-today' : ''}`}>
      <div className="plan-day-head">
        <div>
          <span className="plan-day-label">{dateLabel(day.date, today)}</span>
          <span className="muted small">{day.date}</span>
        </div>
        <span className="plan-day-count">
          {day.done}/{day.total || 0}
        </span>
      </div>
      {day.tasks.length === 0 ? (
        <p className="muted small">这一天暂无任务。</p>
      ) : (
        <ul className="plan-list">
          {day.tasks.map((task) => (
            <li key={task.id} className={task.status === 'done' ? 'done' : ''}>
              <button
                type="button"
                className="plan-check"
                aria-pressed={task.status === 'done'}
                aria-label={task.status === 'done' ? '标记为待办' : '标记为已完成'}
                disabled={busyId === task.id}
                onClick={() => onToggle(task)}
              >
                {task.status === 'done' ? '✓' : '○'}
              </button>
              <div className="plan-task-main">
                <span className="plan-task-title">{task.title}</span>
                <Link to={taskTarget(task)} className="plan-task-link">
                  {taskActionLabel(task)} →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
