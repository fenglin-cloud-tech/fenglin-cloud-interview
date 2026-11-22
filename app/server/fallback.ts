import type { FeedbackResult, JdMatchResult } from './schemas.js';
import { roundByKey } from './interview-plan.js';

/**
 * 本地降级实现：模型不可用（未配置 Key / 超时 / 连续解析失败）时，
 * 用确定性的规则给出结果，并在前端明确标注「本地降级」。
 * 降级结果不编造候选人的经历与数据。
 */

const DICT = [
  'Java', 'Python', 'C++', 'Go', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Node', 'Spring', 'SpringBoot',
  'MySQL', 'Redis', 'Linux', 'Git', 'Docker', 'Kubernetes', '算法', '数据结构', '分布式', '微服务', '高并发',
  '性能优化', 'SQL', '机器学习', '深度学习', 'PyTorch', 'TensorFlow', 'Pandas', '数据分析', '数据可视化',
  '自动化测试', '接口测试', '爬虫', '小程序', 'Android', 'iOS', 'Flutter', 'HTML', 'CSS', 'HTTP', 'REST',
  '需求分析', '用户调研', '竞品分析', '原型', 'Axure', 'Figma', 'PRD', '数据指标', 'A/B', '项目管理',
  '用户增长', '商业化', '用户体验', '内容运营', '用户运营', '活动策划', '社群', '新媒体', '公众号', '小红书',
  '抖音', '短视频', '文案', '留存', '转化', '拉新', '数据复盘', '投放', 'SEO', 'GMV', 'DAU', '活动',
  '沟通', '协作', '抗压', '学习能力', '责任心', '主动性', '英语', 'CET-6', '实习', '竞赛', '奖学金', '论文',
];

