export interface RoundDef {
  key: 'intro' | 'professional' | 'behavioral' | 'reverse';
  name: string;
  numeral: string;
  desc: string;
  count: number;
}

export type InterviewLanguage = 'zh' | 'en';

export const ROUNDS: RoundDef[] = [
  { key: 'intro', name: '自我介绍', numeral: '壹', desc: '一段 1～2 分钟、有记忆点的自我介绍', count: 1 },
  { key: 'professional', name: '专业能力', numeral: '贰', desc: '围绕简历里的项目、技能与目标岗位发问', count: 3 },
  { key: 'behavioral', name: '行为面试', numeral: '叁', desc: '用 STAR 讲清一段真实经历', count: 2 },
  { key: 'reverse', name: '反问环节', numeral: '肆', desc: '向面试官提问，展示你的判断力', count: 1 },
];

const EN_ROUNDS: Record<RoundDef['key'], { name: string; numeral: string; desc: string }> = {
  intro: { name: 'Self-introduction', numeral: 'I', desc: 'A 1-2 minute introduction with a clear hook' },
  professional: { name: 'Professional', numeral: 'II', desc: 'Questions about projects, skills and the target role' },
  behavioral: { name: 'Behavioral', numeral: 'III', desc: 'Tell one real story with STAR' },
  reverse: { name: 'Reverse questions', numeral: 'IV', desc: 'Ask the interviewer questions that show judgment' },
};

export function roundsFor(language: InterviewLanguage = 'zh'): RoundDef[] {
  if (language !== 'en') return ROUNDS;
  return ROUNDS.map((r) => ({ ...r, ...EN_ROUNDS[r.key] }));
}

export function roundByKey(key: string, language: InterviewLanguage = 'zh'): RoundDef {
  const base = ROUNDS.find((r) => r.key === key) || ROUNDS[0];
  return language === 'en' ? { ...base, ...EN_ROUNDS[base.key] } : base;
}

export const TOTAL_BASE_QUESTIONS = ROUNDS.reduce((s, r) => s + r.count, 0);

/* ---------------- MOD-09：面试预设 ---------------- */

export type PresetKey = 'standard' | 'hr' | 'stress' | 'behavioral';

export interface PresetDef {
  key: PresetKey;
  name: string;
  desc: string;
  rounds: RoundDef['key'][];
  counts: Partial<Record<RoundDef['key'], number>>;
  /** 低于该分数触发追问（标准面沿用全局 72 分阈值）。 */
  followupThreshold: number;
  /** 追问最大层数。 */
  maxDepth: number;
  /** 反馈与报告的语气侧重。 */
  tone: PresetKey;
}

export const PRESETS: PresetDef[] = [
  {
    key: 'standard',
    name: '标准面',
    desc: '自我介绍 → 专业 → 行为 → 反问，最接近常规校招流程',
    rounds: ['intro', 'professional', 'behavioral', 'reverse'],
    counts: {},
    followupThreshold: 72,
    maxDepth: 2,
    tone: 'standard',
  },
  {
    key: 'hr',
    name: 'HR 面',
    desc: '重点考察动机、稳定性、沟通与团队协作，追问更偏行为细节',
    rounds: ['intro', 'behavioral', 'reverse'],
    counts: { behavioral: 3 },
    followupThreshold: 78,
    maxDepth: 1,
    tone: 'hr',
  },
  {
    key: 'stress',
    name: '压力面',
    desc: '高压追问，几乎每个回答都会被继续深挖，评分更严格',
    rounds: ['intro', 'professional', 'behavioral'],
    counts: { professional: 4, behavioral: 2 },
    followupThreshold: 88,
    maxDepth: 2,
    tone: 'stress',
  },
  {
    key: 'behavioral',
    name: '行为面',
    desc: '全行为题，重点看 STAR 完整度、复盘深度与个人贡献',
    rounds: ['intro', 'behavioral', 'reverse'],
    counts: { behavioral: 4 },
    followupThreshold: 80,
    maxDepth: 2,
    tone: 'behavioral',
  },
];

export function isPresetKey(value: unknown): value is PresetKey {
  return value === 'standard' || value === 'hr' || value === 'stress' || value === 'behavioral';
}

export function presetByKey(key: string | undefined): PresetDef {
  return PRESETS.find((p) => p.key === key) || PRESETS[0];
}

export function roundsForPreset(preset: PresetKey, language: InterviewLanguage = 'zh'): RoundDef[] {
  const def = presetByKey(preset);
  return def.rounds.map((key) => {
    const base = roundByKey(key, language);
    return { ...base, count: def.counts[key] ?? base.count };
  });
}

export const FOLLOWUP_FOCUS_LABEL: Record<string, string> = {
  project_detail: '项目细节',
  data_source: '数据来源',
  personal_contribution: '个人贡献',
};
