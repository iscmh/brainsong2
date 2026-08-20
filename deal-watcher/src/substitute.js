/**
 * Turns one recorded booking-engine request into the same request for different dates/occupancy.
 *
 * Dates are unique enough to swap textually (in every format engines use).
 * Guest counts are not - "3" appears everywhere - so those are only swapped inside
 * query parameters or JSON keys whose name looks occupancy-related.
 */

import { parseDay } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

/** Every textual spelling of a date we might find in a URL or POST body. */
export function dateVariants(iso) {
  const d = new Date(parseDay(iso));
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const mShort = String(d.getUTCMonth() + 1);
  const dShort = String(d.getUTCDate());
  return [
    `${y}-${m}-${day}`,
    `${day}.${m}.${y}`,
    `${day}/${m}/${y}`,
    `${m}/${day}/${y}`,
    `${day}-${m}-${y}`,
    `${y}/${m}/${day}`,
    `${y}${m}${day}`,
    `${dShort}.${mShort}.${y}`,
    `${dShort}/${mShort}/${y}`,
  ];
}

/** Pairs of [probeSpelling, targetSpelling] for both stay dates, longest first. */
export function dateSubstitutions(probe, target) {
  const pairs = [];
  for (const field of ['checkIn', 'checkOut']) {
    if (!probe[field] || !target[field]) continue;
    const from = dateVariants(probe[field]);
    const to = dateVariants(target[field]);
    from.forEach((f, i) => pairs.push([f, to[i]]));
  }
  // De-duplicate identical spellings (e.g. 1-digit and 2-digit forms of day 12)
  const seen = new Set();
  return pairs
    .filter(([f]) => (seen.has(f) ? false : seen.add(f)))
    .sort((a, b) => b[0].length - a[0].length);
}

export function replaceDates(text, probe, target) {
  if (!text) return text;
  let out = String(text);
  for (const [from, to] of dateSubstitutions(probe, target)) {
    if (from === to) continue;
    out = out.split(from).join(to);
    out = out.split(encodeURIComponent(from)).join(encodeURIComponent(to));
  }
  return out;
}

const ADULT_KEY = /adult|adulti|adults|nrad/i;
const CHILD_COUNT_KEY = /child(ren)?(count|s)?$|copii|kids|nrch/i;
const CHILD_AGE_KEY = /age|varsta|childage/i;
const ROOM_KEY = /rooms?$|camere|nrrooms/i;

/** Rewrite occupancy-looking query parameters of a URL. */
export function replaceOccupancyInUrl(url, probe, target) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const params = parsed.searchParams;
  for (const key of [...params.keys()]) {
    const value = params.get(key);
    const next = mapOccupancyValue(key, value, probe, target);
    if (next !== null) params.set(key, next);
  }
  parsed.search = params.toString();
  return parsed.toString();
}

/** Rewrite occupancy-looking fields anywhere in a parsed JSON body. */
export function replaceOccupancyInJson(node, probe, target, depth = 0) {
  if (node == null || depth > 12) return node;
  if (Array.isArray(node)) return node.map((v) => replaceOccupancyInJson(v, probe, target, depth + 1));
  if (typeof node !== 'object') return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value) && CHILD_AGE_KEY.test(key) && value.every((v) => typeof v === 'number')) {
      out[key] = target.childAges;
      continue;
    }
    if (value !== null && typeof value === 'object') {
      out[key] = replaceOccupancyInJson(value, probe, target, depth + 1);
      continue;
    }
    const mapped = mapOccupancyValue(key, value, probe, target);
    out[key] = mapped === null ? value : typeof value === 'number' ? Number(mapped) : mapped;
  }
  return out;
}

function mapOccupancyValue(key, value, probe, target) {
  const asString = String(value ?? '');
  if (ADULT_KEY.test(key) && asString === String(probe.adults)) return String(target.adults);
  if (CHILD_COUNT_KEY.test(key) && asString === String(probe.childAges.length)) return String(target.childAges.length);
  if (ROOM_KEY.test(key) && asString === String(probe.rooms)) return String(target.rooms);
  if (CHILD_AGE_KEY.test(key)) {
    const probeAges = probe.childAges.join(',');
    if (asString === probeAges || asString === probe.childAges.join('|')) {
      const sep = asString.includes('|') ? '|' : ',';
      return target.childAges.join(sep);
    }
    if (probe.childAges.length === 1 && asString === String(probe.childAges[0])) {
      return String(target.childAges[0] ?? '');
    }
  }
  return null;
}

/** Full rewrite of a recorded request for a new stay + occupancy. */
export function retargetRequest(recorded, { probe, target }) {
  let url = replaceDates(recorded.url, probe, target);
  url = replaceOccupancyInUrl(url, probe, target);

  let postData = recorded.postData ?? null;
  if (postData) {
    postData = replaceDates(postData, probe, target);
    const asJson = tryJson(postData);
    if (asJson !== undefined) {
      postData = JSON.stringify(replaceOccupancyInJson(asJson, probe, target));
    } else if (recorded.contentType?.includes('x-www-form-urlencoded')) {
      const params = new URLSearchParams(postData);
      for (const key of [...params.keys()]) {
        const mapped = mapOccupancyValue(key, params.get(key), probe, target);
        if (mapped !== null) params.set(key, mapped);
      }
      postData = params.toString();
    }
  }
  return { ...recorded, url, postData };
}

function tryJson(text) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
