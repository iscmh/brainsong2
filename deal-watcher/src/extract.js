/**
 * Heuristics for pulling room offers out of an arbitrary booking-engine JSON payload.
 * Booking engines all invent their own schema, so instead of hard-coding one we look for
 * objects that carry both a price-ish number and a name-ish string.
 */

import { normaliseNumber } from './money.js';

const PRICE_KEYS = [
  'totalprice', 'total_price', 'total', 'priceTotal', 'grandtotal', 'amount', 'price', 'rate',
  'finalprice', 'sellprice', 'netprice', 'value', 'sum', 'pretTotal', 'pret',
];
const NAME_KEYS = ['roomname', 'room_name', 'name', 'title', 'roomtype', 'room_type', 'category', 'description', 'label'];
const BOARD_KEYS = ['board', 'boardname', 'meal', 'mealplan', 'meal_plan', 'pension', 'basis', 'rateplan', 'rate_plan'];
const CANCEL_KEYS = ['cancellation', 'cancellationpolicy', 'refundable', 'freecancellation', 'policy'];
const CURRENCY_KEYS = ['currency', 'currencycode', 'currency_code', 'cur'];

const lc = (s) => String(s).toLowerCase().replace(/[^a-z_]/g, '');

/** Depth-first walk yielding every plain object in the payload. */
export function* walk(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item, depth + 1);
    return;
  }
  yield node;
  for (const value of Object.values(node)) yield* walk(value, depth + 1);
}

function pick(obj, keys) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || typeof v === 'object') continue;
    if (keys.includes(lc(k))) return { key: k, value: v };
  }
  return null;
}

function pickNumber(obj, keys) {
  let best = null;
  for (const [k, v] of Object.entries(obj)) {
    if (!keys.includes(lc(k))) continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' ? normaliseNumber(v) : null;
    if (n == null || !Number.isFinite(n) || n <= 0) continue;
    // prefer keys that look like a stay total over a per-night rate
    const weight = /total|grand|final|sum/.test(lc(k)) ? 2 : 1;
    if (!best || weight > best.weight) best = { key: k, value: n, weight };
  }
  return best;
}

function pickNestedNumber(obj, keys) {
  for (const value of Object.values(obj)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const hit = pickNumber(value, keys);
    if (hit) return { ...hit, container: value };
  }
  return null;
}

/**
 * @returns {Array<{title, board, price, currency, cancellation, raw}>}
 */
export function extractOffers(payload, { fallbackCurrency = 'EUR', minPrice = 1, maxPrice = 100_000 } = {}) {
  const offers = [];
  const seen = new Set();

  for (const node of walk(payload)) {
    const name = pick(node, NAME_KEYS);
    // Engines often nest the money one level down ({ name, prices: { total } }), so look there too.
    const price = pickNumber(node, PRICE_KEYS) || (name ? pickNestedNumber(node, PRICE_KEYS) : null);
    if (!price || price.value < minPrice || price.value > maxPrice) continue;
    const board = pick(node, BOARD_KEYS);
    const currency = pick(node, CURRENCY_KEYS) || (price.container ? pick(price.container, CURRENCY_KEYS) : null);
    if (!name && !board) continue;
    const cancellation = pick(node, CANCEL_KEYS);

    const title = name ? String(name.value).trim().slice(0, 120) : '';
    const key = `${title}|${price.value}|${board ? board.value : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    offers.push({
      title,
      board: board ? String(board.value).trim().slice(0, 80) : '',
      price: price.value,
      currency: currency ? String(currency.value).toUpperCase().slice(0, 3) : fallbackCurrency,
      cancellation: cancellation ? String(cancellation.value).slice(0, 80) : '',
      raw: { priceKey: price.key, nameKey: name?.key },
    });
  }
  return offers;
}

/** Resolve "a.b[0].c" against a payload; used when the user pins an exact path in config. */
export function atPath(payload, path) {
  if (!path) return payload;
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? acc : acc[key]), payload);
}
