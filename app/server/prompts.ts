import type { ChatMsg, VisionPart } from './llm.js';
import { FOLLOWUP_FOCUS_LABEL, roundByKey } from './interview-plan.js';

const BASE = `你是「丰麟云面」的求职教练，服务对象是中国高校正在找实习/校招的学生。
要求：中文回答；具体、可执行；不空泛说教；不编造学生没有提供的事实；引用学生原文时要准确。`;

const JSON_ONLY = `只输出一个 JSON 对象，不要输出任何解释、前言、Markdown 代码围栏或注释。`;

export function suggestionsPrompt(resumeText: string, jobTitle: string): ChatMsg[] {
  return [
    { role: 'system', content: `${BASE}\n你擅长用 HR 和面试官的视角批改简历。${JSON_ONLY}` },
    {
      role: 'user',
      content: `目标岗位：${jobTitle || '（未指定，按通用校招标准）'}

下面是学生的简历原文：
"""
${resumeText}
"""

请按简历板块逐一给出修改建议（板块如：教育背景、项目经历、实习经历、技能、自我评价；只针对原文中真实存在的板块）。
每条建议都必须引用原文片段，并解释「为什么改」，理由要指向具体问题（如缺少量化结果、动词太弱、顺序不合理、信息冗余、与目标岗位不相关）。

严格按以下 JSON 结构输出：
{
  "overall": "对整份简历的 2-3 句总体判断",
  "highlights": ["已经做得好的点，最多 3 条"],
  "sections": [
    {
      "name": "板块名称",
      "items": [
        {
          "original": "原文片段（可截取一句）",
          "advice": "改后怎么写（给出可直接替换的文字）",
          "reason": "为什么改，点明问题类型",
          "category": "wording | quantify | structure | redundancy | content"
        }
      ]
    }
  ]
}
要求：items 总数控制在 6-12 条，优先给影响最大的；advice 必须是可直接使用的中文表述，不要写成"建议增加量化"这类空话。
硬性约束：advice 中不得编造学生原文没有的数字或事实；如果原文缺少数据，改写时用「待补充：xx%」这样的占位，绝不能自己填一个数字。`,
    },
  ];
}

export function jdMatchPrompt(resumeText: string, jd: string): ChatMsg[] {
  return [
    { role: 'system', content: `${BASE}\n你负责做简历与 JD 的匹配度诊断。${JSON_ONLY}` },
    {
      role: 'user',
      content: `【招聘 JD】
"""
${jd}
"""

【学生简历】
"""
${resumeText}
"""

请完成：
1. 从 JD 中提取 6-10 条关键要求（技能、经验、素质），逐条判断简历现状：covered（已覆盖）/ partial（部分覆盖）/ missing（缺失），并给出简历中的证据或缺失说明。
2. 计算匹配度 score（0-100 的整数），要能由覆盖情况解释，不要虚高。
3. 列出缺失关键词（JD 里有、简历里没有的词或能力项）。
4. 给出 3-5 条可执行的补齐动作。

严格按以下 JSON 输出：
{
  "score": 72,
  "verdict": "一句话结论，例如：基础匹配，但缺少可量化的项目结果",
  "covered": [
    { "requirement": "JD 中的要求", "status": "covered|partial|missing", "evidence": "简历中的对应证据，缺失时说明缺什么" }
  ],
  "missingKeywords": ["关键词1", "关键词2"],
  "actions": ["动作1", "动作2"]
}`,
    },
  ];
}

