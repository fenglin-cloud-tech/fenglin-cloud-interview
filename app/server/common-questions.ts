/**
 * 内置常见面试题。
 * 来源性质：社区常见题型整理 / 通用高频题，由本项目建设时人工整理，不代表任何公司官方真题。
 * 不包含任何公司名 + 年份的“真题”标签，也不声称来自某家公司。
 */

export type DirectionKey = 'backend' | 'frontend' | 'data' | 'product' | 'operations';
export type QuestionKind = 'technical' | 'project' | 'behavioral';

export interface CommonQuestion {
  id: string;
  direction: DirectionKey;
  kind: QuestionKind;
  question: string;
  focus: string;
}

export const COMMON_SOURCE = '社区常见题型整理 / 通用高频题';

export const DIRECTIONS: { key: DirectionKey; label: string; desc: string }[] = [
  { key: 'backend', label: '后端开发', desc: '服务端、数据库、缓存与稳定性' },
  { key: 'frontend', label: '前端开发', desc: '浏览器、框架、性能与工程化' },
  { key: 'data', label: '数据分析', desc: 'SQL、指标体系、实验与分析表达' },
  { key: 'product', label: '产品经理', desc: '需求判断、方案设计与数据意识' },
  { key: 'operations', label: '运营', desc: '活动、增长、内容与社群运营' },
];

export const KIND_LABEL: Record<QuestionKind, string> = {
  technical: '技术基础',
  project: '项目深挖',
  behavioral: '行为面试',
};