const STOP = new Set([
  'the', 'and', 'for', 'with', 'you', 'are', 'our', 'will', 'have', 'this', 'that', 'from', 'your', 'all',
  'not', '但', '以及', '相关', '优先', '熟悉', '掌握', '具备', '负责', '参与', '能力', '经验', '要求', '工作',
  '以上', '以下', '我们', '岗位', '职责', '任职', '加分', '公司', '团队', '能够', '良好', '优秀',
]);

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function extractRequirements(jd: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length < 2 || t.length > 28) return;
    const k = norm(t);
    if (seen.has(k)) return;
    seen.add(k);
    found.push(t);
  };

  for (const term of DICT) {
    if (jd.toLowerCase().includes(term.toLowerCase())) push(term);
  }
  const tokens = jd.match(/[A-Za-z][A-Za-z+#.]{2,}/g) || [];
  for (const tk of tokens) {
    if (STOP.has(tk.toLowerCase())) continue;
    push(tk);
  }
  const lines = jd.split(/[\n。；;]/).map((l) => l.trim()).filter((l) => l.length >= 6);
  for (const line of lines) {
    if (/要求|负责|熟悉|掌握|具备|优先|经验|能力|参与|任职/.test(line)) {
      push(line.replace(/^[\d.、\-·•\s]+/, '').slice(0, 26));
    }
  }
  return found.slice(0, 10);
}

export function localSkillTags(jd: string): { skill: string; weight: number }[] {
  const lower = jd.toLowerCase();
  const scored: { skill: string; weight: number; count: number }[] = [];
  for (const term of DICT) {
    const count = lower.split(term.toLowerCase()).length - 1;
    if (count > 0) scored.push({ skill: term, weight: Math.min(3, 1 + count - 1), count });
  }
  scored.sort((a, b) => b.count - a.count);
  return scored.slice(0, 20).map((s) => ({ skill: s.skill, weight: Math.max(1, s.weight) }));
}

export function localJdMatch(resumeText: string, jd: string): JdMatchResult {
  const reqs = extractRequirements(jd);
  const resumeNorm = norm(resumeText);
  if (!reqs.length) {
    return {
      score: 0,
      verdict: 'JD 有效信息太少，无法做关键词比较；请补充更完整的岗位描述。',
      covered: [],
      missingKeywords: [],
      actions: ['粘贴包含「岗位职责 / 任职要求」的完整 JD 后重试。'],
    };
  }
  let credit = 0;
  const covered = reqs.map((req) => {
    const key = norm(req);
    const direct = resumeNorm.includes(key);
    const parts = req.split(/[、,，/]/).map(norm).filter((p) => p.length >= 2);
    const hitParts = parts.filter((p) => resumeNorm.includes(p)).length;
    if (direct || (parts.length > 1 && hitParts === parts.length)) {
      credit += 1;
      return { requirement: req, status: 'covered' as const, evidence: '简历中出现同义/同名关键词' };
    }
    if (hitParts > 0) {
      credit += 0.5;
      return { requirement: req, status: 'partial' as const, evidence: `仅覆盖其中 ${hitParts}/${parts.length} 个要点` };
    }
    return { requirement: req, status: 'missing' as const, evidence: '简历中未检索到对应关键词' };
  });
  const score = Math.round((credit / reqs.length) * 100);
  return {
    score,
    verdict:
      score >= 75
        ? '关键词覆盖较好，重点是把覆盖到的能力写出结果。'
        : score >= 45
          ? '基础匹配，但存在明显缺失项，建议按缺失清单补齐。'
          : '匹配度偏低，简历关键词与 JD 脱节，需要重写部分板块。',
    covered,
    missingKeywords: covered.filter((c) => c.status === 'missing').map((c) => c.requirement),
    actions: [
      '把缺失关键词对应到真实经历上，写进项目或技能板块，不要只堆词。',
      '每条项目经历补一句结果数据（规模、提升幅度、耗时）。',
      '优先保证 JD 前三条要求的可见度。',
    ],
  };
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

export function localFeedback(params: {
  roundKey: string;
  question: string;
  answer: string;
  language?: 'zh' | 'en';
}): FeedbackResult {
  if (params.roundKey === 'reverse') return localReverseFeedback(params);
  if (params.language === 'en') return localFeedbackEn(params);
  const answer = params.answer.trim();
  const round = roundByKey(params.roundKey);
  const len = answer.length;
  const issues: string[] = [];
  const strengths: string[] = [];

  const starHits = countMatches(answer, /(当时|背景|情况下|负责|任务是|目标|我做了|我搭建|我设计|最终|结果|提升|降低|达成)/g);
  const numbered = /(^|\n)\s*(\d+[.、)]|第[一二三四]|首先|其次|再次|最后)/.test(answer);
  const hasNumber = /\d+(\.\d+)?\s*(%|％|万|千|人|次|天|小时|ms|秒|倍|个|条|篇|元|元\/|w|W)/.test(answer) || /\d{2,}/.test(answer);
  const filler = countMatches(answer, /(嗯|那个|就是|然后|其实|反正|所以说)/g);

  let structure = 58;
  if (numbered) structure += 12;
  if (starHits >= 4) structure += 14;
  else if (starHits >= 2) structure += 7;
  else issues.push('回答缺少「情境-任务-行动-结果」的层次，面试官很难跟上你的思路。');
  if (len < 60) {
    structure -= 8;
    issues.push(`回答只有 ${len} 字，信息量不足，至少展开到 150 字。`);
  }
  structure = Math.max(30, Math.min(92, structure));

  let content = 52;
  if (hasNumber) {
    content += 20;
    strengths.push('回答里带了具体数字/规模，可信度明显更高。');
  } else {
    issues.push('没有出现任何数据或规模描述，建议补充「多少人/多少量/提升多少」。');
  }
  if (/(我)[^，。]{0,20}(负责|主导|完成|搭建|设计|推动)/.test(answer)) {
    content += 12;
    strengths.push('明确说出了自己的动作与贡献。');
  } else {
    issues.push('多用「我们」，缺少「我」的具体贡献，容易被追问。');
  }
  if (len >= 150 && len <= 600) content += 8;
  if (len > 900) {
    content -= 8;
    issues.push('回答超过 900 字，面试中会显得没有重点。');
  }
  content = Math.max(30, Math.min(92, content));

  let expression = 80;
  expression -= Math.min(24, filler * 6);
  if (filler >= 3) issues.push(`口癖词（嗯/那个/然后）出现 ${filler} 次，建议放慢语速、用停顿替代。`);
  const sentences = answer.split(/[。！？!?\n]/).filter((s) => s.trim().length > 0);
  if (sentences.length >= 2 && sentences.length <= 8) expression += 6;
  if (len < 40) expression -= 10;
  expression = Math.max(30, Math.min(95, expression));

  if (!strengths.length) strengths.push('回答切题，方向没有跑偏。');

  return {
    scores: { structure, content, expression },
    summary: `本地规则评估（未调用模型）：${round.name}轮侧重${round.desc}，当前回答${len}字。`,
    strengths,
    issues: issues.length ? issues.slice(0, 4) : ['整体结构完整，可以再补一句结果数据让回答更扎实。'],
    improvedAnswer: '',
    followup: null,
  };
}

const BEHAVIOR_POOL = [
  '讲一次你和队友意见不一致的经历，最后怎么解决的？',
  '说一件你主动推动、但一开始没人支持的事。',
  '讲一次失败或搞砸的经历，你从中改了什么？',
  '同时有多个截止时间时，你怎么安排优先级？',
];

const BEHAVIOR_POOL_EN = [
  'Tell me about a time you disagreed with a teammate. How did you resolve it?',
  'Describe something you proactively pushed forward even though nobody supported it at first.',
  'Tell me about a failure or a project that went wrong. What did you change afterwards?',
  'How do you prioritise when several deadlines collide?',
];

/** FUNC-14：反问轮本地降级也按「相关性 / 信息价值 / 岗位理解」评估，不套 STAR。 */
function localReverseFeedback(params: {
  question: string;
  answer: string;
  language?: 'zh' | 'en';
}): FeedbackResult {
  const en = params.language === 'en';
  const answer = params.answer.trim();
  const len = en ? answer.split(/\s+/).filter(Boolean).length : answer.replace(/\s/g, '').length;
  const issues: string[] = [];
  const strengths: string[] = [];

  let relevance = 62;
  if (/(团队|业务|成长|岗位|职责|技术栈|培养|晋升|team|product|growth|role|responsibility|mentor|tech stack)/i.test(answer)) {
    relevance += 16;
    strengths.push(en ? 'Your questions target the role, team or growth rather than generic benefits.' : '问题围绕岗位、团队或成长，方向是对的。');
  } else {
    issues.push(en ? 'Questions are not clearly tied to this role. Ask about the team, the product or the first-six-month expectations.' : '问题和这个岗位关系不直接，建议问团队、业务或入职前六个月的目标。');
  }
  if (/(薪资|加班|福利|salary|overtime|welfare|bonus)/i.test(answer) && len < (en ? 30 : 40)) {
    relevance -= 14;
    issues.push(en ? 'Opening with salary or overtime before any role question weakens the impression.' : '一上来只问薪资/加班，会削弱印象分。');
  }
  relevance = Math.max(30, Math.min(90, relevance));

  let info = 58;
  const questionMarks = (answer.match(/[?？]/g) || []).length;
  if (questionMarks >= 2) {
    info += 14;
    strengths.push(en ? 'You asked multiple open questions instead of one closed question.' : '提了多个开放问题，而不是只问一个是非题。');
  } else {
    issues.push(en ? 'Add one or two follow-up questions so the answer gives you decision-useful information.' : '再补 1-2 个追问，让回答能帮你做判断。');
  }
  if (len >= (en ? 20 : 25) && len <= (en ? 220 : 240)) info += 8;
  if (len < (en ? 8 : 10)) info -= 22;
  info = Math.max(30, Math.min(90, info));

  let role = 60;
  if (/(业务|产品|岗位|团队|技术|business|product|role|team|tech)/i.test(answer)) {
    role += 14;
    strengths.push(en ? 'The questions show you understand the role context.' : '问题体现了你对岗位 context 的理解。');
  } else {
    issues.push(en ? 'Show more role understanding: ask how the team measures success or what the biggest challenge is.' : '可以再体现岗位理解，例如问团队如何衡量成功、当前最大的挑战。');
  }
  role = Math.max(30, Math.min(90, role));

  return {
    scores: { structure: relevance, content: info, expression: role },
    summary: en
      ? 'Local rubric: reverse questions are scored on relevance, information value and role understanding, not STAR.'
      : '本地规则：反问轮按问题相关性 / 信息获取价值 / 岗位理解评估，不套用 STAR。',
    strengths: strengths.length ? strengths.slice(0, 3) : [en ? 'You did ask questions, which is better than skipping the round.' : '你完成了提问，比直接放弃反问环节要好。'],
    issues: issues.length ? issues.slice(0, 3) : [en ? 'Pick one question and make it more specific to this team.' : '挑一个问题再具体到这支团队，会更有价值。'],
    improvedAnswer: '',
    followup: null,
  };
}

function localFeedbackEn(params: { roundKey: string; question: string; answer: string }): FeedbackResult {  const answer = params.answer.trim();
  const words = answer.split(/\s+/).filter(Boolean).length;
  const round = roundByKey(params.roundKey, 'en');
  const issues: string[] = [];
  const strengths: string[] = [];

  const starHits = countMatches(
    answer,
    /(situation|context|task|goal|I led|I built|I designed|I implemented|as a result|resulted in|improved|reduced)/gi,
  );
  const numbered = /(^|\n)\s*(\d+[.)]|first|second|third|finally)/i.test(answer);
  const hasNumber = /\d+(\.\d+)?\s*(%|percent|k|m|ms|s|x|times|users|people|days|hours)?/i.test(answer);
  const filler = countMatches(answer, /\b(um|uh|like|you know|actually|basically|sort of)\b/gi);

  let structure = 58;
  if (numbered) structure += 12;
  if (starHits >= 4) structure += 14;
  else if (starHits >= 2) structure += 7;
  else issues.push('The answer lacks a Situation-Task-Action-Result structure, so the interviewer has to guess the flow.');
  if (words < 40) {
    structure -= 8;
    issues.push(`The answer is only ${words} words. Expand it to at least 80 words with concrete detail.`);
  }
  structure = Math.max(30, Math.min(92, structure));

  let content = 52;
  if (hasNumber) {
    content += 20;
    strengths.push('You used concrete numbers or scale, which makes the answer more credible.');
  } else {
    issues.push('No data or scale appears. Add how many users, how much faster, or how large the impact was.');
  }
  if (/\bI\s+(led|built|designed|implemented|owned|drove|delivered)\b/i.test(answer)) {
    content += 12;
    strengths.push('You clearly stated your own actions and contribution.');
  } else {
    issues.push('You mostly say "we" without your personal contribution, which invites follow-up questions.');
  }
  if (words >= 80 && words <= 300) content += 8;
  if (words > 450) {
    content -= 8;
    issues.push('The answer is over 450 words and loses focus for a live interview.');
  }
  content = Math.max(30, Math.min(92, content));

  let expression = 80;
  expression -= Math.min(24, filler * 6);
  if (filler >= 3) issues.push(`Filler words (um / like / actually) appear ${filler} times. Replace them with short pauses.`);
  const sentences = answer.split(/[.!?\n]/).filter((s) => s.trim().length > 0);
  if (sentences.length >= 2 && sentences.length <= 10) expression += 6;
  if (words < 30) expression -= 10;
  expression = Math.max(30, Math.min(95, expression));

  if (!strengths.length) strengths.push('The answer stays on topic and addresses the question directly.');

  return {
    scores: { structure, content, expression },
    summary: `Local rubric (no model call): ${round.name} round, ${words} words. Scores follow the same STAR / evidence / clarity rules.`,
    strengths,
    issues: issues.length ? issues.slice(0, 4) : ['The structure is complete; add one result metric to make it stronger.'],
    improvedAnswer: '',
    followup: null,
  };
}

