import { hasAiConsent } from './lib/consent';
import type {
  ApplicationRecord,
  ApplicationStage,
  ApplicationCalendar,
  BankItem,
  InterviewListItem,
  JdAnalysisRecord,
  Job,
  LlmMeta,
  Profile,
  Resume,
  ResumeTemplate,
  ReviewItem,
  Session,
  SuggestionResult,
  JdMatchResult,
  FeedbackResult,
  ReportResult,
  GrowthStats,
  Dossier,
  DemoStatus,
  ExperienceCard,
  BankCard,
  JobSkillsData,
  PitchResultData,
  ResumeDiff,
  TrainingTask,
  ReviewPlan,
  ReviewKind,
  ReviewResult,
  ReviewResultRecord,
  PlanData,
  WeeklyReport,
} from './types';
import { recordBackupWrite } from './lib/backup-reminder';

export class ApiError extends Error {
  status: number;
  code: string;
  detail?: string;
  constructor(status: number, message: string, code = 'ERROR', detail?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export interface InterviewJobError {
  code: string;
  message: string;
  detail?: string;
}

export type InterviewJobResponse<T> =
  | { status: 'pending' }
  | { status: 'done'; result: T }
  | { status: 'error'; error?: InterviewJobError };

export interface AnswerJobResult {
  feedback: FeedbackResult;
  source: string;
  score: number;
  nextTurn: Session['turns'][number] | null;
  allDone: boolean;
  session: Session;
}

export interface FinishJobResult {
  report: ReportResult;
  source?: string;
  session: Session;
}

export interface SkipJobResult {
  skippedTurnId: number;
  nextTurn: Session['turns'][number] | null;
  allDone: boolean;
  remainingSkips: number;
  session: Session;
}

function needsAiConsent(path: string): boolean {
  if (path === '/ai/status') return false;
  if (path.startsWith('/ai/')) return true;
  return (
    /^\/interviews\/\d+\/(answer|finish)$/.test(path) ||
    /^\/jobs\/\d+\/skills$/.test(path) ||
    path === '/pitch/generate' ||
    /^\/bank\/\d+\/card\/generate$/.test(path) ||
    /^\/interviews\/\d+\/turns\/\d+\/skip$/.test(path)
  );
}

/** 普通请求默认 20s 超时；长任务已改为 202 + 轮询，不再占用单个请求。 */
const DEFAULT_TIMEOUT_MS = 20_000;

async function request<T>(path: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  if (needsAiConsent(path) && !hasAiConsent()) {
    throw new ApiError(428, '首次使用 AI 前，请先在页面顶部阅读并同意数据外发提示', 'AI_CONSENT_REQUIRED');
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(0, '请求超时，请检查网络后重试', 'TIMEOUT');
    }
    throw new ApiError(0, '无法连接服务端，请确认后端已启动（npm run dev）', 'NETWORK');
  } finally {
    window.clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; detail?: string } } | null)?.error;
    throw new ApiError(res.status, err?.message || `请求失败（${res.status}）`, err?.code || 'HTTP_ERROR', err?.detail);
  }
  // FUNC-16：成功写操作计数（AI 调用、备份导入/导出不计），用于备份提醒。
  const method = (init?.method || 'GET').toUpperCase();
  if (method !== 'GET' && !path.startsWith('/backup') && !needsAiConsent(path)) recordBackupWrite();
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  health: () =>
    request<{ ok: boolean; model: string; aiConfigured: boolean; sharedDemo: boolean }>('/health'),
  aiStatus: () => request<{ configured: boolean }>('/ai/status'),

  bootstrap: () =>
    request<{
      profile: Profile;
      resumes: Resume[];
      jobs: Job[];
      activeResumeId: number | null;
      activeJobId: number | null;
      aiConfigured: boolean;
      sharedDemo: boolean;
      model: string;
    }>('/bootstrap'),

  profile: () => request<{ profile: Profile }>('/profile'),
  saveProfile: (body: Partial<Profile>) => put<{ profile: Profile }>('/profile', body),

  dashboard: () =>
    request<{
      counts: {
        resumes: number;
        jobs: number;
        interviews: number;
        finished: number;
        bank: number;
        weak: number;
        reviews: number;
        analyses: number;
      };
      recent: {
        id: number;
        status: string;
        round_key: string;
        started_at: string;
        overall_score: number | null;
        job_title: string | null;
        answered: number;
      }[];
      followUps: {
        id: number;
        company: string;
        title: string;
        stage: string;
        next_action_at: string;
        next_action_note: string;
      }[];
      activeResumeId: number | null;
      activeJobId: number | null;
      aiConfigured: boolean;
    }>('/dashboard'),

  growth: () => request<GrowthStats>('/stats/growth'),
  dossier: () => request<Dossier>('/dossier'),
  exportBackup: async () => {
    const res = await fetch('/api/backup/export');
    if (!res.ok) throw new ApiError(res.status, 'BACKUP_EXPORT', '导出失败，请稍后重试');
    const text = await res.text();
    const cd = res.headers.get('content-disposition') || '';
    const name = cd.match(/filename="([^"]+)"/)?.[1] || 'fenglin-backup.json';
    return { text, filename: name, bytes: new Blob([text]).size };
  },
  previewBackup: (backup: unknown) =>
    post<
      | {
          ok: true;
          version: number;
          exportedAt: string;
          counts: Record<string, number>;
          current: Record<string, number>;
          emptyTarget: boolean;
          warnings: string[];
        }
      | { ok: false; code: string; message: string }
    >('/backup/preview', { backup }),
  importBackup: (backup: unknown, mode: 'merge' | 'overwrite') =>
    post<
      | {
          ok: true;
          mode: 'merge' | 'overwrite';
          before: Record<string, number>;
          after: Record<string, number>;
          warnings: string[];
        }
      | { ok: false; code: string; message: string }
    >('/backup/import', { backup, mode }),
  demoStatus: () => request<DemoStatus>('/demo'),
  loadDemo: () => post<DemoStatus & { loaded: boolean }>('/demo/load', {}),
  clearDemo: () => post<DemoStatus & { removed: number }>('/demo/clear', {}),

  templates: () => request<{ templates: ResumeTemplate[] }>('/templates'),

  state: () => request<{ activeResumeId: number | null; activeJobId: number | null }>('/state'),
  saveState: (body: { activeResumeId?: number | null; activeJobId?: number | null }) =>
    put<{ activeResumeId: number | null; activeJobId: number | null }>('/state', body),

  resumes: () => request<{ resumes: Resume[] }>('/resumes'),
  createResume: (body: {
    title: string;
    content: string;
    jobId?: number | null;
    parentId?: number | null;
    source?: string;
  }) => post<{ resume: Resume }>('/resumes', body),
  updateResume: (id: number, body: { title?: string; content?: string; jobId?: number | null }) =>
    put<{ resume: Resume }>(`/resumes/${id}`, body),
  deleteResume: (id: number) => del<{ ok: boolean }>(`/resumes/${id}`),
  resumeDiff: (a: number, b: number) => request<ResumeDiff>(`/resumes/${a}/diff/${b}`),

  experiences: (params?: { q?: string; jobId?: number | null; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.jobId) sp.set('jobId', String(params.jobId));
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return request<{ experiences: ExperienceCard[] }>(`/experiences${qs ? `?${qs}` : ''}`);
  },
  createExperience: (body: {
    title: string;
    role?: string;
    situation?: string;
    task?: string;
    action?: string;
    result?: string;
    metrics?: string;
    tags?: string;
    jobId?: number | null;
  }) => post<{ experience: ExperienceCard }>('/experiences', body),
  updateExperience: (
    id: number,
    body: {
      title?: string;
      role?: string;
      situation?: string;
      task?: string;
      action?: string;
      result?: string;
      metrics?: string;
      tags?: string;
      jobId?: number | null;
    },
  ) => put<{ experience: ExperienceCard }>(`/experiences/${id}`, body),
  deleteExperience: (id: number) => del<{ ok: boolean }>(`/experiences/${id}`),

  jobs: () => request<{ jobs: Job[] }>('/jobs'),
  createJob: (body: {
    title: string;
    company?: string;
    jd?: string;
    location?: string;
    salaryRange?: string;
    deadline?: string | null;
    priority?: number;
    sourceUrl?: string;
    status?: string;
  }) => post<{ job: Job }>('/jobs', body),
  updateJob: (
    id: number,
    body: {
      title?: string;
      company?: string;
      jd?: string;
      location?: string;
      salaryRange?: string;
      deadline?: string | null;
      priority?: number;
      sourceUrl?: string;
      status?: string;
    },
  ) => put<{ job: Job }>(`/jobs/${id}`, body),
  deleteJob: (id: number) => del<{ ok: boolean }>(`/jobs/${id}`),
  applications: () => request<{ applications: ApplicationRecord[] }>('/applications'),
  applicationCalendar: (from: string, to: string) =>
    request<ApplicationCalendar>(`/applications/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  applicationDetail: (id: number) =>
    request<{
      application: ApplicationRecord;
      options: {
        interviews: {
          id: number;
          started_at: string;
          ended_at: string | null;
          overall_score: number | null;
          mode: string;
          status: string;
          job_id: number | null;
          linkedApplicationId: number | null;
        }[];
        reviews: {
          id: number;
          question: string;
          rating: number;
          created_at: string;
          job_id: number | null;
          linkedApplicationId: number | null;
        }[];
      };
    }>(`/applications/${id}`),
  createApplication: (body: {
    company: string;
    title: string;
    jobId?: number | null;
    appliedOn: string;
    stage: ApplicationStage;
    note?: string;
    nextActionAt?: string | null;
    nextActionNote?: string;
  }) => post<{ application: ApplicationRecord }>('/applications', body),
  updateApplication: (
    id: number,
    body: {
      company: string;
      title: string;
      jobId?: number | null;
      appliedOn: string;
      stage: ApplicationStage;
      note?: string;
      nextActionAt?: string | null;
      nextActionNote?: string;
    },
  ) => put<{ application: ApplicationRecord }>(`/applications/${id}`, body),
  deleteApplication: (id: number) => del<{ ok: boolean }>(`/applications/${id}`),
  linkApplication: (id: number, kind: 'interview' | 'review', refId: number) =>
    post<{ application: ApplicationRecord }>(`/applications/${id}/links`, { kind, refId }),
  unlinkApplication: (id: number, kind: 'interview' | 'review', refId: number) =>
    del<{ application: ApplicationRecord }>(`/applications/${id}/links/${kind}/${refId}`),
  fetchJd: (url: string) =>
    post<
      | { ok: true; jd: string; title: string; finalUrl: string; httpStatus: number; chars: number; truncated: boolean }
      | { ok: false; code: string; message: string }
    >('/jobs/fetch-jd', { url }),

  jobSkills: (jobId: number) => request<JobSkillsData>(`/jobs/${jobId}/skills`),
  extractJobSkills: (jobId: number, forceLocal = false) =>
    post<{ jobId: string; status: 'pending' }>(`/jobs/${jobId}/skills`, { forceLocal }),
  jobSkillsJob: (jobId: number, jobIdOfTask: string) =>
    request<InterviewJobResponse<JobSkillsData>>(`/jobs/${jobId}/skills/jobs/${jobIdOfTask}`),

  trainingTasks: (params?: { date?: string; from?: string; to?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.date) sp.set('date', params.date);
    if (params?.from) sp.set('from', params.from);
    if (params?.to) sp.set('to', params.to);
    if (params?.status) sp.set('status', params.status);
    const qs = sp.toString();
    return request<{ tasks: TrainingTask[] }>(`/training-tasks${qs ? `?${qs}` : ''}`);
  },
  createTrainingTask: (body: { planDate: string; title: string; kind?: string; refId?: number | null }) =>
    post<{ task: TrainingTask }>('/training-tasks', body),
  updateTrainingTask: (id: number, body: { title?: string; status?: string }) =>
    patch<{ task: TrainingTask }>(`/training-tasks/${id}`, body),
  deleteTrainingTask: (id: number) => del<{ ok: boolean }>(`/training-tasks/${id}`),
  planToday: () => request<PlanData>('/plan/today'),
  completePlanTask: (id: number) => post<{ task: TrainingTask }>(`/plan/${id}/complete`),
  weeklyReport: (params?: { from?: string; to?: string }) => {
    const sp = new URLSearchParams();
    if (params?.from) sp.set('from', params.from);
    if (params?.to) sp.set('to', params.to);
    const qs = sp.toString();
    return request<WeeklyReport>(`/reports/weekly${qs ? `?${qs}` : ''}`);
  },

  dataCounts: () =>
    request<{ interviews: number; reviews: number; bankItems: number; applications: number; turns: number }>(
      '/data/counts',
    ),
  clearModule: (module: 'interviews' | 'reviews' | 'bank' | 'applications') =>
    post<{ ok: boolean; module: string; deleted: Record<string, number> }>('/data/clear', {
      module,
      confirm: 'CLEAR',
    }),

  generatePitch: (body: { resumeId?: number | null; jobId?: number | null }) =>
    post<{ jobId: string; status: 'pending' }>('/pitch/generate', body),
  pitchJob: (jobId: string) => request<InterviewJobResponse<PitchResultData>>(`/pitch/generate/${jobId}`),

  bankCard: (id: number) =>
    request<{ card: BankCard | null; question: string; category: string }>(`/bank/${id}/card`),
  generateBankCard: (id: number) => post<{ jobId: string; status: 'pending' }>(`/bank/${id}/card/generate`),
  bankCardJob: (id: number, jobId: string) =>
    request<InterviewJobResponse<{ card: BankCard; question: string; category: string }>>(
      `/bank/${id}/card/jobs/${jobId}`,
    ),

  suggestions: (body: { resumeText: string; jobTitle: string }) =>
    post<{ jobId: string; status: 'pending' }>('/ai/suggestions', body),
  suggestionJob: (jobId: string) =>
    request<{
      status: 'pending' | 'done' | 'error';
      result?: SuggestionResult;
      meta?: LlmMeta;
      error?: { code: string; message: string; detail?: string };
    }>(`/ai/suggestions/${jobId}`),
  jdMatch: (body: { resumeText: string; jd: string; resumeId?: number | null; jobId?: number | null }) =>
    post<{ result: JdMatchResult; meta: LlmMeta; savedId: number | null }>('/ai/jd-match', body),
  jdAnalyses: (resumeId?: number | null, cursor?: number | null, limit?: number) => {
    const sp = new URLSearchParams();
    if (resumeId) sp.set('resumeId', String(resumeId));
    if (cursor) sp.set('cursor', String(cursor));
    if (limit) sp.set('limit', String(limit));
    const qs = sp.toString();
    return request<{ analyses: JdAnalysisRecord[]; nextCursor: number | null }>(
      `/jd-analyses${qs ? `?${qs}` : ''}`,
    );
  },
  iterate: (body: {
    resumeText: string;
    currentResume: string;
    jobTitle: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }) =>
    post<{ result: { reply: string; revisedResume: string | null; changes: string[] }; meta: LlmMeta }>(
      '/ai/iterate',
      body,
    ),
  polish: (body: { markdown: string; jobTitle: string }) =>
    post<{ result: { resume: string; notes: string[] }; meta: LlmMeta }>('/ai/polish', body),
  reviewCoach: (body: { question: string; answer: string; performance: string }) =>
    post<{ result: { improvement: string; tags: string[] }; meta: LlmMeta }>('/ai/review-coach', body),
  parseResumeImage: (body: { fileName: string; images: { mimeType: string; base64: string }[] }) =>
    post<{
      result: { basic: string; education: string; projects: string; skills: string; rawText: string };
      meta: LlmMeta;
      fallback: boolean;
      note?: string;
    }>('/ai/parse-resume-image', body),

  interviews: (params?: { status?: string; mode?: string; jobId?: number | null; cursor?: number | null; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.mode) sp.set('mode', params.mode);
    if (params?.jobId) sp.set('jobId', String(params.jobId));
    if (params?.cursor) sp.set('cursor', String(params.cursor));
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return request<{ interviews: InterviewListItem[]; nextCursor: number | null }>(
      `/interviews${qs ? `?${qs}` : ''}`,
    );
  },
  commonQuestions: () =>
    request<{
      source: string;
      total: number;
      directions: { key: string; label: string; desc: string; count: number }[];
      questions: {
        id: string;
        direction: string;
        kind: 'technical' | 'project' | 'behavioral';
        question: string;
        focus: string;
      }[];
    }>('/common-questions'),
  createInterview: (body: {
    mode: 'resume' | 'bank' | 'common' | 'mixed';
    direction?: string;
    resumeId?: number | null;
    jobId?: number | null;
    bankIds?: number[];
    language?: 'zh' | 'en';
    preset?: 'standard' | 'hr' | 'stress' | 'behavioral';
  }) => post<Session>('/interviews', body),
  session: (id: number) => request<Session>(`/interviews/${id}`),
  answer: (id: number, body: { turnId: number; answer: string }) =>
    post<{ jobId: string; status: 'pending' }>(`/interviews/${id}/answer`, body),
  skipTurn: (id: number, turnId: number) =>
    post<{ jobId: string; status: 'pending' }>(`/interviews/${id}/turns/${turnId}/skip`),
  interviewJob: <T>(id: number, jobId: string) =>
    request<InterviewJobResponse<T>>(`/interviews/${id}/jobs/${jobId}`),
  finishInterview: (id: number) =>
    post<{ jobId: string; status: 'pending' } | FinishJobResult>(`/interviews/${id}/finish`),
  deleteInterview: (id: number) => del<{ ok: boolean }>(`/interviews/${id}`),

  reviews: (params?: {
    q?: string;
    jobId?: number | null;
    rating?: number | null;
    tag?: string;
    from?: string;
    to?: string;
    cursor?: number | null;
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.jobId) sp.set('jobId', String(params.jobId));
    if (params?.rating) sp.set('rating', String(params.rating));
    if (params?.tag) sp.set('tag', params.tag);
    if (params?.from) sp.set('from', params.from);
    if (params?.to) sp.set('to', params.to);
    if (params?.cursor) sp.set('cursor', String(params.cursor));
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return request<{ reviews: ReviewItem[]; nextCursor: number | null }>(`/reviews${qs ? `?${qs}` : ''}`);
  },
  createReview: (body: {
    question: string;
    myAnswer?: string;
    performance?: string;
    improvement?: string;
    rating?: number;
    tags?: string;
    jobId?: number | null;
    interviewId?: number | null;
    bankId?: number | null;
  }) => post<{ review: ReviewItem }>('/reviews', body),
  updateReview: (
    id: number,
    body: {
      question?: string;
      jobId?: number | null;
      myAnswer?: string;
      performance?: string;
      improvement?: string;
      rating?: number;
      tags?: string;
    },
  ) => put<{ review: ReviewItem }>(`/reviews/${id}`, body),
  deleteReview: (id: number) => del<{ ok: boolean }>(`/reviews/${id}`),
  exportReviews: () => request<{ markdown: string; count: number }>('/reviews/export'),
  reviewFromInterview: (id: number, includeFollowups = false) =>
    post<{ created: number }>(`/reviews/from-interview/${id}`, { includeFollowups }),

  bank: (params?: {
    category?: string;
    weak?: boolean;
    jobId?: number | null;
    q?: string;
    cursor?: number | null;
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.category) sp.set('category', params.category);
    if (params?.weak) sp.set('weak', '1');
    if (params?.jobId) sp.set('jobId', String(params.jobId));
    if (params?.q) sp.set('q', params.q);
    if (params?.cursor) sp.set('cursor', String(params.cursor));
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return request<{
      items: BankItem[];
      nextCursor: number | null;
      facets: { category: string; n: number }[];
      totals: { total: number; weak: number; asks: number };
    }>(`/bank${qs ? `?${qs}` : ''}`);
  },
  createBankItem: (body: {
    question: string;
    category?: string;
    jobId?: number | null;
    weak?: boolean;
    source?: string;
  }) => post<{ item: BankItem }>('/bank', body),
  updateBankItem: (id: number, body: { weak?: boolean; category?: string; question?: string; jobId?: number | null }) =>
    patch<{ item: BankItem }>(`/bank/${id}`, body),
  deleteBankItem: (id: number) => del<{ ok: boolean }>(`/bank/${id}`),

  reviewPlan: () => request<ReviewPlan>('/review-plan/today'),
  recordReviewResult: (kind: ReviewKind, refId: number, result: ReviewResult) =>
    post<ReviewResultRecord>(`/review-plan/${kind}/${refId}/result`, { result }),
};
