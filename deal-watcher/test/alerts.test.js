import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, REASON } from '../src/alerts.js';

const alerts = {
  absoluteThresholdEur: 1300,
  perPersonPerNightThresholdEur: null,
  minDropPctVsBest: 1,
  minDropPctVsLast: 5,
  alertOnNewAvailability: true,
  cooldownHours: 6,
};
const offer = (p) => ({ priceBase: p });
const args = (over) => ({ alerts, guests: 4, nights: 6, now: Date.parse('2026-08-20T12:00:00Z'), ...over });

test('the very first look at a date stays quiet unless it clears the budget', () => {
  const quiet = decide(args({ offer: offer(1500), previousLast: null, previousBest: null, lastAlertAt: null, isFirstObservation: true }));
  assert.equal(quiet.alert, false);
  assert.equal(quiet.suppressed, 'first-observation');

  const loud = decide(args({ offer: offer(1250), previousLast: null, previousBest: null, lastAlertAt: null, isFirstObservation: true }));
  assert.equal(loud.alert, true);
  assert.deepEqual(loud.reasons, [REASON.UNDER_THRESHOLD]);
});

test('a new all-time low always gets through, cooldown or not', () => {
  const v = decide(args({
    offer: offer(1400),
    previousLast: offer(1500),
    previousBest: offer(1450),
    lastAlertAt: '2026-08-20T11:59:00Z',
    isFirstObservation: false,
  }));
  assert.equal(v.alert, true);
  assert.ok(v.reasons.includes(REASON.ALL_TIME_LOW));
  assert.ok(v.reasons.includes(REASON.PRICE_DROP));
});

test('a deal that merely stays under budget does not ping every sweep', () => {
  const v = decide(args({
    offer: offer(1250),
    previousLast: offer(1250),
    previousBest: offer(1250),
    lastAlertAt: '2026-08-20T10:00:00Z',
    isFirstObservation: false,
  }));
  assert.equal(v.alert, false);
  assert.equal(v.suppressed, 'cooldown');
});

test('crossing under the budget for the first time bypasses the cooldown', () => {
  const v = decide(args({
    offer: offer(1290),
    previousLast: offer(1310),
    previousBest: offer(1305),
    lastAlertAt: '2026-08-20T11:00:00Z',
    isFirstObservation: false,
  }));
  assert.equal(v.alert, true);
  assert.ok(v.reasons.includes(REASON.UNDER_THRESHOLD));
});

test('a small wobble is not a price drop', () => {
  const v = decide(args({
    offer: offer(1480),
    previousLast: offer(1500),
    previousBest: offer(1450),
    lastAlertAt: null,
    isFirstObservation: false,
  }));
  assert.equal(v.alert, false);
});

test('availability appearing and disappearing is reported', () => {
  const appeared = decide(args({ offer: offer(1600), previousLast: null, previousBest: null, lastAlertAt: null, isFirstObservation: false }));
  assert.deepEqual(appeared.reasons, [REASON.NEW_AVAILABILITY]);

  const gone = decide(args({ offer: null, previousLast: offer(1600), previousBest: offer(1600), lastAlertAt: null, isFirstObservation: false }));
  assert.deepEqual(gone.reasons, [REASON.GONE]);
});

test('per-person-per-night budget works independently of the total', () => {
  const v = decide(args({
    alerts: { ...alerts, absoluteThresholdEur: null, perPersonPerNightThresholdEur: 55 },
    offer: offer(1300), // 1300 / 4 guests / 6 nights = 54.17
    previousLast: offer(1400),
    previousBest: offer(1400),
    lastAlertAt: null,
    isFirstObservation: true,
  }));
  assert.equal(v.alert, true);
  assert.ok(v.reasons.includes(REASON.UNDER_THRESHOLD));
});
