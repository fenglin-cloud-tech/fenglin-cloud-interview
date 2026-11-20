import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../state';
import { Button, Callout, Card, ErrorState, Field, Loading, PageHeader } from '../components/ui';
import { dataUrlOf, imageFileToPayload, parsePdf, type ImagePayload } from '../lib/pdf';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

interface ParsedResume {
  basic: string;
  education: string;
  projects: string;
  skills: string;
  rawText: string;
}

const EMPTY: ParsedResume = { basic: '', education: '', projects: '', skills: '', rawText: '' };

function composeMarkdown(title: string, value: ParsedResume): string {
  const parts: string[] = [];
  if (title.trim()) parts.push(`# ${title.trim()}`);
  const sections: Array<[string, string]> = [
    ['基本信息', value.basic],
    ['教育背景', value.education],
    ['项目经历', value.projects],
    ['专业技能', value.skills],
  ];
  sections.forEach(([name, body]) => {
    if (body.trim()) parts.push(`## ${name}\n${body.trim()}`);
  });
  const structured = sections.some(([, body]) => body.trim());
  if (!structured && value.rawText.trim()) parts.push(value.rawText.trim());
  return parts.join('\n\n');
}

export function ImportResume() {
  const navigate = useNavigate();
  const { activeJob, refreshResumes, setActiveResume, toast } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'pdf-text' | 'image'>('pdf-text');
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<ParsedResume>(EMPTY);

  const reset = () => {
    setError(null);
    setNote('');
    setPreviewText('');
    previewImages.forEach((url) => URL.revokeObjectURL(url));
    setPreviewImages([]);
    setValues(EMPTY);
    setTitle('');
    setMode('pdf-text');
  };

  const applyImageResult = (
    result: ParsedResume,
    urls: string[],
    fallback: boolean,
    hint: string | undefined,
    fileName: string,
  ) => {
    setValues(result);
    setPreviewImages(urls);
    setMode('image');
    setTitle(fileName.replace(/\.[^.]+$/, ''));
    setNote(fallback ? hint || '模型输出未能结构化，已把原始识别内容作为底稿，请手工整理' : '');
    setStep('confirm');
  };

  async function handleFile(file: File) {
    setError(null);
    setNote('');
    if (!ACCEPT.includes(file.type)) {
      setError({ message: '不支持的文件类型', detail: '仅支持 PDF、PNG、JPG、WEBP' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setError({ message: '文件超过 10MB', detail: '请压缩图片或拆分 PDF 后再试' });
      return;
    }

    setLastFile(file);
    setBusy(true);
    setStage(file.type === 'application/pdf' ? '正在浏览器本地解析 PDF…' : '正在调用视觉模型识别图片…');
    try {
      if (file.type === 'application/pdf') {
        const parsed = await parsePdf(file);
        if (parsed.mode === 'text' && parsed.text) {
          setMode('pdf-text');
          setPreviewText(parsed.text);
          setValues({ ...EMPTY, rawText: parsed.text });
          setTitle(file.name.replace(/\.pdf$/i, ''));
          setNote('检测到文字层，已在浏览器本地完成解析，原文没有离开浏览器。');
          setStep('confirm');
        } else {
          setStage('未检测到文字层，正在把页面转成图片并调用视觉模型…');
          const images = parsed.images || [];
          if (!images.length) throw new Error('PDF 中没有可解析的页面');
          const response = await api.parseResumeImage({ fileName: file.name, images });
          applyImageResult(
            response.result,
            images.map(dataUrlOf),
            response.fallback,
            response.note,
            file.name,
          );
        }
      } else {
        const payload: ImagePayload = await imageFileToPayload(file);
        const response = await api.parseResumeImage({ fileName: file.name, images: [payload] });
        applyImageResult(response.result, [URL.createObjectURL(file)], response.fallback, response.note, file.name);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError({
        message: '解析失败，可以重试或先手动填写',
        detail: detail.slice(0, 300),
      });
    } finally {
      setBusy(false);
      setStage('');
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function save() {
    const content = composeMarkdown(title, values);
    if (content.replace(/\s/g, '').length < 20) {
      setError({ message: '内容太少，至少需要 20 个字', detail: '请补充基本信息、教育背景或项目经历后再保存' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { resume } = await api.createResume({
        title: title.trim() || '导入的简历',
        content,
        jobId: activeJob?.id ?? null,
        source: mode === 'pdf-text' ? 'pdf-text' : 'image',
      });
      await setActiveResume(resume.id);
      await refreshResumes();
      toast('简历已保存，可以开始优化了', 'ok');
      navigate('/optimize');
    } catch (err) {
      setError({ message: '保存失败', detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const update = (key: keyof ParsedResume, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  if (step === 'confirm') {
    return (
      <>
        <PageHeader
          eyebrow="模块 0 · 简历导入"
          title="确认解析结果"
          desc="所有字段都可以直接修改。确认保存后才会写入简历库，并自动带入简历优化。"
        />
        {note && <Callout tone={note.includes('未能') ? 'warn' : 'info'}>{note}</Callout>}
        <div className="import-grid">
          <Card title="原始内容预览" subtitle={mode === 'pdf-text' ? 'PDF 文字层（本地解析）' : '上传的图片 / 扫描件'}>
            {mode === 'pdf-text' ? (
              <pre className="import-preview">{previewText.slice(0, 6000)}</pre>
            ) : (
              <div className="import-thumbs">
                {previewImages.map((url, index) => (
                  <img key={index} src={url} alt={`第 ${index + 1} 页`} />
                ))}
              </div>
            )}
            <p className="hint">
              {mode === 'pdf-text'
                ? '文字层由浏览器本地抽取，未发送到服务端。'
                : '图片由服务端转发给智谱视觉模型识别，仅在内存中处理，不落盘、不长期存储。'}
            </p>
          </Card>

          <Card title="可编辑内容" subtitle="核对无误后保存">
            <Field label="简历标题">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：张同学 · Java 后端实习" />
            </Field>
            <Field label="基本信息" hint="姓名、电话、邮箱、求职意向">
              <textarea className="textarea" rows={3} value={values.basic} onChange={(e) => update('basic', e.target.value)} />
            </Field>
            <Field label="教育背景">
              <textarea className="textarea" rows={3} value={values.education} onChange={(e) => update('education', e.target.value)} />
            </Field>
            <Field label="项目经历">
              <textarea className="textarea" rows={6} value={values.projects} onChange={(e) => update('projects', e.target.value)} />
            </Field>
            <Field label="技能 / 证书">
              <textarea className="textarea" rows={3} value={values.skills} onChange={(e) => update('skills', e.target.value)} />
            </Field>
            <Field label="原文底稿" hint="用于对照校对；如果上面四个板块都为空，保存时会直接使用这段原文">
              <textarea className="textarea" rows={6} value={values.rawText} onChange={(e) => update('rawText', e.target.value)} />
            </Field>

            {error && <ErrorState message={error.message} detail={error.detail} />}

            <div className="row gap-8 wrap" style={{ marginTop: 12 }}>
              <Button variant="ink" onClick={() => void save()} disabled={busy}>
                {busy ? '保存中…' : '确认并保存，去优化'}
              </Button>
              <Button variant="ghost" onClick={() => lastFile && void handleFile(lastFile)} disabled={busy}>
                重新解析
              </Button>
              <Button variant="ghost" onClick={() => { reset(); setStep('pick'); }} disabled={busy}>
                重新选择文件
              </Button>
            </div>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="模块 0 · 简历导入"
        title="从 PDF / 图片导入简历"
        desc="电子版 PDF 在浏览器本地抽取文字；扫描件和照片才发送给视觉模型。解析结果先确认，再入库。"
        actions={<Button variant="ghost" onClick={() => navigate('/resumes')}>返回简历库</Button>}
      />
      <Card>
        <div
          className="import-drop"
          role="button"
          tabIndex={0}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (!busy && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file && !busy) void handleFile(file);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <strong>{busy ? stage : '点击选择，或把文件拖到这里'}</strong>
          <span>支持 PDF / PNG / JPG / WEBP，单文件不超过 10MB</span>
        </div>

        {busy && <Loading label={stage || '正在解析…'} lines={2} />}

        {error && (
          <ErrorState
            message={error.message}
            detail={error.detail}
            onRetry={lastFile ? () => void handleFile(lastFile) : () => inputRef.current?.click()}
            onFallback={() => {
              setError(null);
              setValues(EMPTY);
              setTitle(lastFile ? lastFile.name.replace(/\.[^.]+$/, '') : '');
              setMode('image');
              setNote('已切换为手动整理：请直接填写各板块，或粘贴简历原文后保存。');
              setStep('confirm');
            }}
            fallbackLabel="手动填写"
          />
        )}

        <Callout tone="info">
          电子简历的 PDF 原文只在浏览器里解析，不会上传；扫描件会转成图片交给智谱视觉模型（glm-4v-flash）识别。
          扫描件最多解析前 3 页，图片仅在内存中处理，不落盘、不长期存储。
        </Callout>
      </Card>
    </>
  );
}
