import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Job, Profile, Resume } from './types';

interface ToastMsg {
  id: number;
  kind: 'ok' | 'err' | 'info';
  text: string;
}

interface AppContextValue {
  profile: Profile | null;
  resumes: Resume[];
  jobs: Job[];
  activeResume: Resume | null;
  activeJob: Job | null;
  aiConfigured: boolean;
  sharedDemo: boolean;
  model: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshResumes: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  setActiveResume: (id: number | null) => Promise<void>;
  setActiveJob: (id: number | null) => Promise<void>;
  saveProfile: (p: Partial<Profile>) => Promise<void>;
  toast: (text: string, kind?: ToastMsg['kind']) => void;
  toasts: ToastMsg[];
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

let toastSeq = 1;

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeResumeId, setActiveResumeId] = useState<number | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [sharedDemo, setSharedDemo] = useState(false);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const toast = useCallback((text: string, kind: ToastMsg['kind'] = 'info') => {
    const id = toastSeq++;
    setToasts((prev) => [...prev, { id, kind, text }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshResumes = useCallback(async () => {
    const { resumes: rows } = await api.resumes();
    setResumes(rows);
  }, []);

  const refreshJobs = useCallback(async () => {
    const { jobs: rows } = await api.jobs();
    setJobs(rows);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 首屏聚合接口：把 profile / resumes / jobs / state / health 合成一次往返。
      const boot = await api.bootstrap();
      setProfile(boot.profile);
      setResumes(boot.resumes);
      setJobs(boot.jobs);
      setActiveResumeId(boot.activeResumeId);
      setActiveJobId(boot.activeJobId);
      setAiConfigured(boot.aiConfigured);
      setSharedDemo(!!boot.sharedDemo);
      setModel(boot.model);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '加载失败，请刷新重试';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActiveResume = useCallback(async (id: number | null) => {
    setActiveResumeId(id);
    try {
      await api.saveState({ activeResumeId: id });
    } catch {
      /* 静默失败，界面仍以本地为准 */
    }
  }, []);

  const setActiveJob = useCallback(async (id: number | null) => {
    setActiveJobId(id);
    try {
      await api.saveState({ activeJobId: id });
    } catch {
      /* ignore */
    }
  }, []);

  const saveProfile = useCallback(async (p: Partial<Profile>) => {
    const { profile: saved } = await api.saveProfile(p);
    setProfile(saved);
  }, []);

  const activeResume = useMemo(
    () => resumes.find((r) => r.id === activeResumeId) || resumes[0] || null,
    [resumes, activeResumeId],
  );
  const activeJob = useMemo(() => jobs.find((j) => j.id === activeJobId) || jobs[0] || null, [jobs, activeJobId]);

  const value: AppContextValue = {
    profile,
    resumes,
    jobs,
    activeResume,
    activeJob,
    aiConfigured,
    sharedDemo,
    model,
    loading,
    error,
    refresh,
    refreshResumes,
    refreshJobs,
    setActiveResume,
    setActiveJob,
    saveProfile,
    toast,
    toasts,
    dismissToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
