/**
 * `npm run record -- <sourceId>` opens a real browser, lets you do ONE search by hand, and saves
 * the underlying availability request. Every later sweep replays that request with new dates,
 * which is far more stable than scraping rendered HTML.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ROOT } from './config.js';
import { launchBrowser, newContext } from './browser.js';
import { extractOffers } from './extract.js';
import { parseDay } from './dates.js';
import { dateVariants } from './substitute.js';

const MAX_BODY = 400_000;

export async function record({ cfg, sourceId, log = console.log }) {
  const source = cfg.sources[sourceId];
  if (!source) throw new Error(`Unknown source '${sourceId}'. Known: ${Object.keys(cfg.sources).join(', ')}`);
  if (!source.hotelUrl) throw new Error(`config.sources.${sourceId}.hotelUrl is not set`);

  const rl = readline.createInterface({ input, output });
  const probe = await askProbe(rl, cfg);

  log(`\nDeschid ${source.hotelUrl} ...`);
  const browser = await launchBrowser({ headless: false });
  const context = await newContext(browser, { locale: cfg.runtime.locale, timezone: cfg.runtime.timezone });
  const page = await context.newPage();

  const captured = [];
  page.on('response', async (response) => {
    try {
      const request = response.request();
      if (!['GET', 'POST'].includes(request.method())) return;
      const contentType = response.headers()['content-type'] || '';
      if (!/json|javascript|html/.test(contentType)) return;
      const body = await response.text().catch(() => '');
      if (!body || body.length > MAX_BODY) return;
      captured.push({
        url: request.url(),
        method: request.method(),
        headers: sanitizeHeaders(request.headers()),
        postData: request.postData() ?? null,
        contentType: request.headers()['content-type'] || '',
        status: response.status(),
        responseContentType: contentType,
        body,
      });
    } catch {
      /* a navigation can kill a response mid-read; ignore */
    }
  });

  await page.goto(source.hotelUrl, { waitUntil: 'domcontentloaded', timeout: cfg.runtime.navigationTimeoutMs });

  log([
    '',
    '─────────────────────────────────────────────',
    'Fa ACUM o singura cautare in browser, exact cu:',
    `  check-in : ${probe.checkIn}`,
    `  check-out: ${probe.checkOut}`,
    `  adulti   : ${probe.adults}`,
    `  copii    : ${probe.childAges.length}${probe.childAges.length ? ` (varste: ${probe.childAges.join(', ')})` : ''}`,
    'Asteapta sa apara lista de camere cu preturi,',
    'apoi vino inapoi aici si apasa ENTER.',
    '─────────────────────────────────────────────',
  ].join('\n'));
  await rl.question('');
  rl.close();

  const candidates = rank(captured, probe);
  const storageState = await context.storageState();
  await browser.close();

  if (!candidates.length) {
    throw new Error(
      'Nu am gasit niciun request cu preturi. Ruleaza din nou si asigura-te ca lista de camere chiar s-a incarcat.',
    );
  }

  const file = path.resolve(ROOT, source.recording || `recordings/${sourceId}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        sourceId,
        hotelUrl: source.hotelUrl,
        probe,
        storageState,
        candidates: candidates.map(({ body, ...rest }) => ({ ...rest, bodyPreview: body.slice(0, 2000) })),
      },
      null,
      2,
    )}\n`,
  );

  log(`\n✅ Salvat in ${path.relative(ROOT, file)}`);
  candidates.slice(0, 5).forEach((c, i) => {
    log(`  [${i}] ${c.offerCount} oferte · ${c.method} ${c.url.slice(0, 110)}`);
    if (c.sampleOffers[0]) log(`      ex: ${c.sampleOffers[0].title} — ${c.sampleOffers[0].price} ${c.sampleOffers[0].currency}`);
  });
  log('\nVerifica ca [0] e request-ul bun; daca nu, seteaza "candidateIndex" pe sursa in config.json.');
  return file;
}

/** Score every captured response by how much it looks like an availability payload. */
export function rank(captured, probe) {
  const dateNeedles = [...dateVariants(probe.checkIn), ...dateVariants(probe.checkOut)];
  const scored = [];

  for (const item of captured) {
    if (item.status >= 400) continue;
    const haystack = `${item.url} ${item.postData || ''}`;
    const mentionsDates = dateNeedles.some(
      (needle) => haystack.includes(needle) || haystack.includes(encodeURIComponent(needle)),
    );

    let offers = [];
    try {
      offers = extractOffers(JSON.parse(item.body), { minPrice: 20 });
    } catch {
      offers = [];
    }
    if (!offers.length && !mentionsDates) continue;

    scored.push({
      ...item,
      offerCount: offers.length,
      sampleOffers: offers.slice(0, 3),
      score: offers.length * 10 + (mentionsDates ? 25 : 0) + (item.method === 'POST' ? 3 : 0),
    });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    // these are recomputed per request; replaying them verbatim breaks compression/host routing
    if (['content-length', 'host', 'accept-encoding', ':authority'].includes(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

async function askProbe(rl, cfg) {
  const suggested = cfg.search.checkInFrom;
  const checkIn = (await rl.question(`Check-in pentru proba [${suggested}]: `)).trim() || suggested;
  parseDay(checkIn);
  const nights = Number((await rl.question(`Nopti [${cfg.search.nights}]: `)).trim() || cfg.search.nights);
  const adults = Number((await rl.question('Adulti [2]: ')).trim() || 2);
  const agesRaw = (await rl.question('Varste copii, separate prin virgula (gol = fara copii): ')).trim();
  const childAges = agesRaw ? agesRaw.split(',').map((s) => Number(s.trim())).filter(Number.isFinite) : [];
  const rooms = Number((await rl.question('Camere [1]: ')).trim() || 1);
  const checkOut = new Date(parseDay(checkIn) + nights * 86_400_000).toISOString().slice(0, 10);
  return { checkIn, checkOut, nights, adults, childAges, rooms };
}
