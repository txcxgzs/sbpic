import nodemailer from 'nodemailer';
import { getSetting, getSettingNum, registerRebuilder } from './settings';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (getSetting('mail_enabled') !== 'true') return null;
  const host = getSetting('smtp_host');
  const user = getSetting('smtp_user');
  const pass = getSetting('smtp_pass');
  if (!host || !user || !pass) {
    console.warn('[mail] SMTP 未完整配置，发信功能不可用');
    return null;
  }
  if (!transporter) {
    const port = getSettingNum('smtp_port', 587);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateLimit: 14, // 每秒最多 14 封，避免触发服务商限制
    });
  }
  return transporter;
}

/** admin 保存邮件配置后触发：丢弃缓存的 transporter，下次发信重建 */
export function resetTransporter(): void {
  transporter = null;
}

registerRebuilder(resetTransporter);

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.warn(`[mail] 发信跳过（未配置）：${to} <- ${subject}`);
    return false;
  }
  try {
    await t.sendMail({
      from: getSetting('smtp_from') || getSetting('smtp_user'),
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    return true;
  } catch (err) {
    console.error('[mail] 发信失败', to, err);
    return false;
  }
}

export async function sendVerificationEmail(to: string, link: string): Promise<boolean> {
  const safeLink = escapeHtml(link);
  const html = `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222;">
  <h2 style="margin:0 0 12px;">烧饼图床 · 邮箱验证</h2>
  <p>请点击下方按钮激活你的邮箱（链接 24 小时内有效）：</p>
  <p><a href="${safeLink}" style="display:inline-block;padding:10px 20px;background:#cc785c;color:#fff;border-radius:8px;text-decoration:none;">激活邮箱</a></p>
  <p style="font-size:12px;color:#888;margin-top:16px;">如果按钮无法点击，请复制此链接到浏览器：<br>${safeLink}</p>
  <p style="font-size:12px;color:#888;">若非本人操作请忽略此邮件。</p>
</div>`;
  return sendMail(to, '【烧饼图床】邮箱验证', html, `请访问以下链接激活邮箱（24小时内有效）：\n${link}`);
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}
