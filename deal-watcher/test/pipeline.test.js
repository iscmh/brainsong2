import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, entryKey } from '../src/store.js';
import { normalise } from '../src/sweep.js';
import { splitMessage, esc } from '../src/telegram.js';
import { renderTemplate } from '../src/sources/generic.js';
import { formatAlert } from '../src/format.js';
import { REASON } from '../src/alerts.js';
import { ROOT } from '../src/config.js';

const cfg = { currency: { base: 'EUR', rates: { EUR: 1, BGN: 1.95583, RON: 4.98 } } };
const stay = { checkIn: '2027-07-24', checkOut: '2027-07-30', nights: 6 };
const occupancy = { id: '3A+1C12', label: '3 adulti + 1 copil 12 ani' };
const occ = { adults: 3, children: 1, childAges: [12], rooms: 1, guests: 4 };

test('normalise converts to the base currency and sorts cheapest first', () => {
  const offers = normalise(
    [
      { title: 'A', price: 1955.83, currency: 'BGN' },
      { title: 'B', price: 900, currency: 'EUR' },
    ],
    { source: { id: 's', label: 'S' }, cfg, stay, occupancy, occ, base: 'EUR' },
  );
  assert.deepEqual(offers.map((o) => o.title), ['B', 'A']);
  assert.equal(offers[1].priceBase, 1000);
  assert.equal(offers[1].guests, 4);
});

test('per-night pricing is multiplied out to a stay total', () => {
  const [offer] = normalise([{ title: 'A', price: 200, currency: 'EUR' }], {
    source: { id: 's', priceIs: 'perNight' },
    cfg, stay, occupancy, occ, base: 'EUR',
  });
  assert.equal(offer.priceBase, 1200);
});

test('store keeps the all-time best across sweeps and survives a reload', () => {
  const file = path.join(ROOT, 'data', `test-${process.pid}.json`);
  const store = new Store(file);
  const key = entryKey('s', '3A+1C12', '2027-07-24');
  store.record(key, { priceBase: 1500 });
  store.record(key, { priceBase: 1200 });
  const { previousBest, entry } = store.record(key, { priceBase: 1400 });
  assert.equal(previousBest.priceBase, 1200);
  assert.equal(entry.best.priceBase, 1200);
  assert.equal(entry.last.priceBase, 1400);
  store.save();

  const reloaded = new Store(file);
  assert.equal(reloaded.entry(key).best.priceBase, 1200);
  assert.equal(reloaded.cheapest(1)[0].offer.priceBase, 1400);
  fs.unlinkSync(file);
});

test('renderTemplate fills every placeholder', () => {
  const url = renderTemplate(
    'https://x/?ci={checkIn}&co={checkOut}&d={checkInDMY}&a={adults}&c={childCount}&ages={childAges}&r={rooms}&n={nights}&cur={currency}',
    { stay, occ, currency: 'EUR' },
  );
  assert.equal(url, 'https://x/?ci=2027-07-24&co=2027-07-30&d=24.07.2027&a=3&c=1&ages=12&r=1&n=6&cur=EUR');
});

test('alert message contains the numbers that matter and escapes HTML', () => {
  const text = formatAlert({
    reasons: [REASON.ALL_TIME_LOW],
    offer: {
      sourceLabel: 'HVD <Reina>', occupancyLabel: occupancy.label, checkIn: stay.checkIn, checkOut: stay.checkOut,
      nights: 6, priceBase: 1200, price: 1200, currency: 'EUR', title: 'Family Room', board: 'UAI', url: 'https://x/y',
    },
    previousBest: { priceBase: 1500 },
    guests: 4, nights: 6, base: 'EUR',
  });
  assert.ok(text.includes('&lt;Reina&gt;'), 'must escape angle brackets');
  assert.ok(text.includes('1.200 EUR'));
  assert.ok(text.includes('-20%'), 'must show the drop percentage');
  assert.ok(text.includes('50 EUR/pers/noapte'));
});

test('long messages are split under the Telegram limit', () => {
  const chunks = splitMessage(Array.from({ length: 500 }, (_, i) => `linia ${i}`).join('\n'));
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 3900);
  assert.equal(esc('<b>&'), '&lt;b&gt;&amp;');
});
