import type { FeedbackResult } from './schemas.js';

type Scores = FeedbackResult['scores'];

/**
 * 回答质量的确定性特征。
 * 存在的意义：模型（glm-4-air）会锚定提示词里的示例分数，导致不同质量的回答都落在 75 附近。
 * 这里按 STAR 覆盖、量化数据、个人贡献、篇幅与扣题度算一套规则分，再与模型分加权，保证拉开差距。
 */
export interface AnswerSignals {
  length: number;
  starParts: number;
  hasQuant: boolean;
  hasOwnership: boolean;
  structured: boolean;
  filler: number;
  sentences: number;
  coreHit: number;
}

/** 低于该分数视为「回答偏弱」，触发追问（最多 2 层）。 */
export const FOLLOWUP_THRESHOLD = 72;

const RE = {
  situation: /(当时|那时|背景|情况下|期间|的时候|去年|今年|上学期|下学期|实习期)/,
  task: /(任务|目标|要解决|需要|负责|被要求|指标|KPI|需求)/,
  action: /我(?:先|再|又|还|主动|后来|随后|最终|当时|通过|利用|采用|把|从|在[^，。]{0,6})?(负责|主导|搭建|设计|实现|推动|完成|做|写|改|协调|组织|排查|优化|提出|承担|参与|用|拉|切|换|补|加|跑|发现|定位|修复|梳理|统计|对比|测)/,
  result: /(结果|最终|提升|降低|增长|缩短|减少|达成|上线|交付|获奖|通过率|转化率|降到|涨到|节省)/,
  quant: /\d+(?:\.\d+)?\s*(?:%|％|万|千|人|次|天|小时|分钟|秒|ms|毫秒|倍|个|条|篇|元|块|GB|MB|G|M|K|w|W|QPS|qps)/,
  numbered: /(^|\n)\s*(?:\d+[.、)）]|[一二三四五][、.）)]|首先|其次|然后|再次|最后)/,
  ownership: /我(?:先|再|又|还|主动|后来|随后|最终|当时|通过|利用|采用|把|从|在[^，。]{0,6})?(负责|主导|搭建|设计|实现|推动|完成|做|写|改|协调|组织|排查|优化|提出|承担|发现|定位|修复|梳理)/,
  filler: /(嗯|那个|就是|然后呢|其实|反正|所以说|怎么说呢)/g,
};

