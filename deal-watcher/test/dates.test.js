import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStays, addDays, diffDays, shortLabel, parseDay } from '../src/dates.js';

test('buildStays covers the window inclusively and marks the preferred sub-window', () => {
  const stays = buildStays({
    checkInFrom: '2027-07-20',
    checkInTo: '2027-08-08',
    nights: 6,
    preferredFrom: '2027-07-25',
    preferredTo: '2027-08-03',
  });
  assert.equal(stays.length, 20);
  assert.equal(stays[0].checkIn, '2027-07-20');
  assert.equal(stays[0].checkOut, '2027-07-26');
  assert.equal(stays.at(-1).checkIn, '2027-08-08');
  assert.equal(stays.filter((s) => s.hot).length, 10);
});

test('date maths crosses month and DST boundaries', () => {
  assert.equal(addDays('2027-07-30', 6), '2027-08-05');
  assert.equal(addDays('2027-10-30', 2), '2027-11-01'); // EU DST change is on 2027-10-31
  assert.equal(diffDays('2027-07-24', '2027-07-30'), 6);
});

test('invalid dates are rejected loudly', () => {
  assert.throws(() => parseDay('2027-02-30'), /Invalid calendar date/);
  assert.throws(() => parseDay('24.07.2027'), /Invalid date/);
  assert.throws(() => buildStays({ checkInFrom: '2027-08-08', checkInTo: '2027-07-20', nights: 6 }), /Empty date window/);
  assert.throws(() => buildStays({ checkInFrom: '2027-07-20', checkInTo: '2027-07-21', nights: 0 }), /positive integer/);
});

test('shortLabel is Romanian and correct', () => {
  assert.equal(shortLabel('2027-07-24'), 'Sam 24 iul');
  assert.equal(shortLabel('2027-08-01'), 'Dum 1 aug');
});
