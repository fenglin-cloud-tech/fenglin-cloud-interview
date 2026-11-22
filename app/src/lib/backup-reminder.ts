/**
 * FUNC-16：备份提醒。
 *
 * 只存在 localStorage，不上报服务端。记录：
 * - 上次成功导出备份的时间；
 * - 自上次导出后成功的写操作次数（AI 调用与备份导出/导入不计入）；
 * - 用户主动关闭提醒的时间（3 天内不再打扰）。
 */
const KEY = 'fenglin.backup.reminder.v1';
const DISMISS_DAYS = 3;

interface BackupState {
  lastExportAt: string | null;
  writes: number;
  dismissedAt: string | null;
}

const EMPTY: BackupState = { lastExportAt: null, writes: 0, dismissedAt: null };

function read(): BackupState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<BackupState>;
    return {
      lastExportAt: typeof parsed.lastExportAt === 'string' ? parsed.lastExportAt : null,
      writes: Number.isFinite(parsed.writes) ? Number(parsed.writes) : 0,
      dismissedAt: typeof parsed.dismissedAt === 'string' ? parsed.dismissedAt : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(state: BackupState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式下 localStorage 可能不可用，提醒降级为不显示 */
  }
}

export function recordBackupExport(): void {
  write({ lastExportAt: new Date().toISOString(), writes: 0, dismissedAt: null });
}

export function recordBackupWrite(): void {
  const state = read();
  state.writes += 1;
  write(state);
}

export function dismissBackupReminder(): void {
  const state = read();
  state.dismissedAt = new Date().toISOString();
  write(state);
}

export interface BackupReminder {
  show: boolean;
  reason: 'never' | 'days' | 'writes' | null;
  daysSince: number | null;
  writes: number;
}

export function getBackupReminder(): BackupReminder {
  const state = read();
  const now = Date.now();
  if (state.dismissedAt) {
    const dismissed = Date.parse(state.dismissedAt);
    if (Number.isFinite(dismissed) && now - dismissed < DISMISS_DAYS * 86_400_000) {
      return { show: false, reason: null, daysSince: null, writes: state.writes };
    }
  }
  if (!state.lastExportAt) {
    return {
      show: state.writes >= 5,
      reason: state.writes >= 5 ? 'never' : null,
      daysSince: null,
      writes: state.writes,
    };
  }
  const last = Date.parse(state.lastExportAt);
  const daysSince = Number.isFinite(last) ? Math.floor((now - last) / 86_400_000) : null;
  if (daysSince != null && daysSince > 7) {
    return { show: true, reason: 'days', daysSince, writes: state.writes };
  }
  if (state.writes >= 10) {
    return { show: true, reason: 'writes', daysSince, writes: state.writes };
  }
  return { show: false, reason: null, daysSince, writes: state.writes };
}
