/** Thin Telegram Bot API client - no SDK, just fetch. */

const API = 'https://api.telegram.org';

export class Telegram {
  constructor({ token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID, allowedChatIds } = {}) {
    this.token = token;
    this.chatId = chatId;
    this.allowed = new Set(
      [chatId, ...String(allowedChatIds ?? process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '').split(',')]
        .map((s) => String(s ?? '').trim())
        .filter(Boolean),
    );
  }

  get configured() {
    return Boolean(this.token);
  }

  async call(method, payload = {}, { retries = 3 } = {}) {
    if (!this.token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetch(`${API}/bot${this.token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.ok) return body.result;
        if (res.status === 429) {
          const wait = (body.parameters?.retry_after ?? 3) * 1000;
          await sleep(wait);
          continue;
        }
        throw new Error(`Telegram ${method} failed: ${res.status} ${body.description || ''}`);
      } catch (err) {
        lastError = err;
        if (attempt < retries) await sleep(1000 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  async send(text, { chatId = this.chatId, silent = false, preview = false } = {}) {
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set');
    const chunks = splitMessage(text);
    const sent = [];
    for (const chunk of chunks) {
      sent.push(
        await this.call('sendMessage', {
          chat_id: chatId,
          text: chunk,
          parse_mode: 'HTML',
          disable_notification: silent,
          link_preview_options: { is_disabled: !preview },
        }),
      );
    }
    return sent;
  }

  /** One non-blocking poll for new commands. Returns [{chatId, from, text}]. */
  async poll(offset, { timeout = 0 } = {}) {
    const updates = await this.call('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message'],
    });
    const messages = [];
    let nextOffset = offset;
    for (const u of updates) {
      nextOffset = u.update_id + 1;
      const msg = u.message;
      if (!msg?.text) continue;
      messages.push({
        chatId: String(msg.chat.id),
        from: msg.from?.username || msg.from?.first_name || 'unknown',
        text: msg.text.trim(),
      });
    }
    return { messages, nextOffset };
  }

  isAllowed(chatId) {
    return this.allowed.size === 0 || this.allowed.has(String(chatId));
  }
}

/** Telegram hard-caps messages at 4096 chars; split on line boundaries. */
export function splitMessage(text, limit = 3900) {
  const out = [];
  let current = '';
  for (const line of String(text).split('\n')) {
    const piece = line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
    if (current.length + piece.length + 1 > limit) {
      if (current) out.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [''];
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
