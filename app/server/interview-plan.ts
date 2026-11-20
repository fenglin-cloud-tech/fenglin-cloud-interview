export interface RoundDef {
  key: 'intro' | 'professional' | 'behavioral' | 'reverse';
  name: string;
  numeral: string;
  desc: string;
  count: number;
}

export const ROUNDS: RoundDef[] = [
  { key: 'intro', name: '自我介绍', numeral: '壹', desc: '一段 1～2 分钟、有记忆点的自我介绍', count: 1 },
  { key: 'professional', name: '专业能力', numeral: '贰', desc: '围绕简历里的项目、技能与目标岗位发问', count: 3 },
  { key: 'behavioral', name: '行为面试', numeral: '叁', desc: '用 STAR 讲清一段真实经历', count: 2 },
  { key: 'reverse', name: '反问环节', numeral: '肆', desc: '向面试官提问，展示你的判断力', count: 1 },
];

export function roundByKey(key: string): RoundDef {
  return ROUNDS.find((r) => r.key === key) || ROUNDS[0];
}

export const TOTAL_BASE_QUESTIONS = ROUNDS.reduce((s, r) => s + r.count, 0);

export const FOLLOWUP_FOCUS_LABEL: Record<string, string> = {
  project_detail: '项目细节',
  data_source: '数据来源',
  personal_contribution: '个人贡献',
};
