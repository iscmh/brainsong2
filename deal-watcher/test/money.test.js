import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, normaliseNumber, convert, fmtMoney } from '../src/money.js';

test('parses the number formats booking engines actually emit', () => {
  assert.deepEqual(parsePrice('1.234,56 €'), { amount: 1234.56, currency: 'EUR' });
  assert.deepEqual(parsePrice('EUR 1,234.56'), { amount: 1234.56, currency: 'EUR' });
  assert.deepEqual(parsePrice('2 150 лв.'), { amount: 2150, currency: 'BGN' });
  assert.deepEqual(parsePrice('6.190 lei'), { amount: 6190, currency: 'RON' });
  assert.deepEqual(parsePrice('total 990', 'BGN'), { amount: 990, currency: 'BGN' });
  assert.equal(parsePrice('Sold out'), null);
  assert.equal(parsePrice(''), null);
});

test('thousands separators are never mistaken for decimals', () => {
  assert.equal(normaliseNumber('1.234'), 1234);
  assert.equal(normaliseNumber('1.23'), 1.23);
  assert.equal(normaliseNumber('12,345'), 12345);
  assert.equal(normaliseNumber('12,34'), 12.34);
});

test('currency conversion round-trips through the base', () => {
  const rates = { EUR: 1, BGN: 1.95583, RON: 4.98 };
  assert.equal(Math.round(convert(1955.83, 'BGN', 'EUR', rates)), 1000);
  assert.equal(Math.round(convert(1000, 'EUR', 'RON', rates)), 4980);
  assert.throws(() => convert(10, 'JPY', 'EUR', rates), /Missing FX rate/);
  assert.match(fmtMoney(1234.5, 'EUR'), /EUR/);
});
