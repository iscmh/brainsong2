import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const VERSION = 1;
const MAX_HISTORY = 200;

export function entryKey(sourceId, occupancyId, checkIn) {
  return `${sourceId}|${occupancyId}|${checkIn}`;
}

export function parseKey(key) {
  const [sourceId, occupancyId, checkIn] = key.split('|');
  return { sourceId, occupancyId, checkIn };
}

export class Store {
  constructor(file) {
    this.file = path.resolve(ROOT, file || 'data/state.json');
    this.state = this.#read();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed.version !== VERSION) return blank();
      return { ...blank(), ...parsed };
    } catch {
      return blank();
    }
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`);
    fs.renameSync(tmp, this.file); // atomic-ish: survives a kill mid-write
  }

  entry(key) {
    return this.state.entries[key] || null;
  }

  /** Record the cheapest offer seen for a key and return what changed. */
  record(key, offer, at = new Date().toISOString()) {
    const prev = this.entry(key);
    const next = prev ? { ...prev } : { best: null, last: null, lastAlertAt: null, history: [] };
    const previousLast = prev?.last || null;
    const previousBest = prev?.best || null;

    next.last = offer ? { ...offer, seenAt: at } : null;
    next.lastSeenAt = at;
    if (offer && (!next.best || offer.priceBase < next.best.priceBase)) {
      next.best = { ...offer, seenAt: at };
    }
    if (offer) {
      next.history.push({ t: at, p: offer.priceBase });
      if (next.history.length > MAX_HISTORY) next.history = next.history.slice(-MAX_HISTORY);
    }
    this.state.entries[key] = next;
    return { entry: next, previousLast, previousBest };
  }

  markAlerted(key, at = new Date().toISOString()) {
    if (this.state.entries[key]) this.state.entries[key].lastAlertAt = at;
  }

  noteError(sourceId, error) {
    const e = this.state.errors[sourceId] || { count: 0 };
    e.count += 1;
    e.lastError = String(error?.message || error).slice(0, 500);
    e.lastErrorAt = new Date().toISOString();
    this.state.errors[sourceId] = e;
  }

  clearError(sourceId) {
    delete this.state.errors[sourceId];
  }

  /** Cheapest currently-available offers across every key, cheapest first. */
  cheapest(limit = 5, filter = () => true) {
    return Object.entries(this.state.entries)
      .filter(([key, e]) => e.last && filter(parseKey(key), e))
      .map(([key, e]) => ({ key, ...parseKey(key), offer: e.last, best: e.best }))
      .sort((a, b) => a.offer.priceBase - b.offer.priceBase)
      .slice(0, limit);
  }

  stats() {
    const entries = Object.values(this.state.entries);
    return {
      tracked: entries.length,
      available: entries.filter((e) => e.last).length,
      lastSweepAt: this.state.lastSweepAt,
      sweeps: this.state.sweeps,
      errors: this.state.errors,
    };
  }
}

function blank() {
  return {
    version: VERSION,
    updatedAt: null,
    lastSweepAt: null,
    sweeps: 0,
    paused: false,
    telegramOffset: 0,
    lastDigestDay: null,
    entries: {},
    errors: {},
  };
}
