import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 浏览器内置 SpeechSynthesis 朗读封装。
 * - 按面试语言优先选择中文（zh-*）或英文（en-*）语音；
 * - 浏览器没有任何可用语音时，按系统默认朗读；
 * - 明确没有目标语言语音时降级为静默，并给出提示，不调用外部 TTS。
 */
export function useTts(lang: 'zh' | 'en' = 'zh') {
  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState(1);
  const guardRef = useRef<number | null>(null);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    const onVoices = () => load();
    window.speechSynthesis.addEventListener?.('voiceschanged', onVoices);
    const timer = window.setTimeout(load, 800);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
      window.clearTimeout(timer);
      window.clearTimeout(guardRef.current ?? undefined);
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const hasVoices = voices.length > 0;
  const target = voices.find((v) => (lang === 'en' ? /^en([-_]|$)/i : /^zh([-_]|$)/i).test(v.lang)) || null;
  const canSpeak = supported && (!hasVoices || !!target);
  const note = !supported
    ? '当前浏览器不支持语音朗读，请用文字作答。'
    : hasVoices && !target
      ? lang === 'en'
        ? '当前浏览器没有英文语音，朗读已降级为静默；可继续用文字作答。'
        : '当前浏览器没有中文语音，朗读已降级为静默；可继续用文字或语音作答。'
      : '';

  const stop = useCallback(() => {
    if (!supported) return;
    window.clearTimeout(guardRef.current ?? undefined);
    guardRef.current = null;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      if (hasVoices && !target) {
        setSpeaking(false);
        return;
      }
      window.clearTimeout(guardRef.current ?? undefined);
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang === 'en' ? 'en-US' : 'zh-CN';
      utter.rate = rate;
      utter.pitch = 1;
      if (target) utter.voice = target;
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utter);
      // 某些无音频设备的环境不会触发 onend，兜底收回状态，避免按钮卡在「停止朗读」
      guardRef.current = window.setTimeout(
        () => setSpeaking(false),
        Math.max(12000, Math.min(120000, text.length * 420)),
      );
    },
    [supported, hasVoices, target, rate, lang],
  );

  const cycleRate = useCallback(() => {
    setRate((r) => (r === 0.85 ? 1 : r === 1 ? 1.15 : 0.85));
  }, []);

  return { supported, speaking, canSpeak, note, rate, cycleRate, speak, stop };
}