export function localQuestion(params: {
  roundKey: string;
  resumeText: string;
  jobTitle: string;
  asked: string[];
  seedQuestion?: string;
  language?: 'zh' | 'en';
}): { question: string; focus: string } {
  if (params.seedQuestion) return { question: params.seedQuestion, focus: '题库抽题' };
  const job = params.jobTitle || '这个岗位';
  const asked = params.asked.length;
  const projLines = params.resumeText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /项目|系统|平台|小程序|App|实验|竞赛|project|system|platform|app|experiment|competition/i.test(l) && l.length > 6);
  const projName = (projLines[asked % Math.max(1, projLines.length)] || '你简历里的项目').replace(/^[-·•\d.\s]+/, '').slice(0, 40);

  if (params.language === 'en') {
    const target = params.jobTitle || 'this role';
    const project = (projLines[asked % Math.max(1, projLines.length)] || 'a project on your resume')
      .replace(/^[-·•\d.\s]+/, '')
      .slice(0, 50);
    switch (params.roundKey) {
      case 'intro':
        return {
          question: `Please introduce yourself in about one minute. Focus on why you are applying for ${target} and the experience that best represents your ability.`,
          focus: 'Self-positioning',
        };
      case 'professional': {
        const pool = [
          `Which part of "${project}" did you personally own? Why did you design it that way, and what alternatives did you consider?`,
          `What was the hardest technical or business problem in "${project}"? How did you solve it?`,
          `If you rebuilt "${project}" from scratch, what three things would you change?`,
          `For ${target}, what is the capability you most lack right now, and how do you plan to close the gap?`,
        ];
        return { question: pool[asked % pool.length], focus: 'Project detail' };
      }
      case 'behavioral':
        return { question: BEHAVIOR_POOL_EN[asked % BEHAVIOR_POOL_EN.length], focus: 'Behavioral' };
      default:
        return {
          question:
            'That is the end of my questions. What would you like to ask me? Team, product or growth questions are usually stronger than salary or overtime.',
          focus: 'Reverse question',
        };
    }
  }

  switch (params.roundKey) {
    case 'intro':
      return {
        question: `请用 1 分钟做个自我介绍，重点说说你为什么投「${job}」，以及最能代表你能力的一段经历。`,
        focus: '自我定位',
      };
    case 'professional': {
      const pool = [
        `你在「${projName}」里具体负责哪一块？为什么这样设计，有没有考虑过别的方案？`,
        `「${projName}」里最难的技术/业务点是什么？你最后怎么解决的？`,
        `如果让你把「${projName}」重做一遍，你会改哪三件事？`,
        `针对「${job}」，你觉得你目前最欠缺的一项能力是什么？打算怎么补？`,
      ];
      return { question: pool[asked % pool.length], focus: '项目细节' };
    }
    case 'behavioral':
      return { question: BEHAVIOR_POOL[asked % BEHAVIOR_POOL.length], focus: '行为面试' };
    default:
      return {
        question: '面试到这里，你有什么想问我的？可以问团队、业务或成长路径，尽量避开薪资和加班。',
        focus: '反问',
      };
  }
}
