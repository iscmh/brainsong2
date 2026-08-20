/** Replays a recorded availability request with new dates/occupancy. Preferred adapter - stable and cheap. */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { extractOffers, atPath } from '../extract.js';
import { retargetRequest } from '../substitute.js';

export const kind = 'replay';

export function recordingFile(sourceId, source) {
  return path.resolve(ROOT, source.recording || `recordings/${sourceId}.json`);
}

export function hasRecording(sourceId, source) {
  return fs.existsSync(recordingFile(sourceId, source));
}

export async function createSession({ sourceId, source, cfg, log = () => {} }) {
  const file = recordingFile(sourceId, source);
  const recording = JSON.parse(fs.readFileSync(file, 'utf8'));
  const index = source.candidateIndex ?? 0;
  const candidate = recording.candidates[index];
  if (!candidate) throw new Error(`${sourceId}: recording has no candidate #${index}`);

  const executor = await createExecutor(recording.storageState, cfg);
  log(`${sourceId}: replaying ${candidate.method} ${candidate.url.slice(0, 90)}`);

  return {
    async search({ stay, occupancySummary: occ }) {
      const target = {
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        adults: occ.adults,
        childAges: occ.childAges,
        rooms: occ.rooms,
      };
      const req = retargetRequest(candidate, { probe: recording.probe, target });
      const { status, body } = await executor(req);
      if (status === 401 || status === 403) {
        throw new Error(`sesiune expirata (HTTP ${status}) - ruleaza din nou: npm run record -- ${sourceId}`);
      }
      if (status >= 400) throw new Error(`HTTP ${status}`);

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error('raspunsul nu mai e JSON - probabil s-a schimbat site-ul, re-inregistreaza');
      }
      const scoped = source.offersPath ? atPath(payload, source.offersPath) : payload;
      return extractOffers(scoped, { fallbackCurrency: source.currency || cfg.currency.base, minPrice: 20 });
    },
    async close() {
      await executor.close?.();
    },
  };
}

/** Playwright's request context keeps the recorded cookies alive; plain fetch is the fallback. */
async function createExecutor(storageState, cfg) {
  try {
    const { request } = await import('playwright');
    const ctx = await request.newContext({
      storageState: storageState || undefined,
      timeout: cfg.runtime.navigationTimeoutMs,
    });
    const run = async (req) => {
      const res = await ctx.fetch(req.url, {
        method: req.method,
        headers: req.headers,
        data: req.postData ?? undefined,
      });
      return { status: res.status(), body: await res.text() };
    };
    run.close = () => ctx.dispose();
    return run;
  } catch {
    const cookieHeader = buildCookieHeader(storageState);
    return async (req) => {
      const res = await fetch(req.url, {
        method: req.method,
        headers: { ...req.headers, ...(cookieHeader ? { cookie: cookieHeader } : {}) },
        body: req.postData ?? undefined,
      });
      return { status: res.status, body: await res.text() };
    };
  }
}

function buildCookieHeader(storageState) {
  const cookies = storageState?.cookies || [];
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