export function questionPrompt(params: {
  roundKey: string;
  resumeText: string;
  jobTitle: string;
  jd?: string;
  asked: string[];
  seedQuestion?: string;
}): ChatMsg[] {
  const round = roundByKey(params.roundKey);
  const roundRule: Record<string, string> = {
    intro: '让候选人做自我介绍，要求结合目标岗位，不要泛泛而谈。',
    professional: '针对简历中的项目经历、技术/专业能力提问，必须点名具体项目或技能，问「怎么做、为什么这么做、效果如何」。',
    behavioral: '行为面试题，考察协作、抗压、主动性、失败复盘等，要求候选人用真实经历回答。',
    reverse: '现在轮到候选人向你提问：请以面试官身份邀请候选人提问，并提示什么样的反问是有价值的（不要替候选人编问题）。',
  };
  return [
    { role: 'system', content: `${BASE}\n你正在主持一场模拟面试，第 ${round.numeral} 轮「${round.name}」。${JSON_ONLY}` },
    {
      role: 'user',
      content: `目标岗位：${params.jobTitle || '未指定'}
${params.jd ? `岗位 JD（节选）：${params.jd.slice(0, 1200)}` : ''}

候选人简历：
"""
${params.resumeText.slice(0, 4000)}
"""

本轮要求：${roundRule[round.key]}
已经问过的问题（不要重复）：
${params.asked.length ? params.asked.map((q, i) => `${i + 1}. ${q}`).join('\n') : '（无）'}
${params.seedQuestion ? `\n请把下面这道来自候选人个人题库的题改写成本轮的自然提问，保留考察点：\n"${params.seedQuestion}"\n` : ''}

只提出 1 个问题，口语化、像真人面试官，不超过 90 字。
输出 JSON：{ "question": "问题正文", "focus": "这道题在考察什么（10 字以内）" }`,
    },
  ];
}

export function feedbackPrompt(params: {
  roundKey: string;
  question: string;
  answer: string;
  jobTitle: string;
  depth: number;
}): ChatMsg[] {
  const round = roundByKey(params.roundKey);
  return [
    {
      role: 'system',
      content: `${BASE}\n你是严格但友善的面试官，给回答打三维分并给出可直接照抄的改进示范。${JSON_ONLY}`,
    },
    {
      role: 'user',
      content: `目标岗位：${params.jobTitle || '未指定'}
当前轮次：${round.name}
${params.depth > 0 ? `这是第 ${params.depth} 层追问。` : ''}

面试问题：${params.question}

候选人回答：
"""
${params.answer}
"""

请评估：
- structure（结构，0-100）：是否有清晰层次，行为题是否用了 STAR（情境-任务-行动-结果）
- content（内容，0-100）：是否有具体事实、数据、个人贡献，是否切题
- expression（表达，0-100）：是否啰嗦、口癖多、逻辑跳跃、时间分配失控

再给出：
- strengths：1-2 条做得好的地方（具体到原句）
- issues：1-3 条必须改的问题（具体到原句）
- improvedAnswer：一段 120-220 字的改写示范，用第一人称，保留候选人原有事实，不得编造新数据（缺少数据用「待补充：xx」占位）
- followup：如果回答里还有值得深挖且未超过追问上限的点，给 1 个追问（focus 只能是 project_detail / data_source / personal_contribution）；否则为 null

严格按以下 JSON 输出：
{
  "scores": { "structure": 78, "content": 65, "expression": 82 },
  "summary": "一句话总评",
  "strengths": ["..."],
  "issues": ["..."],
  "improvedAnswer": "...",
  "followup": { "question": "...", "focus": "project_detail" }
}`,
    },
  ];
}

export function reportPrompt(params: {
  jobTitle: string;
  turns: { round: string; question: string; answer: string; score: number | null; depth: number }[];
}): ChatMsg[] {
  const lines = params.turns
    .map((t, i) => `${i + 1}. [${t.round}${t.depth ? `·追问${t.depth}` : ''}] 问：${t.question}\n   答：${t.answer.slice(0, 500)}`)
    .join('\n');
  return [
    { role: 'system', content: `${BASE}\n你负责在模拟面试结束后出具复盘报告。${JSON_ONLY}` },
    {
      role: 'user',
      content: `目标岗位：${params.jobTitle || '未指定'}

整场问答记录：
${lines}

请出具报告：
- overallScore：整场 0-100 的整数评分
- roundScores：每一轮的得分与一句点评（轮次名用：自我介绍 / 专业能力 / 行为面试 / 反问环节，只包含实际发生的轮次）
- weaknesses：3-5 条薄弱环节，要具体（如「讲项目时只说做了什么，没说结果数据」）
- reviewPoints：4-6 个建议复习点，可执行（如「把项目 X 的 QPS 从多少提升到多少补进答案」）
- summary：2-3 句总评与下一步建议

严格按以下 JSON 输出：
{ "overallScore": 74, "roundScores": [{"round":"自我介绍","score":80,"comment":"..."}], "weaknesses": ["..."], "reviewPoints": ["..."], "summary": "..." }`,
    },
  ];
}

