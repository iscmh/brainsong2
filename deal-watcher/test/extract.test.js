import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOffers, atPath } from '../src/extract.js';

test('finds offers in a flat engine payload', () => {
  const offers = extractOffers({
    rooms: [
      { roomName: 'Family Room Sea View', board: 'Ultra All Inclusive', totalPrice: '1 240,50', currency: 'EUR' },
      { roomName: 'Double Park View', board: 'Ultra All Inclusive', totalPrice: 990, currency: 'EUR' },
    ],
  });
  assert.equal(offers.length, 2);
  assert.equal(offers[0].price, 1240.5);
  assert.equal(offers[0].board, 'Ultra All Inclusive');
});

test('finds offers when the money is nested one level down', () => {
  const offers = extractOffers({ data: { results: [{ name: 'Studio', board: 'AI', prices: { total: 1450, currency: 'BGN' } }] } });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].currency, 'BGN');
  assert.equal(offers[0].price, 1450);
});

test('ignores taxes, fees and other bare numbers', () => {
  const offers = extractOffers({ tax: { amount: 12 }, fees: [{ value: 30 }], rooms: [{ name: 'Suite', total: 2000 }] }, { minPrice: 20 });
  assert.deepEqual(offers.map((o) => o.title), ['Suite']);
});

test('prefers a stay total over a per-night rate on the same object', () => {
  const [offer] = extractOffers({ rooms: [{ name: 'Suite', rate: 250, totalPrice: 1500 }] });
  assert.equal(offer.price, 1500);
});

test('de-duplicates identical offers', () => {
  const offers = extractOffers({
    a: { name: 'Suite', total: 1500 },
    b: { name: 'Suite', total: 1500 },
  });
  assert.equal(offers.length, 1);
});

test('atPath scopes into the payload', () => {
  assert.equal(atPath({ a: { b: [{ c: 7 }] } }, 'a.b[0].c'), 7);
  const payload = { a: 1 };
  assert.equal(atPath(payload, ''), payload); // no path = whole payload
  assert.equal(atPath(payload, 'x.y'), undefined);
});
