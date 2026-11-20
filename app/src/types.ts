export interface Profile {
  id: number;
  nickname: string;
  school: string;
  major: string;
  grade: string;
  updated_at: string;
}

export interface Resume {
  id: number;
  title: string;
  content: string;
  job_id: number | null;
  job_title?: string | null;
  source: 'manual' | 'template' | 'ai' | string;
  created_at: string;
  updated_at: string;
  analysis_count?: number;
  interview_count?: number;
}

export interface Job {
  id: number;
  title: string;
  company: string;
  jd: string;
  created_at: string;
  updated_at: string;
  resume_count?: number;
  interview_count?: number;
}

export interface TemplateSection {
  key: string;
  name: string;
  hint: string;
  questions: string[];
  good: string;
  bad: string;
  placeholder: string;
  required: boolean;
}

export interface ResumeTemplate {
  id: string;
  name: string;
  tagline: string;
  roles: string[];
  accent: string;
  sections: TemplateSection[];
  sample: string;
}

export type SuggestionCategory = 'wording' | 'quantify' | 'structure' | 'redundancy' | 'content';

export interface SuggestionResult {
  overall: string;
  highlights: string[];
  sections: {
    name: string;
    items: { original: string; advice: string; reason: string; category: SuggestionCategory }[];
  }[];
}

export type CoverageStatus = 'covered' | 'partial' | 'missing';

export interface JdMatchResult {
  score: number;
  verdict: string;
  covered: { requirement: string; status: CoverageStatus; evidence: string }[];
  missingKeywords: string[];
  actions: string[];
}

export interface LlmMeta {
  source: 'llm' | 'local';
  model?: string;
  attempts?: number;
  ms?: number;
  note?: string;
}

export interface FeedbackResult {
  scores: { structure: number; content: number; expression: number };
  summary: string;
  strengths: string[];
  issues: string[];
  improvedAnswer: string;
  followup: { question: string; focus: 'project_detail' | 'data_source' | 'personal_contribution' } | null;
}

export interface ReportResult {
  overallScore: number;
  roundScores: { round: string; score: number; comment: string }[];
  weaknesses: string[];
  reviewPoints: string[];
  summary: string;
}

export interface Turn {
  id: number;
  interview_id: number;
  round_key: string;
  seq: number;
  depth: number;
  parent_id: number | null;
  question: string;
  focus: string;
  focusLabel: string;
  answer: string | null;
  feedback: FeedbackResult | null;
  score: number | null;
  source: 'llm' | 'local' | string;
  created_at: string;
  answered_at: string | null;
}

export interface PlanRound {
  key: string;
  name: string;
  numeral: string;
  desc: string;
  count: number;
}

export interface Session {
  interview: {
    id: number;
    resume_id: number | null;
    job_id: number | null;
    mode: 'resume' | 'bank';
    status: 'active' | 'finished';
    round_key: string;
    question_index: number;
    started_at: string;
    ended_at: string | null;
    overall_score: number | null;
    report: ReportResult | null;
    seed: string[];
  };
  resume: { id: number; title: string } | null;
  job: { id: number; title: string; company: string } | null;
  plan: PlanRound[];
  currentRound: PlanRound;
  turns: Turn[];
  progress: { answeredBase: number; total: number; answeredAll: number; percent: number };
  pendingTurn: Turn | null;
}

export interface InterviewListItem {
  id: number;
  resume_id: number | null;
  job_id: number | null;
  mode: string;
  status: string;
  round_key: string;
  started_at: string;
  ended_at: string | null;
  overall_score: number | null;
  job_title: string | null;
  resume_title: string | null;
  answered: number;
}

export interface ReviewItem {
  id: number;
  interview_id: number | null;
  bank_id: number | null;
  job_id: number | null;
  job_title?: string | null;
  question: string;
  my_answer: string;
  performance: string;
  improvement: string;
  rating: number;
  tags: string;
  created_at: string;
}

export interface BankItem {
  id: number;
  question: string;
  category: string;
  job_id: number | null;
  source: string;
  weak: number;
  ask_count: number;
  last_score: number | null;
  last_practiced_at: string | null;
  created_at: string;
  next_review_at?: string | null;
  review_stage?: number | null;
}

export type ReviewKind = 'bank' | 'review';
export type ReviewResult = 'good' | 'ok' | 'again';

export interface ReviewTask {
  kind: ReviewKind;
  refId: number;
  question: string;
  category: string | null;
  jobTitle: string | null;
  weak: number;
  stage: number;
  dueAt: string;
  overdueDays: number;
  lastReviewedAt: string | null;
  reps: number;
  rating: number | null;
  myAnswer: string | null;
  improvement: string | null;
  lastScore: number | null;
  askCount: number | null;
}

export interface ReviewPlan {
  today: string;
  dueCount: number;
  overdueCount: number;
  scheduled: number;
  nextDueAt: string | null;
  ladder: number[];
  tasks: ReviewTask[];
}

export interface ReviewResultRecord {
  kind: ReviewKind;
  refId: number;
  result: ReviewResult;
  resultLabel: string;
  stage: number;
  intervalDays: number;
  dueAt: string;
  nextDueAt: string;
  ladder: number[];
}

export interface JdAnalysisRecord {
  id: number;
  resume_id: number | null;
  job_id: number | null;
  jd: string;
  score: number;
  source: string;
  created_at: string;
  result: JdMatchResult;
}

export interface GrowthDims {
  structure: number;
  content: number;
  expression: number;
}

export interface GrowthPoint {
  id: number;
  jobId: number | null;
  jobTitle: string;
  startedAt: string;
  score: number;
  dims: GrowthDims | null;
}

export interface GrowthRadarSide {
  label: string;
  n: number;
  dims: GrowthDims;
}

export interface GrowthGroup {
  key: string;
  jobId: number | null;
  label: string;
  count: number;
  points: GrowthPoint[];
  radar: { early: GrowthRadarSide | null; recent: GrowthRadarSide | null };
}

export interface GrowthStats {
  totalFinished: number;
  groups: GrowthGroup[];
  generatedAt: string;
}
