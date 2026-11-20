import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useApp } from '../state';
import type { ResumeTemplate } from '../types';
import { renderMarkdown } from '../lib/markdown';
import { Button, Callout, Card, Chip, ErrorState, Field, Loading, PageHeader, SourceBadge } from '../components/ui';

export function TemplateBuild() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeJob, profile, toast, refreshResumes, setActiveResume } = useApp();
  const [template, setTemplate] = useState<ResumeTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [polishNotes, setPolishNotes] = useState<string[]>([]);
  const [polishSource, setPolishSource] = useState<'llm' | 'local' | null>(null);
  const [polished, setPolished] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .templates()
      .then((r) => {
        const t = r.templates.find((x) => x.id === id);
        if (!t) {
          setError('模板不存在');
          return;
        }
        setTemplate(t);
        setTitle(`${activeJob?.title || t.name} · 初稿`);
        const init: Record<string, string> = {};
        if (t.id) {
          init.basic =
            [profile?.nickname, profile?.school, profile?.major, profile?.grade].filter(Boolean).join('｜') || '';
        }
        setAnswers(init);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
    // profile 只在首次加载时作为预填
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const assembled = useMemo(() => {
    if (!template) return '';
    if (polished) return polished;
    const parts: string[] = [];
    for (const s of template.sections) {
      const val = (answers[s.key] || '').trim();
      if (!val) continue;
      parts.push(`## ${s.name}\n${val}`);
    }
    return parts.join('\n\n');
  }, [template, answers, polished]);

  const missing = useMemo(
    () => (template ? template.sections.filter((s) => s.required && !(answers[s.key] || '').trim()) : []),
    [template, answers],
  );

  const filledCount = template ? template.sections.filter((s) => (answers[s.key] || '').trim()).length : 0;

  const onImport = async (file: File) => {
    const text = await file.text();
    if (!template) return;
    const next: Record<string, string> = {};
    let currentKey: string | null = null;
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      const h = /^#{1,3}\s+(.+)$/.exec(line.trim());
      if (h) {
        const name = h[1].trim();
        const sec = template.sections.find((s) => s.name.includes(name) || name.includes(s.name));
        currentKey = sec ? sec.key : null;
        continue;
      }
      if (currentKey && line.trim()) {
        next[currentKey] = (next[currentKey] ? `${next[currentKey]}\n` : '') + line;
      }
    }
    if (Object.keys(next).length === 0) {
      toast('没有识别到「## 板块名」结构，请检查文件格式', 'err');
      return;
    }
    setAnswers((prev) => ({ ...prev, ...next }));
    setPolished(null);
    toast(`已导入 ${Object.keys(next).length} 个板块`, 'ok');
  };

  const generate = async () => {
    if (!template) return;
    if (missing.length) {
      toast(`还有必填板块没写：${missing.map((m) => m.name).join('、')}`, 'err');
      setStep(template.sections.findIndex((s) => s.key === missing[0].key));
      return;
    }
    if (assembled.trim().length < 30) {
      toast('内容太少了，至少写满教育背景和项目经历', 'err');
      return;
    }
    setSaving(true);
    try {
      const { resume } = await api.createResume({
        title: title.trim() || `${template.name} · 初稿`,
        content: assembled,
        jobId: activeJob?.id ?? null,
        source: 'template',
      });
      await refreshResumes();
      await setActiveResume(resume.id);
      toast('初稿已保存，正在打开简历优化', 'ok');
      navigate(`/optimize?resumeId=${resume.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  const polish = async () => {
    if (!template) return;
    if (assembled.trim().length < 30) {
      toast('先填写内容再润色', 'err');
      return;
    }
    setPolishing(true);
    setPolishNotes([]);
    try {
      const { result, meta } = await api.polish({ markdown: assembled, jobTitle: activeJob?.title || template.name });
      setPolished(result.resume);
      setPolishNotes(result.notes || []);
      setPolishSource(meta.source);
      toast(meta.source === 'llm' ? '润色完成，可继续手改' : '模型不可用，已保留初稿', meta.source === 'llm' ? 'ok' : 'err');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '润色失败', 'err');
    } finally {
      setPolishing(false);
    }
  };

  if (loading) return <Loading label="加载模板" />;
  if (error || !template) return <ErrorState message={error || '模板不存在'} onRetry={() => navigate('/templates')} />;

  const sec = template.sections[step];

  return (
    <div className="page">
      <PageHeader
        eyebrow={`模块 0 · ${template.name}`}
        title="按引导填写，生成你的第一版简历"
        desc="每一栏先看「这栏写什么」，再对照正反例。写不出数据就写「待补充」，后面优化环节会帮你补。"
        actions={
          <Button variant="quiet" onClick={() => navigate('/templates')}>
            ← 换模板
          </Button>
        }
      />

      <div className="build-grid">
        <div className="build-main">
          <Card className="build-progress">
            <div className="build-steps">
              {template.sections.map((s, i) => {
                const done = !!(answers[s.key] || '').trim();
                return (
                  <button
                    key={s.key}
                    className={`build-step ${i === step ? 'active' : ''} ${done ? 'done' : ''}`}
                    onClick={() => setStep(i)}
                  >
                    <span className="bs-num">{done ? '✓' : i + 1}</span>
                    <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="build-meta">
              已填 {filledCount}/{template.sections.length} 栏
              {missing.length > 0 && <span className="req-miss">必填缺 {missing.length} 项</span>}
            </div>
          </Card>

          <Card title={`${step + 1}. ${sec.name}`} subtitle={sec.hint}>
            <div className="guide-questions">
              {sec.questions.map((q) => (
                <span key={q} className="guide-q">
                  {q}
                </span>
              ))}
            </div>
            <Field label="你的内容" required={sec.required}>
              <textarea
                className="textarea"
                rows={7}
                placeholder={sec.placeholder}
                value={answers[sec.key] || ''}
                onChange={(e) => {
                  setAnswers((p) => ({ ...p, [sec.key]: e.target.value }));
                  setPolished(null);
                }}
              />
            </Field>

            <div className="example-grid">
              <div className="example good">
                <div className="example-head">✓ 建议这样写</div>
                <pre>{sec.good}</pre>
              </div>
              <div className="example bad">
                <div className="example-head">✕ 别这么写</div>
                <pre>{sec.bad}</pre>
              </div>
            </div>

            <div className="row between mt-16">
              <Button variant="quiet" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                ← 上一栏
              </Button>
              {step < template.sections.length - 1 ? (
                <Button variant="ink" onClick={() => setStep((s) => Math.min(template.sections.length - 1, s + 1))}>
                  下一栏 →
                </Button>
              ) : (
                <Button variant="ink" onClick={() => void generate()} loading={saving}>
                  生成初版简历
                </Button>
              )}
            </div>
          </Card>

          <Card title="整段导入" subtitle="如果你已经有 Markdown / 纯文本简历，可以按「## 板块名」自动拆进各栏">
            <div className="row gap-8">
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f);
                  e.target.value = '';
                }}
              />
              <Button onClick={() => fileRef.current?.click()}>选择 .md / .txt 文件</Button>
              <Button variant="ghost" onClick={() => navigate('/import')}>
                从 PDF / 图片导入
              </Button>
              <span className="muted small">电子版 PDF 在浏览器本地解析；扫描件由视觉模型识别后确认入库。</span>
            </div>
          </Card>
        </div>

        <div className="build-side">
          <Card
            title="实时预览"
            extra={
              <span className="muted small">
                {assembled.replace(/\s/g, '').length} 字
              </span>
            }
          >
            <Field label="简历标题">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="paper-scroll preview markdown-body">
              {assembled.trim() ? renderMarkdown(assembled) : <p className="muted">开始填写左侧内容，这里会实时生成初稿。</p>}
            </div>
            <div className="row gap-8 mt-12 wrap">
              <Button size="sm" onClick={() => void polish()} loading={polishing}>
                AI 润色初稿
              </Button>
              <Button size="sm" variant="ink" onClick={() => void generate()} loading={saving}>
                保存并去优化
              </Button>
            </div>
            {polishSource && (
              <div className="mt-8">
                <SourceBadge source={polishSource} />
                {polishNotes.length > 0 && (
                  <ul className="notes">
                    {polishNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {polished && (
              <Callout tone="warn">
                已切换到润色稿。若想回到手填版本，
                <button className="link-btn" onClick={() => setPolished(null)}>
                  点此还原
                </button>
                。
              </Callout>
            )}
          </Card>

          <Card title="填写原则" paper>
            <ul className="principles">
              <li>一页 A4，按「与岗位相关度」排序，不按时间流水账。</li>
              <li>每段经历至少一个数字：规模、时长、提升幅度。</li>
              <li>用「我」写清个人贡献，团队成果要标注你的部分。</li>
              <li>没有的经历就删掉整栏，别用「积极参加」凑字数。</li>
            </ul>
            <div className="mt-12">
              <Chip tone="red">不会写数据？先写「待补充：xx%」</Chip>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