export function iteratePrompt(params: {
  resumeText: string;
  currentResume: string;
  jobTitle: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): ChatMsg[] {
  return [
    { role: 'system', content: `${BASE}\n你在和学生一起迭代简历，每轮都要给出可直接使用的改后版本。${JSON_ONLY}` },
    {
      role: 'user',
      content: `目标岗位：${params.jobTitle || '未指定'}

简历的初始版本：
"""
${params.resumeText}
"""

当前最新版本：
"""
${params.currentResume}
"""

对话记录（最近 8 条）：
${params.messages.slice(-8).map((m) => `${m.role === 'user' ? '学生' : '你'}：${m.content}`).join('\n')}

请回应当前这条消息：解释你改了什么、为什么改；如果学生要求修改，输出完整的最新简历全文（保留未改动部分的原文，不要缩写、不要省略号）。
如果没有新的改动需求（例如只是提问），revisedResume 可以为 null。

严格按以下 JSON 输出：
{ "reply": "给学生的回复，说明改动点与理由", "revisedResume": "完整简历全文或 null", "changes": ["改动点1", "改动点2"] }`,
    },
  ];
}

export function polishPrompt(guidedMarkdown: string, jobTitle: string): ChatMsg[] {
  return [
    { role: 'system', content: `${BASE}\n你负责把新手按模板填写的初稿润色成可投递版本，但不得编造原文没有的经历或数据。${JSON_ONLY}` },
    {
      role: 'user',
      content: `目标岗位：${jobTitle || '未指定'}

新手初稿：
"""
${guidedMarkdown}
"""

请润色：动词更有力、结果更具体（只能使用初稿已有的信息，缺数据就保留缺口并写成「待补充：xx%」，不要编造）、去掉空话、统一时态与格式。
输出 JSON：{ "resume": "润色后的完整简历 Markdown", "notes": ["改动说明1", "改动说明2"] }`,
    },
  ];
}

export function reviewCoachPrompt(params: { question: string; answer: string; performance: string }): ChatMsg[] {
  return [
    { role: 'system', content: `${BASE}\n你在帮学生把一次面试失败沉淀成可复习的经验。${JSON_ONLY}` },
    {
      role: 'user',
      content: `题目：${params.question}
我的回答：${params.answer || '（未填写）'}
我的实际表现：${params.performance || '（未填写）'}

请给出：improvement（可执行的改进点，2-3 句）、tags（2-4 个标签，如「STAR」「量化」「项目细节」）。
输出 JSON：{ "improvement": "...", "tags": ["..."] }`,
    },
  ];
}

/** 简历图片（扫描件/照片）结构化：固定五个字符串字段。 */
export function resumeImagePrompt(
  images: { mimeType: string; base64: string }[],
  fileName: string,
): ChatMsg[] {
  const parts: VisionPart[] = images.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
  }));
  parts.push({
    type: 'text',
    text: `这是学生上传的简历图片（文件名：${fileName || '未命名'}，共 ${images.length} 页）。请识别并结构化，保留中文原文，不要编造图片里没有的信息。

输出要求：
1. basic：姓名、联系方式、求职意向等基本信息，用换行分隔；
2. education：教育背景（学校、专业、学历、时间、GPA、主修课程等）；
3. projects：项目经历（项目名、角色、做法、量化结果），保留分点换行；
4. skills：技能与证书；
5. rawText：你在图片中看到的全部文字（尽量按原顺序），控制在 500 字以内，用于用户对照校对。

某一部分确实没有内容时，输出空字符串 ""。所有字段都必须是字符串，不要使用数组或嵌套对象。
JSON 结构：{ "basic": "", "education": "", "projects": "", "skills": "", "rawText": "" }`,
  });
  return [
    {
      role: 'system',
      content: `${BASE}\n你擅长把扫描件/照片里的简历准确转成结构清晰的文字，识别不清楚的内容宁可留空也不猜测。${JSON_ONLY}`,
    },
    { role: 'user', content: parts },
  ];
}
