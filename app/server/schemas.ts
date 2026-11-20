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
