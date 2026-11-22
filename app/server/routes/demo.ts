import { Router } from 'express';
import { db, getSetting, nowIso, setSetting } from '../db.js';
import { HttpError } from '../util.js';

/**
 * 示例数据：一次性写入一份完整、可体验的演示档案。
 *
 * 标记方式：所有写入的行都会在 demo_seed 表登记 (kind, ref_id)，
 * 清空时只按这份登记逐条删除；绝不使用「全表删除」，
 * 因此用户自己创建的记录不会被误删。
 *
 * 写入方式：服务层直接落库（与路由写入同一套表结构与约束），
 * 原因是示例需要确定性的分数、逐题反馈和报告，走真实 LLM 既慢又不可复现。
 */
export const demoRouter = Router();

type Kind = 'profile' | 'job' | 'resume' | 'analysis' | 'interview' | 'review' | 'bank' | 'application';

const KIND_LABEL: Record<Kind, string> = {
  profile: '档案',
  job: '岗位',
  resume: '简历',
  analysis: 'JD 匹配',
  interview: '面试',
  review: '复盘',
  bank: '题库',
  application: '投递',
};

function idsOf(kind: Kind): number[] {
  return (db.prepare('SELECT ref_id FROM demo_seed WHERE kind = ?').all(kind) as { ref_id: number }[]).map((r) =>
    Number(r.ref_id),
  );
}

function mark(kind: Kind, id: number, at: string): void {
  db.prepare('INSERT OR REPLACE INTO demo_seed (kind, ref_id, created_at) VALUES (?, ?, ?)').run(kind, id, at);
}

function delByIds(table: string, column: string, ids: number[]): void {
  if (!ids.length) return;
  db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(', ')})`).run(...ids);
}

export function clearDemo(): number {
  const profiles = idsOf('profile');
  const jobs = idsOf('job');
  const resumes = idsOf('resume');
  const analyses = idsOf('analysis');
  const interviews = idsOf('interview');
  const reviews = idsOf('review');
  const banks = idsOf('bank');
  const applications = idsOf('application');

  if (applications.length) {
    db.prepare(
      `DELETE FROM application_stage_log WHERE application_id IN (${applications.map(() => '?').join(', ')})`,
    ).run(...applications);
  }
  delByIds('application', 'id', applications);
  delByIds('interview_turn', 'interview_id', interviews);
  delByIds('interview', 'id', interviews);
  if (reviews.length) {
    db.prepare(`DELETE FROM review_task WHERE kind = 'review' AND ref_id IN (${reviews.map(() => '?').join(', ')})`).run(
      ...reviews,
    );
  }
  delByIds('review', 'id', reviews);
  if (banks.length) {
    db.prepare(`DELETE FROM review_task WHERE kind = 'bank' AND ref_id IN (${banks.map(() => '?').join(', ')})`).run(
      ...banks,
    );
  }
  delByIds('bank_item', 'id', banks);
  delByIds('jd_analysis', 'id', analyses);
  delByIds('resume', 'id', resumes);
  delByIds('job', 'id', jobs);
  db.prepare('DELETE FROM demo_seed').run();

  // 示例档案只在原本为空时写入，清空时逐字还原，不覆盖用户填写的信息。
  if (profiles.length) {
    const prev = JSON.parse(getSetting('demo_prev_profile') || '{}') as Record<string, string>;
    db.prepare('UPDATE profile SET nickname = ?, school = ?, major = ?, grade = ?, updated_at = ? WHERE id = 1').run(
      prev.nickname || '',
      prev.school || '',
      prev.major || '',
      prev.grade || '',
      nowIso(),
    );
    setSetting('demo_prev_profile', '');
  }

  // 如果当前上下文指向了被清掉的示例记录，重置为空，避免页面指向不存在的 ID。
  const activeResume = Number(getSetting('active_resume_id') || 0);
  if (activeResume && resumes.includes(activeResume)) setSetting('active_resume_id', '');
  const activeJob = Number(getSetting('active_job_id') || 0);
  if (activeJob && jobs.includes(activeJob)) setSetting('active_job_id', '');

  return (
    profiles.length +
    jobs.length +
    resumes.length +
    analyses.length +
    interviews.length +
    reviews.length +
    banks.length +
    applications.length
  );
}

export function demoStatus() {
  const counts = {} as Record<Kind, number>;
  (Object.keys(KIND_LABEL) as Kind[]).forEach((k) => {
    counts[k] = (db.prepare('SELECT COUNT(*) AS n FROM demo_seed WHERE kind = ?').get(k) as { n: number }).n;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const first = db.prepare('SELECT MIN(created_at) AS at FROM demo_seed').get() as { at: string | null };
  return { present: total > 0, total, counts, loadedAt: first.at };
}

const JD = `【岗位职责】
1. 负责后端业务服务的设计与开发，保证接口稳定与可观测；
2. 参与缓存、消息队列等中间件的使用与治理；
3. 与产品、前端协作交付需求，并沉淀技术文档。

