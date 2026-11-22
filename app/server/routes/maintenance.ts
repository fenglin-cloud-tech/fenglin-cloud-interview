import { Router } from 'express';
import { db } from '../db.js';
import { HttpError, str } from '../util.js';

/**
 * FUNC-12：按模块清理数据。
 *
 * 只清理业务模块，不动岗位、简历、档案与经历素材；
 * 前端必须先导出备份并二次确认，这里再要求 confirm=CLEAR，
 * 防止误触或直接构造请求清空数据。
 */
export const maintenanceRouter = Router();

type ModuleKey = 'interviews' | 'reviews' | 'bank' | 'applications';

function count(table: string, where = ''): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number };
  return row.n;
}

maintenanceRouter.get('/data/counts', (_req, res) => {
  res.json({
    interviews: count('interview'),
    reviews: count('review'),
    bankItems: count('bank_item'),
    applications: count('application'),
    turns: count('interview_turn'),
  });
});

maintenanceRouter.post('/data/clear', (req, res) => {
  const moduleKey = str(req.body?.module, 20) as ModuleKey;
  const confirm = str(req.body?.confirm, 20);
  if (!['interviews', 'reviews', 'bank', 'applications'].includes(moduleKey)) {
    throw new HttpError(400, '不支持的模块');
  }
  if (confirm !== 'CLEAR') throw new HttpError(400, '缺少清理确认，未删除任何数据');

  const deleted: Record<string, number> = {};
  db.exec('BEGIN');
  try {
    if (moduleKey === 'interviews') {
      deleted.turns = count('interview_turn');
      deleted.interviews = count('interview');
      db.prepare("DELETE FROM application_link WHERE kind = 'interview'").run();
      db.prepare('DELETE FROM interview_turn').run();
      db.prepare('DELETE FROM interview').run();
    } else if (moduleKey === 'reviews') {
      deleted.reviews = count('review');
      deleted.reviewTasks = count('review_task', "WHERE kind = 'review'");
      db.prepare("DELETE FROM application_link WHERE kind = 'review'").run();
      db.prepare("DELETE FROM review_task WHERE kind = 'review'").run();
      db.prepare('DELETE FROM review').run();
    } else if (moduleKey === 'bank') {
      deleted.bankItems = count('bank_item');
      deleted.reviewTasks = count('review_task', "WHERE kind = 'bank'");
      db.prepare("DELETE FROM review_task WHERE kind = 'bank'").run();
      db.prepare('DELETE FROM bank_item').run();
    } else {
      deleted.applications = count('application');
      deleted.applicationLinks = count(
        'application_link',
        'WHERE application_id IN (SELECT id FROM application)',
      );
      deleted.applicationStageLog = count(
        'application_stage_log',
        'WHERE application_id IN (SELECT id FROM application)',
      );
      db.prepare('DELETE FROM application_link WHERE application_id IN (SELECT id FROM application)').run();
      db.prepare('DELETE FROM application_stage_log WHERE application_id IN (SELECT id FROM application)').run();
      db.prepare('DELETE FROM application').run();
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  res.json({ ok: true, module: moduleKey, deleted });
});