export const COMMON_QUESTIONS: CommonQuestion[] = [
  /* ---------------- 后端开发 ---------------- */
  {
    id: 'be-t1',
    direction: 'backend',
    kind: 'technical',
    question: 'MySQL 索引失效的常见场景有哪些？线上出现慢查询，你会按什么顺序定位？',
    focus: '索引与慢查询',
  },
  {
    id: 'be-t2',
    direction: 'backend',
    kind: 'technical',
    question: '缓存穿透、击穿、雪崩分别是什么？你在项目里实际用过哪些防护手段？',
    focus: '缓存三兄弟',
  },
  {
    id: 'be-t3',
    direction: 'backend',
    kind: 'technical',
    question: '一条 HTTP 请求从浏览器到后端服务会经过哪些环节？哪一段最容易出问题，怎么排查？',
    focus: '请求链路',
  },
  {
    id: 'be-t4',
    direction: 'backend',
    kind: 'technical',
    question: '事务的隔离级别有哪些？可重复读下幻读是怎么产生的，InnoDB 如何应对？',
    focus: '事务与隔离级别',
  },
  {
    id: 'be-t5',
    direction: 'backend',
    kind: 'technical',
    question: '使用消息队列时如何尽量避免丢消息？遇到重复消费，业务层会怎么做幂等？',
    focus: '消息队列可靠性',
  },
  {
    id: 'be-p1',
    direction: 'backend',
    kind: 'project',
    question: '挑一个你负责的后端项目，讲讲整体架构、核心模块，以及你具体负责了哪一部分。',
    focus: '项目架构与职责',
  },
  {
    id: 'be-p2',
    direction: 'backend',
    kind: 'project',
    question: '项目里最复杂的一次线上问题是什么？你如何定位、止损，最后怎么复盘？',
    focus: '线上问题处理',
  },
  {
    id: 'be-p3',
    direction: 'backend',
    kind: 'project',
    question: '你做过哪些性能优化？优化前后的指标是多少，具体怎么测出来的？',
    focus: '性能优化与度量',
  },
  {
    id: 'be-p4',
    direction: 'backend',
    kind: 'project',
    question: '如果这个项目的流量突然放大 10 倍，你会先从哪里下手排查和扩容？',
    focus: '容量与扩展性',
  },
  {
    id: 'be-b1',
    direction: 'backend',
    kind: 'behavioral',
    question: '讲一次你和同事在技术方案上有分歧的经历，最后是怎么达成一致的？',
    focus: '协作与说服',
  },
  {
    id: 'be-b2',
    direction: 'backend',
    kind: 'behavioral',
    question: '讲一次你主动承担了超出职责范围的事情，为什么做，结果如何？',
    focus: '主动性',
  },
  {
    id: 'be-b3',
    direction: 'backend',
    kind: 'behavioral',
    question: '讲一次项目延期或未达预期的经历，你做了哪些补救，事后改变了什么做法？',
    focus: '复盘与改进',
  },

  /* ---------------- 前端开发 ---------------- */
  {
    id: 'fe-t1',
    direction: 'frontend',
    kind: 'technical',
    question: '从输入 URL 到页面可交互，浏览器主要做了哪些事？哪些环节最影响首屏时间？',
    focus: '浏览器渲染链路',
  },
  {
    id: 'fe-t2',
    direction: 'frontend',
    kind: 'technical',
    question: '闭包为什么会造成内存泄漏？你在项目里如何发现并定位内存问题？',
    focus: '闭包与内存',
  },
  {
    id: 'fe-t3',
    direction: 'frontend',
    kind: 'technical',
    question: 'React 的渲染流程是怎样的？哪些情况会触发重渲染，你如何减少不必要的渲染？',
    focus: '框架渲染机制',
  },
  {
    id: 'fe-t4',
    direction: 'frontend',
    kind: 'technical',
    question: '浏览器强缓存和协商缓存怎么配合？发布新版本时如何避免用户继续用旧资源？',
    focus: '缓存与发布',
  },
  {
    id: 'fe-t5',
    direction: 'frontend',
    kind: 'technical',
    question: '跨域是怎么产生的？CORS 预检请求在什么情况下触发，服务端需要返回哪些头？',
    focus: '跨域与安全',
  },
  {
    id: 'fe-p1',
    direction: 'frontend',
    kind: 'project',
    question: '讲一个你主导的前端项目：技术选型、模块划分，以及你负责的关键部分。',
    focus: '项目设计与职责',
  },
  {
    id: 'fe-p2',
    direction: 'frontend',
    kind: 'project',
    question: '你做过哪些首屏或包体积优化？给出优化前后的指标和测量方法。',
    focus: '性能优化',
  },
  {
    id: 'fe-p3',
    direction: 'frontend',
    kind: 'project',
    question: '复杂表单或长列表你们是怎么实现的？遇到过哪些状态管理或性能问题？',
    focus: '复杂交互实现',
  },
  {
    id: 'fe-p4',
    direction: 'frontend',
    kind: 'project',
    question: '线上出现白屏或 JS 报错，你会怎么排查？平时做了哪些监控和兜底？',
    focus: '线上稳定性',
  },
  {
    id: 'fe-b1',
    direction: 'frontend',
    kind: 'behavioral',
    question: '讲一次你和设计或后端对实现方案有分歧的经历，最后怎么推进？',
    focus: '跨角色协作',
  },
  {
    id: 'fe-b2',
    direction: 'frontend',
    kind: 'behavioral',
    question: '讲一次你为了交付做的取舍，放弃了什么，换来了什么结果？',
    focus: '取舍与交付',
  },
  {
    id: 'fe-b3',
    direction: 'frontend',
    kind: 'behavioral',
    question: '讲一次你主动推动技术改进的经历，如何说服团队并落地？',
    focus: '推动改进',
  },

  /* ---------------- 数据分析 ---------------- */
  {
    id: 'da-t1',
    direction: 'data',
    kind: 'technical',
    question: 'JOIN、窗口函数、GROUP BY 分别适合什么场景？各举一个你实际用过的例子。',
    focus: 'SQL 核心能力',
  },
  {
    id: 'da-t2',
    direction: 'data',
    kind: 'technical',
    question: '发现报表指标异常，你会如何沿采集、口径、ETL、展示链路逐层排查？',
    focus: '数据链路排查',
  },
  {
    id: 'da-t3',
    direction: 'data',
    kind: 'technical',
    question: '如何设计一张用户行为明细表，在查询性能和存储成本之间取得平衡？',
    focus: '数据建模',
  },
  {
    id: 'da-t4',
    direction: 'data',
    kind: 'technical',
    question: '哪些样本偏差会让分析结论失真？你会用什么方法校验结论的可信度？',
    focus: '统计与偏差',
  },
  {
    id: 'da-t5',
    direction: 'data',
    kind: 'technical',
    question: 'A/B 实验如何设计？样本量、显著性和实验周期你会怎么确定？',
    focus: '实验设计',
  },
  {
    id: 'da-p1',
    direction: 'data',
    kind: 'project',
    question: '讲一个你做的数据分析项目：业务问题、口径、方法、结论和最终落地效果。',
    focus: '分析项目闭环',
  },
  {
    id: 'da-p2',
    direction: 'data',
    kind: 'project',
    question: '你搭过或维护过哪些数据表与指标？如何保证不同团队口径一致？',
    focus: '指标体系',
  },
  {
    id: 'da-p3',
    direction: 'data',
    kind: 'project',
    question: '你的分析结论被业务质疑过吗？你如何验证并让对方接受？',
    focus: '结论沟通',
  },
  {
    id: 'da-p4',
    direction: 'data',
    kind: 'project',
    question: '如果让你从 0 搭一个核心指标看板，你会怎么选指标、定维度和组织页面？',
    focus: '看板设计',
  },
  {
    id: 'da-b1',
    direction: 'data',
    kind: 'behavioral',
    question: '讲一次你的分析结论和业务直觉不一致的经历，最后怎么处理？',
    focus: '独立判断',
  },
  {
    id: 'da-b2',
    direction: 'data',
    kind: 'behavioral',
    question: '讲一次你为了拿到可靠数据，主动协调多个团队的经历。',
    focus: '跨团队协作',
  },
  {
    id: 'da-b3',
    direction: 'data',
    kind: 'behavioral',
    question: '讲一次你发现自己的分析出错并修正的过程，之后建立了什么检查习惯？',
    focus: '严谨与复盘',
  },

  /* ---------------- 产品经理 ---------------- */
  {
    id: 'pm-t1',
    direction: 'product',
    kind: 'technical',
    question: '如何判断一个需求是否值得做？你会看哪些信号，如何排出优先级？',
    focus: '需求判断',
  },
  {
    id: 'pm-t2',
    direction: 'product',
    kind: 'technical',
    question: '如果要为大学生设计一个求职工具，你会先做哪个功能，为什么？',
    focus: '产品设计',
  },
  {
    id: 'pm-t3',
    direction: 'product',
    kind: 'technical',
    question: '功能上线后核心指标没有上涨，你会如何拆解和定位问题？',
    focus: '数据驱动',
  },
  {
    id: 'pm-t4',
    direction: 'product',
    kind: 'technical',
    question: '一份可执行的需求文档必须包含哪些信息？你如何避免研发理解偏差？',
    focus: '需求文档',
  },
  {
    id: 'pm-t5',
    direction: 'product',
    kind: 'technical',
    question: '做竞品分析时你会看哪些维度？如何避免只抄功能、不解决真实问题？',
    focus: '竞品分析',
  },
  {
    id: 'pm-p1',
    direction: 'product',
    kind: 'project',
    question: '讲一个你从 0 到 1 推动的产品或功能：目标、关键取舍和最终结果。',
    focus: '从 0 到 1',
  },
  {
    id: 'pm-p2',
    direction: 'product',
    kind: 'project',
    question: '讲一次你砍需求或调整优先级的经历，判断依据是什么？',
    focus: '优先级取舍',
  },
  {
    id: 'pm-p3',
    direction: 'product',
    kind: 'project',
    question: '你和研发或设计意见不一致时怎么处理？举一个具体例子说明结果。',
    focus: '跨团队推进',
  },
  {
    id: 'pm-p4',
    direction: 'product',
    kind: 'project',
    question: '当数据和用户访谈结论冲突时，你更信哪个？会如何进一步验证？',
    focus: '用户研究',
  },
  {
    id: 'pm-b1',
    direction: 'product',
    kind: 'behavioral',
    question: '讲一次你判断失误的产品决策，后来怎么修正，学到了什么？',
    focus: '决策复盘',
  },
  {
    id: 'pm-b2',
    direction: 'product',
    kind: 'behavioral',
    question: '讲一次你在资源有限的情况下推动项目落地的经历。',
    focus: '资源协调',
  },
  {
    id: 'pm-b3',
    direction: 'product',
    kind: 'behavioral',
    question: '讲一次你主动深入用户、发现真实问题的经历，最后带来了什么改变？',
    focus: '用户洞察',
  },

  /* ---------------- 运营 ---------------- */
  {
    id: 'op-t1',
    direction: 'operations',
    kind: 'technical',
    question: '策划一次活动运营，你会如何拆目标、定节奏、配资源？',
    focus: '活动策划',
  },
  {
    id: 'op-t2',
    direction: 'operations',
    kind: 'technical',
    question: '常见的拉新、促活手段有哪些？你如何判断一个增长动作是否可持续？',
    focus: '用户增长',
  },
  {
    id: 'op-t3',
    direction: 'operations',
    kind: 'technical',
    question: '内容运营的选题机制怎么搭？你会用哪些指标评估内容效果？',
    focus: '内容运营',
  },
  {
    id: 'op-t4',
    direction: 'operations',
    kind: 'technical',
    question: '社群从 0 到 1，你会怎么做冷启动、定规则并维持活跃？',
    focus: '社群运营',
  },
  {
    id: 'op-t5',
    direction: 'operations',
    kind: 'technical',
    question: '活动数据不及预期时，你会先看哪些指标，如何调整后续动作？',
    focus: '数据复盘',
  },
  {
    id: 'op-p1',
    direction: 'operations',
    kind: 'project',
    question: '讲一次你负责的运营活动：目标、方案、执行过程和复盘结果。',
    focus: '活动项目',
  },
  {
    id: 'op-p2',
    direction: 'operations',
    kind: 'project',
    question: '你如何用数据指导运营动作？举一个具体例子说明前后变化。',
    focus: '数据驱动运营',
  },
  {
    id: 'op-p3',
    direction: 'operations',
    kind: 'project',
    question: '用户流失严重时，你会设计什么样的召回方案？如何评估效果？',
    focus: '用户召回',
  },
  {
    id: 'op-p4',
    direction: 'operations',
    kind: 'project',
    question: '预算有限时，你会如何在投放、内容和活动之间分配资源？',
    focus: '预算分配',
  },
  {
    id: 'op-b1',
    direction: 'operations',
    kind: 'behavioral',
    question: '讲一次活动执行中突发状况的经历，你如何应急并保证结果？',
    focus: '应急处理',
  },
  {
    id: 'op-b2',
    direction: 'operations',
    kind: 'behavioral',
    question: '讲一次你和合作方或外部渠道沟通受阻的经历，最后怎么解决？',
    focus: '外部协作',
  },
  {
    id: 'op-b3',
    direction: 'operations',
    kind: 'behavioral',
    question: '讲一次你从失败活动中总结出可复用方法的经历。',
    focus: '复盘沉淀',
  },
];

