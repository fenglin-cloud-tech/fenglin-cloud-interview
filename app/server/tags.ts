import { db, parseJson } from './db.js';
import type { FeedbackResult } from './schemas.js';

/**
 * DATA-04：从单题反馈的 issues 与三维分数派生薄弱标签。
 * 标签写入 interview_turn.tags_json，可被报告聚合，也可回填旧数据。
 */
export function deriveTags(feedback: FeedbackResult | null, score: number | null): string[] {
  const tags = new Set<string>();
  if (score !== null && score < 70) tags.add('低分题');
  for (const issue of feedback?.issues || []) {
    if (/(STAR|情境|任务|行动|结果|层次|结构)/.test(issue)) tags.add('结构');
    if (/(数据|数字|规模|量化|指标)/.test(issue)) tags.add('量化');
    if (/(个人贡献|多用「我们」|我).*贡献/.test(issue)) tags.add('个人贡献');
    if (/(口癖|啰嗦|超过|字数|重点)/.test(issue)) tags.add('表达');
    if (/(跑题|答非所问|切题)/.test(issue)) tags.add('切题');
  }
  const s = feedback?.scores;
  if (s) {
    if (s.structure < 70) tags.add('结构');
    if (s.content < 70) tags.add('内容');
    if (s.expression < 70) tags.add('表达');
  }
  return [...tags].slice(0, 6);
}

/** 启动时回填一次旧数据：有反馈但还没有标签的作答记录。 */
export function backfillTurnTags(): void {
  const rows = db
    .prepare('SELECT id, feedback_json, score FROM interview_turn WHERE tags_json IS NULL AND feedback_json IS NOT NULL')
    .all() as { id: number; feedback_json: string; score: number | null }[];
  if (!rows.length) return;
  const update = db.prepare('UPDATE interview_turn SET tags_json = ? WHERE id = ?');
  for (const row of rows) {
    const feedback = parseJson<FeedbackResult | null>(row.feedback_json, null);
    update.run(JSON.stringify(deriveTags(feedback, row.score)), row.id);
  }
}
