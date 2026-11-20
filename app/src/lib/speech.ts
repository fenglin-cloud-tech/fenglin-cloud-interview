import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}
interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface SpeechState {
  supported: boolean;
  listening: boolean;
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

/**
 * 浏览器语音输入（Web Speech API）。
 * 不支持时 supported=false，调用方应降级为纯文字输入并给出明确提示。
 */
export function useSpeech(onFinal: (text: string) => void): SpeechState {
  const ctor = useMemo(getCtor, []);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const start = useCallback(() => {
    if (!ctor) {
      setError('当前浏览器不支持语音识别，请改用文字作答');
      return;
    }
    if (recRef.current) {
      try {
        recRef.current.abort();
      } catch {
        /* ignore */
      }
    }
    const rec = new ctor();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = '';
      let draft = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else draft += r[0].transcript;
      }
      setInterim(draft);
      if (finalText) {
        setInterim('');
        finalRef.current(finalText);
      }
    };
    rec.onerror = (e) => {
      const msg =
        e.error === 'not-allowed'
          ? '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试'
          : e.error === 'no-speech'
            ? '没有听到声音，请靠近麦克风再试一次'
            : `语音识别出错（${e.error || '未知'}），请改用文字作答`;
      setError(msg);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    try {
      rec.start();
      recRef.current = rec;
      setError(null);
      setListening(true);
    } catch {
      setError('语音识别启动失败，请改用文字作答');
      setListening(false);
    }
  }, [ctor]);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { supported: !!ctor, listening, interim, error, start, stop, reset };
}
