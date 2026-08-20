import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStays } from './dates.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader so the project stays dependency-free for everything but Playwright. */
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function configPath() {
  const explicit = process.env.DEAL_WATCHER_CONFIG;
  if (explicit) return path.resolve(ROOT, explicit);
  const local = path.join(ROOT, 'config.json');
  return fs.existsSync(local) ? local : path.join(ROOT, 'config.example.json');
}

export function loadConfig(file = configPath()) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  validate(cfg);
  // Runtime edits (/prag, /fereastra ...) must never write back into the committed example.
  cfg.__file = file.endsWith('config.example.json') ? path.join(ROOT, 'config.json') : file;
  return cfg;
}

export function saveConfig(cfg, file = cfg.__file || configPath()) {
  const { __file, ...rest } = cfg;
  fs.writeFileSync(file, `${JSON.stringify(rest, null, 2)}\n`);
}

export function validate(cfg) {
  if (!cfg?.search) throw new Error('config.search is missing');
  // buildStays throws on a malformed window, which is exactly the validation we want
  buildStays(cfg.search);
  const active = enabledOccupancies(cfg);
  if (!active.length) throw new Error('No enabled occupancy in config.search.occupancies');
  for (const occ of active) {
    if (!occ.rooms?.length) throw new Error(`Occupancy ${occ.id} has no rooms`);
    for (const room of occ.rooms) {
      if (!Number.isInteger(room.adults) || room.adults < 1) throw new Error(`Occupancy ${occ.id}: adults must be >= 1`);
      if (!Array.isArray(room.childAges)) throw new Error(`Occupancy ${occ.id}: childAges must be an array`);
    }
  }
  if (!Object.keys(cfg.sources || {}).some((id) => cfg.sources[id]?.enabled)) {
    throw new Error('No enabled source in config.sources');
  }
  const base = cfg.currency?.base || 'EUR';
  if (!cfg.currency?.rates?.[base]) throw new Error(`config.currency.rates is missing the base currency ${base}`);
  return cfg;
}

export function enabledOccupancies(cfg) {
  return (cfg.search.occupancies || []).filter((o) => o.enabled !== false);
}

export function enabledSources(cfg) {
  return Object.entries(cfg.sources || {})
    .filter(([, s]) => s?.enabled)
    .map(([id, s]) => ({ id, ...s }));
}

/** Flattened occupancy totals, useful for per-person maths and for source adapters. */
export function occupancySummary(occ) {
  const adults = occ.rooms.reduce((n, r) => n + r.adults, 0);
  const childAges = occ.rooms.flatMap((r) => r.childAges);
  return { adults, children: childAges.length, childAges, rooms: occ.rooms.length, guests: adults + childAges.length };
}
