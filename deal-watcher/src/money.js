/** Currency normalisation. Everything is compared in the configured base currency (EUR by default). */

const SYMBOLS = { '€': 'EUR', 'лв': 'BGN', 'лв.': 'BGN', 'lv': 'BGN', 'lei': 'RON', 'ron': 'RON', '$': 'USD', '£': 'GBP' };

/**
 * Pull a number + currency out of free text like "1 234,56 €", "EUR 987", "2.150 lv.".
 * Returns null when no number is present.
 */
export function parsePrice(text, fallbackCurrency = 'EUR') {
  if (text == null) return null;
  const raw = String(text).replace(/ /g, ' ').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  let currency = null;
  for (const [sym, code] of Object.entries(SYMBOLS)) {
    if (lower.includes(sym)) { currency = code; break; }
  }
  const code = /\b(EUR|BGN|RON|USD|GBP)\b/i.exec(raw);
  if (code) currency = code[1].toUpperCase();

  const num = /(\d[\d\s.,]*\d|\d)/.exec(raw);
  if (!num) return null;
  const amount = normaliseNumber(num[1]);
  if (amount == null) return null;
  return { amount, currency: currency || fallbackCurrency };
}

/** "1.234,56" / "1,234.56" / "1 234" -> 1234.56 */
export function normaliseNumber(str) {
  let s = String(str).replace(/\s/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // whichever comes last is the decimal separator
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // a lone comma is decimal only when it is followed by 1-2 digits
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot > -1) {
    if (!/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function convert(amount, from, to, rates) {
  if (from === to) return amount;
  const rFrom = rates[from];
  const rTo = rates[to];
  if (!rFrom || !rTo) throw new Error(`Missing FX rate for ${from} -> ${to}`);
  // rates are expressed as "units of X per 1 base"
  return (amount / rFrom) * rTo;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function fmtMoney(amount, currency = 'EUR') {
  return `${round2(amount).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}
