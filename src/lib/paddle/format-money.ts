export function formatMoney(amount: number = 0, currency: string = 'USD') {
  const language = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return new Intl.NumberFormat(language ?? 'en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount);
}
