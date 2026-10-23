import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMinor, formatMinorSigned, minorToRupees, MoneyError, parseMoneyToMinor, rupeesToMinor } from '../../lib/finance/money';

describe('parseMoneyToMinor (strict, integer paisa)', () => {
  it('parses plain and grouped amounts exactly', () => {
    assert.equal(parseMoneyToMinor('250'), 25000);
    assert.equal(parseMoneyToMinor('250.5'), 25050);
    assert.equal(parseMoneyToMinor('250.50'), 25050);
    assert.equal(parseMoneyToMinor('1,250.50'), 125050);
    assert.equal(parseMoneyToMinor(' 250 '), 25000);
    assert.equal(parseMoneyToMinor('0.01'), 1);
    assert.equal(parseMoneyToMinor('1,000,000'), 100000000);
  });

  it('rejects every input the v1 parser corrupted (M1 probes)', () => {
    // v1: '1.005' -> 1 (silent misround). v2: more than 2dp is invalid PKR input.
    assert.throws(() => parseMoneyToMinor('1.005'), MoneyError);
    // v1: '0x10' -> 16, '1e3' -> 1000, '1,2,3' -> 123.
    assert.throws(() => parseMoneyToMinor('0x10'), MoneyError);
    assert.throws(() => parseMoneyToMinor('1e3'), MoneyError);
    assert.throws(() => parseMoneyToMinor('1,2,3'), MoneyError);
    assert.throws(() => parseMoneyToMinor('12,34,567'), MoneyError);
    assert.throws(() => parseMoneyToMinor(''), MoneyError);
    assert.throws(() => parseMoneyToMinor('-5'), MoneyError);
    assert.throws(() => parseMoneyToMinor('abc'), MoneyError);
    assert.throws(() => parseMoneyToMinor('25.5.5'), MoneyError);
  });

  it('rejects zero unless explicitly allowed, and rejects overflow', () => {
    assert.throws(() => parseMoneyToMinor('0'), MoneyError);
    assert.throws(() => parseMoneyToMinor('0.00'), MoneyError);
    assert.equal(parseMoneyToMinor('0', { allowZero: true }), 0);
    assert.throws(() => parseMoneyToMinor('99999999999999.99'), MoneyError);
  });

  it('adds paisa exactly with no floating-point drift', () => {
    // The classic float failure: 0.10 + 0.20 != 0.30 in binary floating point.
    const sum = parseMoneyToMinor('0.10') + parseMoneyToMinor('0.20');
    assert.equal(sum, parseMoneyToMinor('0.30'));
    let acc = 0;
    for (let i = 0; i < 100; i++) acc += parseMoneyToMinor('0.01');
    assert.equal(acc, parseMoneyToMinor('1.00'));
  });
});

describe('formatting and boundary conversion', () => {
  it('formats integer paisa', () => {
    assert.equal(formatMinor(125050), 'Rs 1,250.50');
    assert.equal(formatMinor(25000), 'Rs 250');
    assert.equal(formatMinor(0), 'Rs 0');
    assert.equal(formatMinor(-35000), '-Rs 350');
    assert.equal(formatMinorSigned(200000), '+Rs 2,000');
    assert.equal(formatMinorSigned(-35000), '-Rs 350');
    assert.equal(formatMinorSigned(0), 'Rs 0');
  });

  it('converts at the legacy boundary exactly', () => {
    assert.equal(rupeesToMinor(19.99), 1999);
    assert.equal(minorToRupees(1999), 19.99);
    assert.throws(() => rupeesToMinor(Number.NaN), MoneyError);
    assert.throws(() => minorToRupees(1.5), MoneyError);
  });
});
