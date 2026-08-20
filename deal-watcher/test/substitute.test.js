import test from 'node:test';
import assert from 'node:assert/strict';
import { dateVariants, retargetRequest, replaceOccupancyInJson } from '../src/substitute.js';

const probe = { checkIn: '2026-09-10', checkOut: '2026-09-16', adults: 2, childAges: [], rooms: 1 };
const target = { checkIn: '2027-07-24', checkOut: '2027-07-30', adults: 3, childAges: [12], rooms: 1 };

test('date variants cover the usual engine formats', () => {
  const v = dateVariants('2027-07-24');
  for (const expected of ['2027-07-24', '24.07.2027', '07/24/2027', '20270724']) {
    assert.ok(v.includes(expected), `missing ${expected}`);
  }
});

test('retargets a GET request with query-string occupancy', () => {
  const out = retargetRequest(
    { url: 'https://e.bg/s?arrival=10.09.2026&departure=16.09.2026&adults=2&children=0&rooms=1', method: 'GET' },
    { probe, target },
  );
  assert.ok(out.url.includes('arrival=24.07.2027'));
  assert.ok(out.url.includes('departure=30.07.2027'));
  assert.ok(out.url.includes('adults=3'));
  assert.ok(out.url.includes('children=1'));
});

test('retargets a JSON POST body including child ages', () => {
  const out = retargetRequest(
    {
      url: 'https://e.bg/api/availability',
      method: 'POST',
      contentType: 'application/json',
      postData: JSON.stringify({ checkIn: '2026-09-10', checkOut: '2026-09-16', occupancy: { adults: 2, childAges: [] } }),
    },
    { probe, target },
  );
  const body = JSON.parse(out.postData);
  assert.equal(body.checkIn, '2027-07-24');
  assert.equal(body.occupancy.adults, 3);
  assert.deepEqual(body.occupancy.childAges, [12]);
});

test('numbers that merely look like guest counts are left alone', () => {
  const out = replaceOccupancyInJson({ hotelId: 2, adults: 2 }, probe, target);
  assert.equal(out.hotelId, 2, 'hotelId must not be rewritten');
  assert.equal(out.adults, 3);
});

test('urlencoded bodies keep their encoding', () => {
  const out = retargetRequest(
    {
      url: 'https://e.bg/api',
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      postData: 'checkin=2026-09-10&checkout=2026-09-16&nrAdults=2&nrChildren=0',
    },
    { probe, target },
  );
  const params = new URLSearchParams(out.postData);
  assert.equal(params.get('checkin'), '2027-07-24');
  assert.equal(params.get('nrAdults'), '3');
  assert.equal(params.get('nrChildren'), '1');
});