/** 问题里的高频虚词二元组，不参与扣题度计算，避免把「你在」「什么」当成关键词。 */
const QUESTION_STOP_BIGRAMS = new Set([
  '你在', '你负', '负责', '什么', '怎么', '如何', '为什', '哪些', '可以', '一下', '具体', '能否', '说说',
  '讲讲', '介绍', '这块', '其中', '时候', '有没', '没有', '觉得', '认为', '一个', '这个', '那个', '如果',
  '以及', '还有', '的话', '我们', '你们', '他们', '是怎', '么做', '么样', '能不', '不能', '请你', '谈一',
  '谈你', '谈谈', '一段', '一次', '一件', '经历', '问题', '情况',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function collectBigrams(text: string): Set<string> {
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  const set = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    set.add(cleaned.slice(i, i + 2));
  }
  return set;
}

function coreHit(question: string, answer: string): number {
  const qSet = collectBigrams(question);
  const aSet = collectBigrams(answer);
  const keywords = [...qSet].filter((g) => !QUESTION_STOP_BIGRAMS.has(g));
  if (!keywords.length) return 0;
  let hit = 0;
  for (const g of keywords) {
    if (aSet.has(g)) hit += 1;
  }
  return clamp(hit / keywords.length, 0, 1);
}

export function analyzeAnswer(question: string, answer: string): AnswerSignals {
  const length = answer.replace(/\s/g, '').length;
  const starParts = [RE.situation, RE.task, RE.action, RE.result].filter((re) => re.test(answer)).length;
  const sentences = answer.split(/[。！？!?\n]/).filter((s) => s.trim().length > 0).length;
  return {
    length,
    starParts,
    hasQuant: RE.quant.test(answer),
    hasOwnership: RE.ownership.test(answer),
    structured: RE.numbered.test(answer) || (answer.match(/\n/g) || []).length >= 2,
    filler: (answer.match(RE.filler) || []).length,
    sentences,
    coreHit: coreHit(question, answer),
  };
}

/** 按可观察证据给出结构 / 内容 / 表达三档规则分。 */
export function rubricScores(signals: AnswerSignals): Scores {
  const { length, starParts, hasQuant, hasOwnership, structured, filler, sentences, coreHit: hit } = signals;

  let structure = 38 + starParts * 9;
  if (structured) structure += 7;
  if (length >= 150) structure += 6;
  else if (length >= 80) structure += 3;
  if (length < 60) structure -= 10;
  if (length < 30) structure -= 8;

  let content = 34;
  if (hasQuant) content += 18;
  if (hasOwnership) content += 12;
  content += Math.round(hit * 16);
  if (length >= 150) content += 8;
  else if (length >= 80) content += 4;
  else if (length < 60) content -= 8;
  if (starParts >= 3) content += 4;

  let expression = 62;
  if (length >= 80 && length <= 800) expression += 14;
  else if (length >= 40) expression += 6;
  else expression -= 12;
  if (sentences >= 2 && sentences <= 10) expression += 6;
  if (structured) expression += 4;
  expression -= Math.min(18, filler * 3);
  if (length > 900) expression -= 6;

  return {
    structure: clamp(structure, 20, 95),
    content: clamp(content, 20, 96),
    expression: clamp(expression, 25, 95),
  };
}

/**
 * 把模型分与规则分加权，并对「明显敷衍」「明显扎实」两类做上下限保护：
 * - 一两句话且无数据：三维封顶，保证稳定低于追问阈值；
 * - 篇幅充足、有量化或个人贡献：三维托底，保证详细作答不被误判为弱回答。
 */
export function calibrateScores(signals: AnswerSignals, llm: Scores): Scores {
  const rule = rubricScores(signals);
  const blend = (key: keyof Scores) => Math.round(llm[key] * 0.4 + rule[key] * 0.6);
  const out: Scores = {
    structure: blend('structure'),
    content: blend('content'),
    expression: blend('expression'),
  };
  const ruleAvg = (rule.structure + rule.content + rule.expression) / 3;

  if (signals.length < 60 || ruleAvg < 52) {
    out.structure = Math.min(out.structure, 60);
    out.content = Math.min(out.content, 58);
    out.expression = Math.min(out.expression, 64);
  } else if (signals.length < 120 && !signals.hasQuant) {
    out.structure = Math.min(out.structure, 68);
    out.content = Math.min(out.content, 66);
    out.expression = Math.min(out.expression, 72);
  }

  const thorough =
    signals.length >= 140 &&
    (signals.hasQuant || signals.starParts >= 3) &&
    (signals.hasOwnership || signals.hasQuant || signals.coreHit >= 0.1);
  if (thorough) {
    out.structure = Math.max(out.structure, 72);
    out.content = Math.max(out.content, 74);
    out.expression = Math.max(out.expression, 75);
  }

  return out;
}

/** 模型没给追问、但分数已低于阈值时，用规则补一个方向明确的追问，保证追问可触发。 */
export function buildFallbackFollowup(params: {
  signals: AnswerSignals;
  scores: Scores;
  depth: number;
}): { question: string; focus: 'project_detail' | 'data_source' | 'personal_contribution' } {
  const { signals, scores, depth } = params;
  const weakest = (Object.entries(scores) as [keyof Scores, number][]).sort((a, b) => a[1] - b[1])[0][0];

  if (weakest === 'content' || !signals.hasQuant) {
    return {
      question:
        depth === 0
          ? '你刚才的回答还停留在「做了什么」，没有说结果。这件事的规模、关键指标和最终结果分别是多少？'
          : '具体到数据口径：这个结果是怎么统计出来的，周期多长、对比的基线是什么？',
      focus: 'data_source',
    };
  }
  if (weakest === 'structure') {
    return {
      question:
        depth === 0
          ? '能按「情境—任务—行动—结果」的顺序重讲一遍吗？重点说你个人做了哪些动作。'
          : '你刚才提到的做法里，哪一步是你独立完成的？当时为什么选这个方案而不是别的？',
      focus: 'project_detail',
    };
  }
  return {
    question:
      depth === 0
        ? '这件事里团队和你各自负责什么？哪一部分是你独立完成的？'
        : '如果这件事重做一遍，你会改哪一处？为什么？',
    focus: 'personal_contribution',
  };
}
