import { config } from '../config';

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

/**
 * 校验 Cloudflare Turnstile token。
 * enabled=false 时直接返回 true（本地调试用）。
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteip?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!config.turnstile.enabled) return { ok: true };
  if (!config.turnstile.secretKey) {
    // 配了 enabled 但没填 secret，视为校验失败
    return { ok: false, error: '人机验证未配置' };
  }
  if (!token) return { ok: false, error: '人机验证未完成' };

  try {
    const body = new URLSearchParams();
    body.append('secret', config.turnstile.secretKey);
    body.append('response', token);
    if (remoteip) body.append('remoteip', remoteip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as TurnstileVerifyResponse;
    if (data.success) return { ok: true };
    return { ok: false, error: '人机验证失败' };
  } catch (err) {
    console.error('[turnstile] 校验异常', err);
    return { ok: false, error: '人机验证服务不可用' };
  }
}

export function turnstileSiteKey(): string {
  return config.turnstile.siteKey;
}

export function turnstileEnabled(): boolean {
  return config.turnstile.enabled && !!config.turnstile.siteKey;
}