export function isDirection(v: unknown): v is DirectionKey {
  return typeof v === 'string' && DIRECTIONS.some((d) => d.key === v);
}

export function directionLabel(key?: string): string {
  return DIRECTIONS.find((d) => d.key === key)?.label || '通用';
}

/** 归一化题面，用于跨来源去重。 */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：“”‘’（）()《》【】,.!?;:'"\-—_/\\]/g, '');
}

/**
 * 从内置题集中选一道：按轮次题型过滤，优先避开本场已问题目和个人题库已有题目。
 * 使用 interviewId + questionIndex 做稳定偏移，同一场面试不会反复抽到同一题。
 */
export function pickCommonQuestion(opts: {
  direction: DirectionKey;
  roundKey: string;
  asked: string[];
  banked?: string[];
  offset: number;
}): CommonQuestion | null {
  const kinds: QuestionKind[] =
    opts.roundKey === 'behavioral' ? ['behavioral'] : ['technical', 'project'];
  const taken = new Set([...opts.asked, ...(opts.banked || [])].map(normalizeQuestion));
  const pool = COMMON_QUESTIONS.filter((q) => q.direction === opts.direction && kinds.includes(q.kind));
  if (!pool.length) return null;
  const fresh = pool.filter((q) => !taken.has(normalizeQuestion(q.question)));
  const source = fresh.length ? fresh : pool;
  return source[Math.abs(opts.offset) % source.length];
}
