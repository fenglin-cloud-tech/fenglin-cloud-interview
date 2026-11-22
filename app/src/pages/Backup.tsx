import { useRef, useState } from 'react';
import { api } from '../api';
import { Button, Callout, Card, PageHeader } from '../components/ui';
import { useApp } from '../state';

const COUNT_LABEL: Record<string, string> = {
  profiles: '本地档案',
  jobs: '岗位与 JD',
  resumes: '简历',
  jdAnalyses: 'JD 匹配记录',
  interviews: '面试',
  turns: '逐题作答与反馈',
  reviews: '复盘记录',
  bankItems: '个人题库',
  reviewTasks: '复习排程',
  applications: '投递记录',
  applicationLinks: '投递关联',
};

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

type Preview = Extract<Awaited<ReturnType<typeof api.previewBackup>>, { ok: true }>;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function Backup() {
  const { refresh, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ filename: string; bytes: number } | null>(null);
  const [filename, setFilename] = useState('');
  const [parsed, setParsed] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [mode, setMode] = useState<'merge' | 'overwrite' | null>(null);
  const [overwriteBackedUp, setOverwriteBackedUp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ mode: string; after: Record<string, number> } | null>(null);

  const doExport = async (): Promise<boolean> => {
    setExporting(true);
    setExported(null);
    try {
      const file = await api.exportBackup();
      const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExported({ filename: file.filename, bytes: file.bytes });
      toast('备份文件已生成并开始下载', 'ok');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : '导出失败', 'err');
      return false;
    } finally {
      setExporting(false);
    }
  };

  const resetImport = () => {
    setParsed(null);
    setPreview(null);
    setPreviewError('');
    setMode(null);
    setOverwriteBackedUp(false);
    setDone(null);
    setFilename('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickFile = async (file: File) => {
    resetImport();
    setFilename(file.name);
    if (file.size > MAX_IMPORT_BYTES) {
      setPreviewError(`文件大小 ${formatSize(file.size)}，超过 8 MB 上限，已拒绝读取。`);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setPreviewError('文件不是合法 JSON，可能已损坏；未写入任何数据。');
      return;
    }
    setParsed(raw);
    try {
      const p = await api.previewBackup(raw);
      if (!p.ok) {
        setPreviewError(p.message);
        return;
      }
      setPreview(p);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : '校验失败');
    }
  };

  const doImport = async () => {
    if (!parsed || !preview) return;
    if (!preview.emptyTarget && !mode) {
      toast('请先选择合并还是覆盖', 'err');
      return;
    }
    if (!preview.emptyTarget && mode === 'overwrite' && !overwriteBackedUp) {
      toast('覆盖前请先导出当前数据，并勾选「我已备份」', 'err');
      return;
    }
    setImporting(true);
    try {
      const r = await api.importBackup(parsed, preview.emptyTarget ? 'overwrite' : mode || 'merge');
      if (!r.ok) {
        setPreviewError(r.message);
        return;
      }
      setDone({ mode: r.mode, after: r.after });
      setPreview(null);
      setParsed(null);
      await refresh();
      toast(r.mode === 'overwrite' ? '导入完成：已按备份覆盖当前数据' : '导入完成：已合并到当前数据', 'ok');
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : '导入失败，数据库未改动');
    } finally {
      setImporting(false);
    }
  };

  const counts = preview?.counts;
  const current = preview?.current;

  return (
    <div className="page">
      <PageHeader
        eyebrow="本地数据 · 备份与迁移"
        title="导出与导入"
        desc="作品没有账号体系，进度只存在当前实例。把档案导出成一个 JSON 文件，换设备或清空前导入即可继续。"
      />

      <div className="backup-grid">
        <Card>
          <div className="card-head">
            <h2>导出备份</h2>
            <span className="card-sub">一个文件包含全部本机档案</span>
          </div>
          <div className="backup-body">
            <ul className="backup-list">
              <li>简历（含正文）、目标岗位与 JD 原文</li>
              <li>JD 匹配记录、模拟面试与逐题反馈、面试报告</li>
              <li>复盘记录、个人题库、复习排程、本地档案</li>
            </ul>
            <div className="backup-privacy">
              <strong>隐私提醒</strong>
              <p>
                文件包含简历正文、JD 原文、面试作答与反馈，可能含姓名、学校、联系方式等个人信息。导出后请自行保管，不要上传到公共网盘或公开仓库；导入时文件只在本站服务内处理，不会发送到第三方服务。
              </p>
            </div>
            <div className="backup-actions">
              <Button onClick={() => void doExport()} loading={exporting}>
                导出 JSON 备份
              </Button>
              {exported && (
                <span className="backup-result">
                  已导出 {exported.filename} · {formatSize(exported.bytes)}
                </span>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div className="card-head">
            <h2>导入备份</h2>
            <span className="card-sub">先校验预览，确认后才写入</span>
          </div>
          <div className="backup-body">
            <div className="backup-pick">
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                id="backup-file"
                className="backup-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickFile(f);
                }}
              />
              <label htmlFor="backup-file" className="btn btn-ghost btn-sm backup-pick-btn">
                选择备份文件
              </label>
              <span className="backup-filename">{filename || '未选择文件'}</span>
            </div>
            <p className="backup-hint">
              校验文件版本、条目数与字段格式；损坏或版本不符会整份拒绝，不会部分写入。上限 8 MB。
            </p>

            {previewError && <Callout tone="warn">{previewError}</Callout>}

            {done && (
              <div className="backup-done">
                <strong>导入完成</strong>
                <span>
                  方式：{done.mode === 'overwrite' ? '覆盖' : '合并'} · 简历 {done.after.resumes} · 面试{' '}
                  {done.after.interviews} · 题库 {done.after.bankItems} · 复盘 {done.after.reviews}
                </span>
              </div>
            )}

            {preview && (
              <div className="backup-preview">
                <div className="backup-preview-head">
                  <span>备份版本 v{preview.version}</span>
                  <span>
                    {preview.exportedAt ? `导出于 ${new Date(preview.exportedAt).toLocaleString()}` : '未标注导出时间'}
                  </span>
                </div>
                <div className="backup-counts">
                  {Object.keys(COUNT_LABEL).map((k) => (
                    <div className="backup-count" key={k}>
                      <span>{COUNT_LABEL[k]}</span>
                      <b>{counts?.[k] ?? 0}</b>
                      <em>当前 {current?.[k] ?? 0}</em>
                    </div>
                  ))}
                </div>
                {preview.warnings.length > 0 && (
                  <div className="backup-warn">{preview.warnings.join('；')}</div>
                )}
                {preview.emptyTarget ? (
                  <div className="backup-empty">目标库为空，将直接导入这份备份。</div>
                ) : (
                  <div className="backup-modes">
                    <div className="backup-modes-title">当前库已有数据，请选择处理方式（不会自动覆盖）</div>
                    <label className={`backup-mode ${mode === 'merge' ? 'on' : ''}`}>
                      <input
                        type="radio"
                        name="backup-mode"
                        checked={mode === 'merge'}
                        onChange={() => {
                          setMode('merge');
                          setOverwriteBackedUp(false);
                        }}
                      />
                      <span>
                        <b>合并（推荐）</b>
                        <em>保留现有数据，把备份作为新记录追加；题库按题面去重，重复题不会重复入库。</em>
                      </span>
                    </label>
                    <label className={`backup-mode ${mode === 'overwrite' ? 'on' : ''}`}>
                      <input
                        type="radio"
                        name="backup-mode"
                        checked={mode === 'overwrite'}
                        onChange={() => {
                          setMode('overwrite');
                          setOverwriteBackedUp(false);
                        }}
                      />
                      <span>
                        <b>覆盖</b>
                        <em>先清空当前所有简历、岗位、面试、复盘、题库与排程，再写入备份；不可撤销。</em>
                      </span>
                    </label>
                  </div>
                )}
                {!preview.emptyTarget && mode === 'overwrite' && (
                  <Callout tone="warn">
                    <div>覆盖会先清空当前所有数据，且不可撤销。请先生成并保存当前备份。</div>
                    <div className="row gap-8 wrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={exporting}
                        onClick={() => {
                          void doExport().then((ok) => {
                            if (ok) setOverwriteBackedUp(true);
                          });
                        }}
                      >
                        先导出当前数据
                      </Button>
                      <label className="row gap-8">
                        <input
                          type="checkbox"
                          checked={overwriteBackedUp}
                          onChange={(e) => setOverwriteBackedUp(e.target.checked)}
                        />
                        <span>我已下载并确认备份</span>
                      </label>
                    </div>
                  </Callout>
                )}
                <div className="backup-actions">
                  <Button
                    onClick={() => void doImport()}
                    loading={importing}
                    disabled={
                      (!preview.emptyTarget && !mode) ||
                      (!preview.emptyTarget && mode === 'overwrite' && !overwriteBackedUp)
                    }
                  >
                    {preview.emptyTarget ? '确认导入' : mode === 'overwrite' ? '确认覆盖导入' : '确认合并导入'}
                  </Button>
                  <button type="button" className="backup-cancel" onClick={resetImport}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