【任职要求】
1. 熟悉 Java 基础、集合与并发，了解 JVM 内存结构；
2. 熟悉 MySQL 索引与事务，能独立分析慢查询；
3. 了解 Redis 常见问题（穿透、击穿、雪崩）及应对；
4. 有项目排查经验，能讲清个人贡献与数据来源；
5. 表达清晰，能在追问下说明取舍。`;

const RESUME = `# 示例-林知远

## 教育背景
- 示例-云海大学 · 计算机科学与技术 · 本科 · 2027 届
- 主修课程：数据结构、操作系统、数据库原理、计算机网络

## 项目经历
### 示例-校园二手交易平台（后端负责人）
- 使用 Spring Boot + MySQL + Redis 搭商品与订单服务，注册用户约 1200；
- 商品详情接口引入空值缓存与布隆过滤器处理穿透，平均响应从 210ms 降到 60ms；
- 通过慢查询日志定位订单列表 SQL，补联合索引后 P95 从 1.2s 降到 320ms；
- 负责压测脚本与上线检查，前端联调由队友完成。

## 技能
- Java / Spring Boot / MySQL / Redis / Git
- 了解 JVM 内存结构与常见 GC 调优

> 本简历为演示数据，姓名、学校与项目均为虚构，仅用于体验产品流程。`;

interface TurnSeed {
  round: 'intro' | 'professional' | 'behavioral' | 'reverse';
  question: string;
  focus: string;
  answer: string;
  score: number;
  dims: { structure: number; content: number; expression: number };
  summary: string;
  strengths: string[];
  issues: string[];
  improved: string;
}

interface InterviewSeed {
  daysAgo: number;
  overall: number;
  rounds: { round: string; score: number; comment: string }[];
  weaknesses: string[];
  reviewPoints: string[];
  summary: string;
  turns: TurnSeed[];
}

const INTERVIEWS: InterviewSeed[] = [
  {
    daysAgo: 12,
    overall: 58,
    rounds: [
      { round: '自我介绍', score: 62, comment: '经历完整，但亮点埋在最后，开场 30 秒没有给结论。' },
      { round: '专业能力', score: 54, comment: '缓存穿透说清了，击穿和雪崩混在一起，也缺少数据支撑。' },
      { round: '行为面试', score: 57, comment: '项目贡献偏团队视角，个人动作不够具体。' },
      { round: '反问环节', score: 60, comment: '问题偏泛，可以围绕岗位职责追问团队协作方式。' },
    ],
    weaknesses: ['缓存三类问题边界不清', '项目数据来源讲不清', '个人贡献描述模糊'],
    reviewPoints: ['用「是否存在 / 是否热点 / 是否同时过期」区分缓存三兄弟', '为每个项目数字准备来源'],
    summary: '示例-第一次模拟：能把项目讲完整，但追问到数据来源和缓存细节时开始含糊，建议先把三个核心数字的来源补齐。',
    turns: [
      {
        round: 'intro',
        question: '示例-请用一分钟介绍你自己，重点讲和这个岗位最相关的一段经历。',
        focus: '开场结论与岗位相关性',
        answer: '我是林知远，计算机专业大三。做过一个校园二手交易平台，主要负责后端，用了 Spring Boot、MySQL 和 Redis，也做过一些接口优化。平时喜欢研究后端性能相关的东西。',
        score: 62,
        dims: { structure: 60, content: 64, expression: 62 },
        summary: '信息完整，但开场没有先给「我和后端岗位的匹配点」，亮点留在了最后。',
        strengths: ['技术栈与岗位相关', '项目描述真实'],
        issues: ['开场缺少结论', '没有量化结果'],
        improved: '先用一句话给结论：我有 8 个月 Java 后端项目经验，做过一次把接口 P95 从 1.2s 降到 320ms 的优化；再用两句话展开项目和数据。',
      },
      {
        round: 'professional',
        question: '示例-商品详情接口变慢，你会怎么定位？',
        focus: '排查路径与数据意识',
        answer: '我会先看监控，确认是数据库慢还是应用慢。然后看慢查询日志，可能是索引没命中。缓存的话，穿透可以用空值缓存，击穿和雪崩也是缓存的问题，加过期时间就行。',
        score: 54,
        dims: { structure: 50, content: 56, expression: 56 },
        summary: '排查顺序基本对，但把击穿和雪崩都归为「加过期时间」，概念边界错误。',
        strengths: ['先监控后日志的顺序合理'],
        issues: ['击穿 / 雪崩概念混淆', '没有提到压测或数据验证'],
        improved: '先明确三类问题：穿透是查不存在的数据（空值缓存 + 布隆过滤器）；击穿是热点 key 过期（互斥锁 / 逻辑过期）；雪崩是大量 key 同时失效（过期时间加随机 + 多级缓存）。再用慢查询日志和压测数据验证效果。',
      },
      {
        round: 'behavioral',
        question: '示例-项目里最难的一次协作冲突是什么？你做了什么？',
        focus: '个人动作与反思',
        answer: '当时和前端联调接口字段对不上，大家有点着急。后来我们一起对了一遍文档，把字段改好了，项目也按时上线了。',
        score: 57,
        dims: { structure: 55, content: 58, expression: 58 },
        summary: '冲突场景真实，但「我做了什么」被「我们一起」掩盖了。',
        strengths: ['没有甩锅，强调协作'],
        issues: ['个人动作不具体', '缺少结果与复盘'],
        improved: '按 STAR 说：我负责整理接口契约，拉前端做了一次 30 分钟的字段对齐，把变更写进文档并加了示例；上线后同类问题没有再出现。',
      },
      {
        round: 'reverse',
        question: '示例-你有什么想问我们的？',
        focus: '岗位理解与提问质量',
        answer: '想问一下团队平时怎么做代码评审？新人一般多久能独立负责一个模块？',
        score: 60,
        dims: { structure: 60, content: 62, expression: 58 },
        summary: '问题不离谱，但偏「新人视角」，没有体现对岗位职责的思考。',
        strengths: ['关注协作与成长'],
        issues: ['问题可以更贴近岗位职责'],
        improved: '可以问：这个岗位目前最需要解决的稳定性问题是什么？团队在缓存治理上有没有统一的规范？',
      },
    ],
  },
  {
    daysAgo: 6,
    overall: 71,
    rounds: [
      { round: '自我介绍', score: 68, comment: '开场有了结论，但岗位匹配点还可以再具体。' },
      { round: '专业能力', score: 72, comment: '缓存三类问题区分正确，数据来源说得清楚。' },
      { round: '行为面试', score: 70, comment: '个人动作更清晰，结果还可以再量化。' },
      { round: '反问环节', score: 74, comment: '问题开始贴近岗位，追问有深度。' },
    ],
    weaknesses: ['自我介绍还可以更贴岗位', '行为题结果量化不足'],
    reviewPoints: ['准备 2 个可量化的协作结果', '把岗位 JD 关键词嵌进自我介绍'],
    summary: '示例-第二次模拟：缓存问题已经能分层回答，项目数字有来源；下一步补行为题的结果量化。',
    turns: [
      {
        round: 'intro',
        question: '示例-请用一分钟介绍你自己，重点讲和这个岗位最相关的一段经历。',
        focus: '开场结论与岗位相关性',
        answer: '我有 8 个月 Java 后端项目经验，最相关的是校园二手交易平台：我负责商品与订单服务，做过一次接口优化，把 P95 从 1.2 秒降到 320 毫秒。技术上主要用 Spring Boot、MySQL 和 Redis。',
        score: 68,
        dims: { structure: 66, content: 70, expression: 68 },
        summary: '开场先给结论，数字也有了，但和岗位 JD 的对应关系还可以再点一句。',
        strengths: ['开场有结论', '结果有数字'],
        issues: ['岗位关键词呼应不足'],
        improved: '在结尾补一句：这段经历对应岗位要求里的慢查询分析和 Redis 治理，我也在继续补消息队列。',
      },
      {
        round: 'professional',
        question: '示例-Redis 缓存穿透、击穿、雪崩分别怎么处理？',
        focus: '概念边界与方案取舍',
        answer: '穿透是查不存在的数据，用空值缓存加布隆过滤器；击穿是热点 key 过期，用互斥锁或者逻辑过期；雪崩是大量 key 同时过期，给过期时间加随机值，再做多级缓存。我们项目里主要做了空值缓存和随机过期，穿透请求的数据库 QPS 从 300 降到 20 左右。',
        score: 72,
        dims: { structure: 70, content: 74, expression: 72 },
        summary: '三类问题区分正确，也给了项目数据，取舍还能再讲深一点。',
        strengths: ['概念边界清晰', '有真实数据'],
        issues: ['互斥锁与逻辑过期的取舍没展开'],
        improved: '补一句取舍：互斥锁实现简单但会增加等待，逻辑过期一致性更好但要处理异步重建，我们按热点程度选。',
      },
      {
        round: 'behavioral',
        question: '示例-讲一次你推动别人改变做法的经历。',
        focus: '影响力与结果',
        answer: '我发现大家提交前不跑测试，就主动加了一个提交前检查清单，在群里同步了两次，后来大家都开始跑测试了，线上问题少了一些。',
        score: 70,
        dims: { structure: 68, content: 70, expression: 72 },
        summary: '做法具体，但「少了一些」缺少可验证的结果。',
        strengths: ['有主动推动', '有落地动作'],
        issues: ['结果没有量化'],
        improved: '补充：上线后两周内因低级错误回滚的次数从 3 次降到 0 次，检查清单也写进了项目文档。',
      },
      {
        round: 'reverse',
        question: '示例-你有什么想问我们的？',
        focus: '岗位理解与提问质量',
        answer: '想了解团队目前最头疼的稳定性问题是什么？如果我入职，前三个月最希望我先把哪块接起来？',
        score: 74,
        dims: { structure: 72, content: 76, expression: 74 },
        summary: '问题贴近岗位职责，能引出团队真实信息。',
        strengths: ['问题具体', '关注上手路径'],
        issues: ['可以再追问团队的技术规范'],
        improved: '可以加一句：团队在缓存和慢查询治理上有没有统一的规范或工具？',
      },
    ],
  },
  {
    daysAgo: 2,
    overall: 82,
    rounds: [
      { round: '自我介绍', score: 80, comment: '结论、数据、岗位匹配点齐全。' },
      { round: '专业能力', score: 84, comment: '三类缓存问题分层清楚，能讲取舍和验证方式。' },
      { round: '行为面试', score: 81, comment: '个人动作与结果都具体，反思到位。' },
      { round: '反问环节', score: 83, comment: '问题有针对性，能体现对团队的理解。' },
    ],
    weaknesses: ['消息队列只有概念，没有项目实践', '高并发场景经验仍偏少'],
    reviewPoints: ['补一个消息队列的小项目或压测实验', '准备高并发下的降级与限流方案'],
    summary: '示例-第三次模拟：表达结构稳定，技术追问能落到取舍和数据；下一步补消息队列与高并发实践。',
    turns: [
      {
        round: 'intro',
        question: '示例-请用一分钟介绍你自己，重点讲和这个岗位最相关的一段经历。',
        focus: '开场结论与岗位相关性',
        answer: '我是林知远，方向是 Java 后端，和这个岗位最相关的是校园二手交易平台：我负责商品与订单服务，做过缓存和索引优化，商品详情 P95 从 1.2 秒降到 320 毫秒。这段经历正好对应岗位里的慢查询分析和 Redis 治理，消息队列我目前是理解原理，还在补实践。',
        score: 80,
        dims: { structure: 80, content: 82, expression: 78 },
        summary: '结论、数据、岗位匹配和短板都交代清楚，开场很稳。',
        strengths: ['结构完整', '主动交代短板'],
        issues: ['语速偏快'],
        improved: '保持结构，开头和结尾各放慢半拍，给面试官留出追问的接口。',
      },
      {
        round: 'professional',
        question: '示例-如果缓存和数据库数据不一致，你会怎么处理？',
        focus: '一致性与取舍',
        answer: '先看业务能接受多长的不一致。常见做法是更新数据库后删除缓存，读请求回填；如果要求更强，可以用延迟双删或者订阅 binlog 异步删缓存。我们项目对商品详情接受秒级不一致，所以用删除缓存加短 TTL，回填时加互斥锁防止并发穿透。',
        score: 84,
        dims: { structure: 82, content: 86, expression: 84 },
        summary: '先问业务容忍度，再给方案和项目取舍，回答层次很好。',
        strengths: ['先明确约束', '方案有取舍'],
        issues: ['binlog 方案可以补一句成本'],
        improved: '补一句：binlog 方案一致性更好，但要多维护一个消费者，团队规模小时成本偏高。',
      },
      {
        round: 'behavioral',
        question: '示例-讲一次你推动别人改变做法的经历。',
        focus: '影响力与结果',
        answer: '我发现大家提交前不跑测试，就整理了一份提交前检查清单，先在小组里试了两周，把因低级错误回滚的次数从 3 次降到 0，然后在周会上分享，最后写进了项目文档，现在新同学也会照着做。',
        score: 81,
        dims: { structure: 80, content: 82, expression: 82 },
        summary: '有试点、有数据、有推广，影响力链条完整。',
        strengths: ['先试点再推广', '结果可验证'],
        issues: ['可以补充遇到的阻力'],
        improved: '补一句阻力：一开始有人觉得麻烦，我用两次真实回滚案例说明成本，才推动下去。',
      },
      {
        round: 'reverse',
        question: '示例-你有什么想问我们的？',
        focus: '岗位理解与提问质量',
        answer: '这个岗位目前最需要解决的稳定性问题是什么？团队在缓存和慢查询治理上有没有统一规范？另外，如果我入职，前三个月您希望我交付什么结果？',
        score: 83,
        dims: { structure: 82, content: 84, expression: 82 },
        summary: '问题直接指向岗位痛点与交付预期，质量高。',
        strengths: ['问题有针对性', '关注交付结果'],
        issues: ['三个问题略多，可以按优先级取舍'],
        improved: '保留前两个，第三个留到面试官回答后再追问，避免一次抛太多问题。',
      },
    ],
  },
];

const REVIEWS = [
  {
    daysAgo: 11,
    question: '示例-复盘：缓存穿透、击穿、雪崩又答混了',
    answer: '穿透是查不存在的数据；击穿是热点 key 过期；雪崩是大量 key 同时过期。',
    performance: '只答对了穿透，击穿和雪崩讲反了，面试官追问了两次。',
    improvement: '用「是否存在 / 是否热点 / 是否同时过期」三个判断分开记，每个配一个项目里的处理方案，下次先给结论再展开。',
    rating: 2,
  },
  {
    daysAgo: 5,
    question: '示例-复盘：项目数字的来源讲不清',
    answer: '接口从 210ms 降到 60ms。',
    performance: '被问到数据怎么来的，只说了「压测过」，没有说清压测方式和样本量。',
    improvement: '给每个数字补一行来源：压测脚本、样本量、统计口径（P95 / 平均值），回答时主动交代。',
    rating: 3,
  },
  {
    daysAgo: 2,
    question: '示例-复盘：自我介绍开场没有结论',
    answer: '我是林知远，计算机专业大三，做过校园二手交易平台……',
    performance: '开场铺垫太长，面试官提醒「直接说最相关的经历」。',
    improvement: '固定开场模板：一句结论 + 一段最相关经历 + 一个可验证数字 + 一句岗位匹配。',
    rating: 4,
  },
];

const BANK = [
  { question: '示例-Redis 缓存穿透、击穿、雪崩的区别与应对？', category: '专业', weak: 1, score: 45, ask: 2, daysAgo: 1 },
  { question: '示例-商品详情接口变慢，你会如何定位慢查询？', category: '专业', weak: 1, score: 52, ask: 1, daysAgo: 1 },
  { question: '示例-讲一个你个人推动改进的例子', category: '行为', weak: 0, score: 68, ask: 1, daysAgo: 2 },
  { question: '示例-团队里出现分歧时你怎么处理？', category: '行为', weak: 1, score: 55, ask: 1, daysAgo: 3 },
  { question: '示例-你最大的缺点是什么，正在怎么改进？', category: '综合', weak: 1, score: 60, ask: 1, daysAgo: 4 },
];

demoRouter.get('/demo', (_req, res) => {
  res.json(demoStatus());
});

demoRouter.post('/demo/load', (_req, res) => {
  try {
    clearDemo();
    const now = new Date();
    const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
    const stamp = nowIso();

    // 档案只有在本机完全没填时才写入示例值，清空时会还原为空。
    const prof = db.prepare('SELECT nickname, school, major, grade FROM profile WHERE id = 1').get() as
      | { nickname: string; school: string; major: string; grade: string }
      | undefined;
    const profileEmpty =
      !prof || (!prof.nickname.trim() && !prof.school.trim() && !prof.major.trim() && !prof.grade.trim());
    if (profileEmpty) {
      setSetting('demo_prev_profile', JSON.stringify(prof || {}));
      db.prepare('UPDATE profile SET nickname = ?, school = ?, major = ?, grade = ?, updated_at = ? WHERE id = 1').run(
        '示例-林知远',
        '示例-云海大学',
        '计算机科学与技术',
        '2027 届',
        stamp,
      );
      mark('profile', 1, stamp);
    }

    const job = db
      .prepare('INSERT INTO job (title, company, jd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('示例-后端开发工程师（Java）', '示例-云海网络', JD, iso(14), stamp);
    const jobId = job.lastInsertRowid;
    mark('job', jobId, stamp);

    const resume = db
      .prepare('INSERT INTO resume (title, content, job_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('示例-林知远 · 后端实习简历', RESUME, jobId, 'demo', iso(13), stamp);
    const resumeId = resume.lastInsertRowid;
    mark('resume', resumeId, stamp);

    const match = {
      score: 68,
      verdict: '示例-基础技术栈与岗位匹配，项目里有缓存与慢查询的真实数据；缺消息队列和高并发场景的直接证据。',
      covered: [
        { requirement: 'Java 基础与并发', status: 'covered', evidence: '课程与项目均使用 Java / Spring Boot，能说清集合与线程池的基本用法。' },
        { requirement: 'MySQL 索引与事务', status: 'covered', evidence: '用慢查询日志定位订单列表 SQL，补联合索引后 P95 从 1.2s 降到 320ms。' },
        { requirement: 'Redis 常见问题', status: 'covered', evidence: '商品详情引入空值缓存与布隆过滤器，穿透请求数据库 QPS 从 300 降到 20。' },
        { requirement: '消息队列', status: 'missing', evidence: '简历中没有 MQ 的使用记录，只有概念性了解。' },
        { requirement: '高并发场景', status: 'partial', evidence: '有压测脚本与接口优化，但没有大流量线上场景。' },
      ],
      missingKeywords: ['消息队列', '高并发', '链路追踪'],
      actions: [
        '补一个消息队列的小实验：订单创建后异步通知，说明重试与幂等。',
        '把压测样本量、统计口径写进简历，避免追问时说不清。',
        '准备一个高并发下的限流 / 降级方案，即使没有线上实践也要讲清取舍。',
      ],
    };
    const analysis = db
      .prepare('INSERT INTO jd_analysis (resume_id, job_id, jd, score, result_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(resumeId, jobId, JD, match.score, JSON.stringify(match), 'demo', iso(12));
    const analysisId = analysis.lastInsertRowid;
    mark('analysis', analysisId, stamp);

    const interviewIds: number[] = [];
    INTERVIEWS.forEach((iv) => {
      const startedAt = iso(iv.daysAgo + 0.02);
      const endedAt = iso(iv.daysAgo);
      const report = {
        overallScore: iv.overall,
        roundScores: iv.rounds,
        weaknesses: iv.weaknesses,
        reviewPoints: iv.reviewPoints,
        summary: iv.summary,
      };
      const row = db
        .prepare(
          `INSERT INTO interview (resume_id, job_id, mode, status, round_key, question_index, seed_json, started_at, ended_at, report_json, overall_score)
           VALUES (?, ?, 'resume', 'finished', ?, ?, NULL, ?, ?, ?, ?)`,
        )
        .run(resumeId, jobId, iv.turns[iv.turns.length - 1].round, iv.turns.length, startedAt, endedAt, JSON.stringify(report), iv.overall);
      const interviewId = row.lastInsertRowid;
      interviewIds.push(interviewId);
      mark('interview', interviewId, stamp);

      iv.turns.forEach((t, i) => {
        const feedback = {
          scores: t.dims,
          summary: t.summary,
          strengths: t.strengths,
          issues: t.issues,
          improvedAnswer: t.improved,
          followup: null,
        };
        db.prepare(
          `INSERT INTO interview_turn (interview_id, round_key, seq, depth, parent_id, question, focus, answer, feedback_json, score, source, created_at, answered_at)
           VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, 'demo', ?, ?)`,
        ).run(
          interviewId,
          t.round,
          i + 1,
          t.question,
          t.focus,
          t.answer,
          JSON.stringify(feedback),
          t.score,
          startedAt,
          iso(iv.daysAgo + 0.02 - 0.004 * (i + 1)),
        );
      });
    });

    const reviewIds: number[] = [];
    REVIEWS.forEach((r) => {
      const row = db
        .prepare(
          'INSERT INTO review (interview_id, bank_id, job_id, question, my_answer, performance, improvement, rating, tags, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(jobId, r.question, r.answer, r.performance, r.improvement, r.rating, '示例-复盘,缓存,表达', iso(r.daysAgo));
      reviewIds.push(row.lastInsertRowid);
      mark('review', row.lastInsertRowid, stamp);
    });

    // 投递追踪示例：覆盖不同阶段，并把面试 / 复盘挂到具体投递上。
    const APPLICATIONS = [
      {
        company: '示例-云海网络',
        title: '后端开发工程师（Java）',
        jobId,
        appliedOn: new Date(now.getTime() - 21 * 86400000).toISOString().slice(0, 10),
        stage: 'interview2',
        note: '示例-一面反馈基础不错，二面重点准备缓存与项目数据来源。',
        links: interviewIds.slice(0, 2).map((id) => ({ kind: 'interview' as const, id })),
      },
      {
        company: '示例-星河数据',
        title: '数据开发实习生',
        jobId: null,
        appliedOn: new Date(now.getTime() - 9 * 86400000).toISOString().slice(0, 10),
        stage: 'written',
        note: '示例-已完成笔试，等待结果；岗位偏 SQL 与数据链路。',
        links: reviewIds.slice(0, 1).map((id) => ({ kind: 'review' as const, id })),
      },
      {
        company: '示例-远山科技',
        title: 'Java 后端开发',
        jobId: null,
        appliedOn: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10),
        stage: 'rejected',
        note: '示例-简历未通过初筛，补一段消息队列实践后再投。',
        links: [],
      },
    ];
    APPLICATIONS.forEach((a) => {
      const row = db
        .prepare(
          'INSERT INTO application (company, title, job_id, applied_on, stage, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(a.company, a.title, a.jobId, a.appliedOn, a.stage, a.note, iso(8), stamp);
      mark('application', row.lastInsertRowid, stamp);
      a.links.forEach((l) => {
        db.prepare(
          'INSERT OR IGNORE INTO application_link (application_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?)',
        ).run(row.lastInsertRowid, l.kind, l.id, stamp);
      });
    });

    BANK.forEach((b) => {
      const row = db
        .prepare(
          `INSERT INTO bank_item (question, category, job_id, source, weak, ask_count, last_score, last_practiced_at, created_at)
           VALUES (?, ?, ?, 'demo', ?, ?, ?, ?, ?)`,
        )
        .run(b.question, b.category, jobId, b.weak, b.ask, b.score, iso(b.daysAgo), iso(b.daysAgo));
      mark('bank', row.lastInsertRowid, stamp);
    });

    res.json({ ...demoStatus(), loaded: true });
  } catch (err) {
    clearDemo();
    throw new HttpError(500, `示例数据载入失败：${err instanceof Error ? err.message : '未知错误'}`);
  }
});

demoRouter.post('/demo/clear', (_req, res) => {
  const removed = clearDemo();
  res.json({ ...demoStatus(), removed });
});
