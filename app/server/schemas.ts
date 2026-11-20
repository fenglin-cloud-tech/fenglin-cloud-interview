import { z } from 'zod';

/** 所有模型返回结构都在这里集中校验，服务端不信任任何模型输出。 */

export const suggestionSchema = z.object({
  overall: z.string().min(1),
  highlights: z.array(z.string()).catch([]),
  sections: z
    .array(
      z.object({
        name: z.string().min(1),
        items: z
          .array(
            z.object({
              original: z.string().catch(''),
              advice: z.string().min(1),
              reason: z.string().min(1),
              category: z.enum(['wording', 'quantify', 'structure', 'redundancy', 'content']).catch('content'),
            }),
          )
          .catch([]),
      }),
    )
    .min(1),
});
export type SuggestionResult = z.infer<typeof suggestionSchema>;

export const jdMatchSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.string().catch(''),
  covered: z
    .array(
      z.object({
        requirement: z.string().min(1),
        status: z.enum(['covered', 'partial', 'missing']).catch('missing'),
        evidence: z.string().catch(''),
      }),
    )
    .catch([]),
  missingKeywords: z.array(z.string()).catch([]),
  actions: z.array(z.string()).catch([]),
});
export type JdMatchResult = z.infer<typeof jdMatchSchema>;

export const questionSchema = z.object({
  question: z.string().min(1),
  focus: z.string().catch(''),
});
export type QuestionResult = z.infer<typeof questionSchema>;

export const feedbackSchema = z.object({
  scores: z.object({
    structure: z.number().min(0).max(100),
    content: z.number().min(0).max(100),
    expression: z.number().min(0).max(100),
  }),
  summary: z.string().catch(''),
  strengths: z.array(z.string()).catch([]),
  issues: z.array(z.string()).catch([]),
  improvedAnswer: z.string().catch(''),
  followup: z
    .object({
      question: z.string().min(1),
      focus: z.enum(['project_detail', 'data_source', 'personal_contribution']).catch('project_detail'),
    })
    .nullish(),
});
export type FeedbackResult = z.infer<typeof feedbackSchema>;

export const reportSchema = z.object({
  overallScore: z.number().min(0).max(100),
  roundScores: z
    .array(
      z.object({
        round: z.string().min(1),
        score: z.number().min(0).max(100),
        comment: z.string().catch(''),
      }),
    )
    .catch([]),
  weaknesses: z.array(z.string()).catch([]),
  reviewPoints: z.array(z.string()).catch([]),
  summary: z.string().catch(''),
});
export type ReportResult = z.infer<typeof reportSchema>;

export const iterateSchema = z.object({
  reply: z.string().min(1),
  revisedResume: z.string().nullish(),
  changes: z.array(z.string()).catch([]),
});
export type IterateResult = z.infer<typeof iterateSchema>;

export const polishSchema = z.object({
  resume: z.string().min(1),
  notes: z.array(z.string()).catch([]),
});
export type PolishResult = z.infer<typeof polishSchema>;

/** 视觉模型偶尔把字段写成对象/数组，这里在校验前转成可读文本；字段缺失仍然报错触发重试。 */
function flattenText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(flattenText).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => {
        const text = flattenText(inner);
        return text ? `${key}：${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

const RESUME_IMAGE_KEYS = ['basic', 'education', 'projects', 'skills', 'rawText'] as const;

const resumeImageBase = z.object({
  basic: z.string(),
  education: z.string(),
  projects: z.string(),
  skills: z.string(),
  rawText: z.string(),
});

/** 视觉模型解析简历图片的结构化结果；字段必须齐全，缺失会触发重试。 */
export const resumeImageSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  if (!RESUME_IMAGE_KEYS.every((key) => key in obj)) return input; // 缺字段 → zod 报错 → 重试
  return Object.fromEntries(RESUME_IMAGE_KEYS.map((key) => [key, flattenText(obj[key])]));
}, resumeImageBase.refine((value) => RESUME_IMAGE_KEYS.some((key) => value[key].trim()), '识别结果为空'));
export type ResumeImageResult = z.infer<typeof resumeImageBase>;
