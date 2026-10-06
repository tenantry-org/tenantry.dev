import { describe, expect, it } from 'vitest';
import { basePriceSentence, formatBasePrice } from './pro-price';

describe('formatBasePrice', () => {
  it("reads Paddle's amount in the currency's lowest unit, and leaves out a zero fraction", () => {
    expect(formatBasePrice('1500', 'GBP')).toBe('£15');
    expect(formatBasePrice('1550', 'GBP')).toBe('£15.50');
    expect(formatBasePrice('15000', 'USD')).toBe('$150');
  });

  it('reads a currency with no minor unit as whole units', () => {
    expect(formatBasePrice('1500', 'JPY')).toBe('¥1,500');
  });
});

describe('basePriceSentence', () => {
  it('names both prices and says the checkout shows the visitor’s own', () => {
    expect(basePriceSentence({ month: '£15', year: '£150' })).toBe(
      'Pro costs £15 a month or £150 a year for your whole company. ' +
        'The checkout shows the price in your currency, with any tax.',
    );
  });
});
