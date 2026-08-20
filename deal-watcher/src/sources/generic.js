/** Config-driven DOM scraper: renders a search URL with Playwright and reads prices out of the page. */

import { launchBrowser, newContext, blockHeavyAssets } from '../browser.js';
import { parsePrice } from '../money.js';
import { diffDays } from '../dates.js';

export const kind = 'generic';

export function renderTemplate(template, { stay, occ, currency }) {
  const dmy = (iso) => iso.split('-').reverse().join('.');
  const map = {
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    checkInDMY: dmy(stay.checkIn),
    checkOutDMY: dmy(stay.checkOut),
    nights: String(diffDays(stay.checkIn, stay.checkOut)),
    adults: String(occ.adults),
    childCount: String(occ.children),
    childAges: occ.childAges.join(','),
    childAgesRepeated: occ.childAges.map((a) => `age=${a}`).join('&'),
    rooms: String(occ.rooms),
    currency,
  };
  return template.replace(/\{(\w+)\}/g, (full, key) => (key in map ? encodeURI(map[key]) : full));
}

export async function createSession({ sourceId, source, cfg, log = () => {} }) {
  if (!source.urlTemplate) throw new Error(`${sourceId}: needs either a recording or config.sources.${sourceId}.urlTemplate`);
  const browser = await launchBrowser({ headless: cfg.runtime.headless });
  const context = await newContext(browser, { locale: cfg.runtime.locale, timezone: cfg.runtime.timezone });
  await blockHeavyAssets(context);

  return {
    async search({ stay, occupancySummary: occ }) {
      const url = renderTemplate(source.urlTemplate, { stay, occ, currency: source.currency || cfg.currency.base });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.runtime.navigationTimeoutMs });
        if (source.waitForSelector) {
          await page.waitForSelector(source.waitForSelector, { timeout: cfg.runtime.navigationTimeoutMs }).catch(() => {});
        }
        if (source.waitMs) await page.waitForTimeout(source.waitMs);

        const fields = source.fields || {};
        const rows = await page.$$eval(
          source.offerSelector,
          (nodes, sel) =>
            nodes.map((node) => {
              const read = (selector) => {
                if (!selector) return '';
                const el = node.querySelector(selector);
                return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
              };
              const link = node.querySelector('a[href]');
              return {
                title: read(sel.title),
                priceText: read(sel.price),
                board: read(sel.board),
                cancellation: read(sel.cancellation),
                href: link ? link.href : '',
              };
            }),
          fields,
        );

        const currency = source.currency || cfg.currency.base;
        const offers = [];
        for (const row of rows) {
          const parsed = parsePrice(row.priceText, currency);
          if (!parsed) continue;
          offers.push({
            title: row.title,
            board: row.board,
            cancellation: row.cancellation,
            price: parsed.amount,
            currency: parsed.currency,
            url: row.href || url,
          });
        }
        if (!offers.length) log(`${sourceId}: 0 oferte pentru ${stay.checkIn} (verifica selectorii sau chiar nu e disponibil)`);
        return offers.map((o) => ({ ...o, searchUrl: url }));
      } finally {
        await page.close();
      }
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
