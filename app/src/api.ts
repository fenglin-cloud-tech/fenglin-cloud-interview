import type {
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
  ReviewPlan,
  ReviewKind,
  ReviewResult,
  ReviewResultRecord,
} from './types';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw new ApiError(0, '无法连接服务端，请确认后端已启动（npm run dev）', 'NETWORK');
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
      activeResumeId: number | null;
      activeJobId: number | null;
      aiConfigured: boolean;
    }>('/dashboard'),

  growth: () => request<GrowthStats>('/stats/growth'),
  dossier: () => request<Dossier>('/dossier'),
  demoStatus: () => request<DemoStatus>('/demo'),
  loadDemo: () => post<DemoStatus & { loaded: boolean }>('/demo/load', {}),
  clearDemo: () => post<DemoStatus & { removed: number }>('/demo/clear', {}),

  templates: () => request<{ templates: ResumeTemplate[] }>('/templates'),

  state: () => request<{ activeResumeId: number | null; activeJobId: number | null }>('/state'),
  saveState: (body: { activeResumeId?: number | null; activeJobId?: number | null }) =>
    put<{ activeResumeId: number | null; activeJobId: number | null }>('/state', body),

  resumes: () => request<{ resumes: Resume[] }>('/resumes'),
  createResume: (body: { title: string; content: string; jobId?: number | null; source?: string }) =>
    post<{ resume: Resume }>('/resumes', body),
  updateResume: (id: number, body: { title?: string; content?: string; jobId?: number | null }) =>
    put<{ resume: Resume }>(`/resumes/${id}`, body),
  deleteResume: (id: number) => del<{ ok: boolean }>(`/resumes/${id}`),

  jobs: () => request<{ jobs: Job[] }>('/jobs'),
  createJob: (body: { title: string; company?: string; jd?: string }) => post<{ job: Job }>('/jobs', body),
  updateJob: (id: number, body: { title?: string; company?: string; jd?: string }) =>
    put<{ job: Job }>(`/jobs/${id}`, body),
  deleteJob: (id: number) => del<{ ok: boolean }>(`/jobs/${id}`),

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
  jdAnalyses: (resumeId?: number | null) =>
    request<{ analyses: JdAnalysisRecord[] }>(`/jd-analyses${resumeId ? `?resumeId=${resumeId}` : ''}`),
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

  interviews: () => request<{ interviews: InterviewListItem[] }>('/interviews'),
  createInterview: (body: {
    mode: 'resume' | 'bank';
    resumeId?: number | null;
    jobId?: number | null;
    bankIds?: number[];
  }) => post<Session>('/interviews', body),
  session: (id: number) => request<Session>(`/interviews/${id}`),
  answer: (id: number, body: { turnId: number; answer: string }) =>
    post<{
      feedback: FeedbackResult;
      source: string;
      score: number;
      nextTurn: Session['turns'][number] | null;
      allDone: boolean;
      session: Session;
    }>(`/interviews/${id}/answer`, body),
  finishInterview: (id: number) =>
    post<{ report: ReportResult; source?: string; session: Session }>(`/interviews/${id}/finish`),
  deleteInterview: (id: number) => del<{ ok: boolean }>(`/interviews/${id}`),

  reviews: (q?: string) => request<{ reviews: ReviewItem[] }>(`/reviews${q ? `?q=${encodeURIComponent(q)}` : ''}`),
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
    body: { question?: string; myAnswer?: string; performance?: string; improvement?: string; rating?: number; tags?: string },
  ) => put<{ review: ReviewItem }>(`/reviews/${id}`, body),
  deleteReview: (id: number) => del<{ ok: boolean }>(`/reviews/${id}`),
  exportReviews: () => request<{ markdown: string; count: number }>('/reviews/export'),
  reviewFromInterview: (id: number) => post<{ created: number }>(`/reviews/from-interview/${id}`),

  bank: (params?: { category?: string; weak?: boolean; jobId?: number | null }) => {
    const sp = new URLSearchParams();
    if (params?.category) sp.set('category', params.category);
    if (params?.weak) sp.set('weak', '1');
    if (params?.jobId) sp.set('jobId', String(params.jobId));
    const qs = sp.toString();
    return request<{
      items: BankItem[];
      facets: { category: string; n: number }[];
      totals: { total: number; weak: number; asks: number };
    }>(`/bank${qs ? `?${qs}` : ''}`);
  },
  createBankItem: (body: { question: string; category?: string; jobId?: number | null; weak?: boolean }) =>
    post<{ item: BankItem }>('/bank', body),
  updateBankItem: (id: number, body: { weak?: boolean; category?: string; question?: string }) =>
    patch<{ item: BankItem }>(`/bank/${id}`, body),
  deleteBankItem: (id: number) => del<{ ok: boolean }>(`/bank/${id}`),

  reviewPlan: () => request<ReviewPlan>('/review-plan/today'),
  recordReviewResult: (kind: ReviewKind, refId: number, result: ReviewResult) =>
    post<ReviewResultRecord>(`/review-plan/${kind}/${refId}/result`, { result }),
};
