const AI_CONSENT_KEY = 'fenglin:ai-consent:v1';

/** 首次使用 AI 前需要用户确认：简历/JD/作答会发送到模型服务。 */
export function hasAiConsent(): boolean {
  try {
    return window.localStorage.getItem(AI_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function giveAiConsent(): void {
  try {
    window.localStorage.setItem(AI_CONSENT_KEY, '1');
  } catch {
    /* 隐私模式下无法持久化，本次会话仍允许继续 */
  }
}
